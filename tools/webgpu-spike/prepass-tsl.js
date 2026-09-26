/**
 * SPIKE — the production depth/normal/velocity prepass, re-authored in TSL.
 *
 * Compare against `src/render/prepass.js` (the GLSL3 + scene.overrideMaterial
 * original) which this mirrors channel for channel:
 *
 *   0  RGBA16F  octahedral view normal (xy), coverage (z), material id (w)
 *   1  RG16F    screen-space velocity as a UV delta (current - previous)
 *   2  R32F     linear view depth in metres (positive)
 *
 * What the TSL version does NOT have to say, and the GLSL one does:
 *
 *   - `#include <batching_pars_vertex> / <skinning_pars_vertex> /
 *     <morphtarget_pars_vertex>` and their six matching `_vertex` calls.
 *     `NodeMaterial.setupPosition` runs morph -> skin -> batch -> instance for
 *     free on any object the pass is drawn with.
 *   - the `USE_INSTANCING` / `USE_BATCHING` `objPos` reconstruction, because
 *     `velocity` builds its clip positions from `positionLocal` and
 *     `positionPrevious`, after that same transform chain.
 *   - `uniformsNeedUpdate = true` and a per-object `material.onBeforeRender`
 *     closure. `material.onBeforeRender` is never called by the WebGPU path at
 *     all (only WebGLRenderer.js:2163 calls it); the replacement is a node-level
 *     `onObjectUpdate`, which is what `VelocityNode` itself uses.
 *   - the prev/curr model matrix plumbing, the `prev` Map, `beginRecord` /
 *     `recordMatrices` / `endRecord` and the `owCurrVP`/`owPrevVP` uniforms.
 *     `VelocityNode` keeps the per-object previous matrix in its own WeakMap.
 *   - `layout(location = N) out vec4` declarations: MRT slots are resolved by
 *     render-target texture NAME.
 *   - `if ( !gl_FrontFacing ) n = -n;` — `normalView` is already back-side aware.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  mrt,
  uniform,
  vec2,
  vec4,
  float,
  normalView,
  positionView,
  velocity,
} from 'three/tsl';

/** Coverage written for skinned / morphed geometry. Same contract as prepass.js. */
export const OW_COVERAGE_DYNAMIC = 0.7;

/**
 * Octahedral normal packing — the TSL spelling of `owEncodeNormal` in glsl.js.
 * The 1e-8 denominator guard is kept verbatim so the two encoders round alike.
 */
export const owEncodeNormal = /*#__PURE__*/ Fn(([n]) => {
  const v = n.toVar();
  v.assign(v.div(v.abs().x.add(v.abs().y).add(v.abs().z).add(1e-8)));

  const signs = vec2(
    v.x.greaterThanEqual(0.0).select(1.0, -1.0),
    v.y.greaterThanEqual(0.0).select(1.0, -1.0)
  );
  const wrapped = vec2(float(1.0).sub(v.y.abs()), float(1.0).sub(v.x.abs())).mul(signs);

  return v.z.greaterThanEqual(0.0).select(v.xy, wrapped);
});

/**
 * Per-object channels. `onObjectUpdate` is `NodeUpdateType.OBJECT`: the callback
 * runs once per object per frame, directly before that object's uniforms are
 * uploaded — which is precisely what the GLSL version hand-rolls inside
 * `material.onBeforeRender` followed by `uniformsNeedUpdate = true`.
 */
export class GBufferTSL {
  constructor() {
    this.prev = new Set();

    this.uMatId = uniform(0);
    this.uMatId.onObjectUpdate(({ object }) => {
      this.uMatId.value = object.userData !== undefined ? object.userData.owMatId || 0 : 0;
    });

    // Skinned and morphed geometry deforms *inside* its transform, so the matrix
    // difference in `velocity` describes none of the motion its pixels have.
    // TAA rejects history on exactly these pixels, so the flag has to survive.
    this.uCoverage = uniform(1);
    this.uCoverage.onObjectUpdate(({ object }) => {
      this.uCoverage.value =
        object.isSkinnedMesh === true ||
        (object.morphTargetInfluences !== undefined && object.morphTargetInfluences !== null)
          ? OW_COVERAGE_DYNAMIC
          : 1;
    });

    // VelocityNode emits NDC motion (current - previous); the rest of the
    // pipeline consumes a half-NDC UV delta (production writes `(a - b) * 0.5`),
    // so the scale is applied here. Sign convention already matches.
    const gVelocity = vec2(velocity).mul(0.5);

    /**
     * The MRT goes on the RENDERER, not on the material.
     *
     * three decides whether the per-object node updates (`NodeUpdateType.OBJECT`)
     * run on every render object by asking
     * `NodeMaterialObserver.needsVelocity(renderer)`, which is
     * `renderer.getMRT() !== null && mrt.has('velocity')`. A material-level
     * `mrtNode` never satisfies that test, so `needsRefresh()` may return NONE,
     * `updateBefore()` is skipped, and every per-object uniform in the graph --
     * including VelocityNode's own previous matrix -- silently goes stale.
     * That is not a subtle perf detail: it is the difference between a correct
     * velocity buffer and a wrong one.
     *
     * It also fixes the naming convention: the output has to be called exactly
     * `velocity` for the test above, which means the render target texture has to
     * carry that name too (MRTNode resolves slots with getTextureIndex by name).
     */
    this.mrtNode = mrt({
      normal: vec4(owEncodeNormal(normalView), this.uCoverage, this.uMatId),
      velocity: vec4(gVelocity, 0.0, 0.0),
      // NOT 'depth'. three reserves that MRT output name: NodeMaterial.setupDepth()
      // does `if (mrt.has('depth')) depthNode = mrt.get('depth')` and assigns it to
      // the fragment depth (gl_FragDepth). A linear-metres view depth written
      // there is not a window-space depth, so every fragment clamps to the far
      // plane and the depth TEST silently stops occluding -- the pass still
      // writes all three attachments, it just writes the wrong surface's values.
      'gb-depth': float(positionView.z.negate()),
    });
    // WebGL silently tolerates an alpha-reading blend factor on an attenuating
    // attachment that has no alpha channel; WebGPU's pipeline validation rejects
    // the whole pipeline (srcFactor SrcAlpha on an RG16F target). A G-buffer
    // write wants NoBlending regardless, but note that the TSL version has to
    // say so explicitly where the GLSL one got away with the default.
    this.material = new THREE.NodeMaterial({ name: 'ow-prepass-tsl' });
    this.material.blending = THREE.NoBlending;
  }

  /** Must be called once per renderer; the MRT is renderer state, not material state. */
  attach(renderer) {
    this.renderer = renderer;
    renderer.setMRT(this.mrtNode);
  }

  setSize(w, h) {
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    if (this.rt && this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;
    if (this.rt) this.rt.dispose();

    const rt = new THREE.RenderTarget(w, h, {
      count: 3,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    // MRT slot selection is by texture name, and `velocity` is a reserved name
    // in three's NodeMaterialObserver (see the mrt() note above).
    rt.textures[0].name = 'normal';
    rt.textures[1].name = 'velocity';
    rt.textures[1].format = THREE.RGFormat;
    rt.textures[2].name = 'gb-depth';
    rt.textures[2].format = THREE.RedFormat;
    rt.textures[2].type = THREE.FloatType;

    for (const t of rt.textures) {
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
    }

    this.rt = rt;
  }

  get normalTexture() {
    return this.rt.textures[0];
  }
  get velocityTexture() {
    return this.rt.textures[1];
  }
  get depthTexture() {
    return this.rt.textures[2];
  }

  render(renderer, scene, camera, clear = true) {
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.material;
    renderer.setRenderTarget(this.rt);
    if (clear) renderer.clear(true, true, false);
    else renderer.clear(false, true, false);
    renderer.render(scene, camera);
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(null);
  }

  /** No-op: `VelocityNode` owns the previous-transform bookkeeping. */
  beginRecord() {}
  recordMatrices() {}
  endRecord() {}

  dispose() {
    if (this.renderer) this.renderer.setMRT(null);
    if (this.rt) this.rt.dispose();
    this.material.dispose();
  }
}
