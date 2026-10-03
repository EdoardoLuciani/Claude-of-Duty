import * as THREE from 'three';
import { Fn, clamp, screenUV, uniform, uniformTexture, vec2, vec4 } from 'three/tsl';
import { ParticleLayer, resetSpawn, SP } from './particles.js';
import { P } from './atlas.js';

/**
 * Screen-space refraction for hot gas, shockwaves and heat shimmer.
 *
 * Distortion sprites are drawn into a half-resolution RG target as *screen-space
 * offsets* (additive, so overlapping sources compound), depth-tested against
 * the scene so haze behind a wall does not bleed through it. A TSL warp node
 * then warps the resolved HDR colour by that offset — before bloom, so a hot
 * highlight smears the way it does through real air.
 *
 * Strict-WebGPU ownership:
 *   - `render(renderer, camera)` is the explicit adapter that draws the offset
 *     sprites into `this.rt`. The render owner calls it once per frame, before
 *     the warp, while the same camera is active.
 *   - `warpNode(colorTextureNode)` is a TSL node the render owner inserts into
 *     the upstream `RenderPipeline` after the world/view composite and before
 *     bloom. It samples the resolved colour at the offset UVs with a chromatic
 *     split. `colorTextureNode` must be a texture node (a pass output), because
 *     the warp re-samples it at shifted coordinates.
 *
 * This replaces the WebGL `registerPass` callback, which WebGPU's frame graph
 * has no equivalent of. No fallback: if the render owner cannot provide a
 * `colorTextureNode`, the haze does not render.
 */
export class HazeSystem {
  constructor(o) {
    this.enabled = true;
    this.scene = new THREE.Scene();
    this.scene.matrixAutoUpdate = false;

    this.layer = new ParticleLayer({
      capacity: o.capacity,
      mode: 'distort',
      atlas: o.atlas,
      cols: o.cols,
    });
    // The distortion fragment does its own occlusion test against the scene
    // depth, so hardware depth-testing is off and the mesh is never culled.
    this.layer.material.depthTest = false;
    this.scene.add(this.layer.mesh);
    this.layer.mesh.visible = true; // visibility is driven by instanceCount

    this.rt = null;
    this.size = new THREE.Vector2(1, 1);
    this.uStrength = uniform(new THREE.Vector2(0.013, 0));
    this.uActive = uniform(0);
    this._warmCam = null;

    this.distortTexNode = uniformTexture(_placeholder());
    this.distortTexNode.name = 'fx-distort-sample';
    this._warp = null;
    this._warpColor = null;
  }

  /** Latest distortion texture, for callers wiring the warp manually. */
  get distortTexture() {
    return this.rt?.texture ?? null;
  }

  /**
   * Compile the offset-sprite node material and the warp graph without drawing
   * a gameplay frame. Safe to call more than once.
   */
  async prewarm(renderer) {
    if (!renderer?.compileAsync) return { ok: false, reason: 'no compileAsync' };
    const cam = this._warmCam ?? (this._warmCam = new THREE.PerspectiveCamera());
    try {
      await renderer.compileAsync(this.scene, cam);
    } catch (err) {
      console.warn('[fx] haze prewarm failed', err);
    }
    return { ok: true };
  }

  resize(w, h) {
    const rw = Math.max(1, Math.floor(w * 0.5));
    const rh = Math.max(1, Math.floor(h * 0.5));
    if (this.rt && this.size.x === rw && this.size.y === rh) return;
    this.size.set(rw, rh);
    if (this.rt) this.rt.dispose();
    this.rt = new THREE.RenderTarget(rw, rh, {
      type: THREE.HalfFloatType,
      format: THREE.RGFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rt.texture.name = 'fx-distort';
    this.distortTexNode.value = this.rt.texture;
    this.layer.uniforms.uRes.value.set(rw, rh);
  }

  /** Add one distortion sprite. `strength` is a screen-space offset in UV. */
  emit(now, x, y, z, radius, grow, life, strength, tile = P.SMOKE_A, seed = 0) {
    const s = resetSpawn();
    s.x = x;
    s.y = y;
    s.z = z;
    s.size0 = radius;
    s.size1 = radius * grow;
    s.sizeCurve = 0.5;
    s.life = life;
    s.drag = 2;
    s.tile = tile;
    s.soft = 0.6;
    s.alpha = 1;
    s.alphaCurve = 1.2;
    s.r0 = strength;
    s.g0 = strength;
    s.b0 = strength;
    s.i0 = 1;
    s.r1 = strength;
    s.g1 = strength;
    s.b1 = strength;
    s.i1 = 1;
    s.seed = seed;
    this.layer.emit(s, now);
    return SP;
  }

  update(now, depthTexture, camera) {
    this.layer.setDepth(depthTexture);
    this.layer.uniforms.uSoftEnable.value.x = depthTexture ? 1 : 0;
    this.layer.flush(now);
    const live = this.layer.mesh.visible;
    this.layer.mesh.visible = true; // culling is by instanceCount, not visibility
    this._camera = camera;
    this._live = this.enabled && live && !!this.rt;
    // render() skips idle frames, leaving the last offsets in the target.
    // Gate them here so a finished shockwave cannot warp later frames.
    this.uActive.value = this._live ? 1 : 0;
  }

  /**
   * Draw the offset sprites into the half-resolution target. Called by the render
   * owner before the warp, with the main camera. Returns false when idle.
   */
  render(renderer, camera = this._camera) {
    if (!this._live || !this.rt || !camera) return false;
    const prevTarget = renderer.getRenderTarget?.() ?? null;
    const prev = renderer.getClearColor(_col);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.scene, camera);
    renderer.setClearColor(prev, prevAlpha);
    renderer.setRenderTarget(prevTarget);
    return true;
  }

  /**
   * Build the TSL warp for a resolved colour texture node. Cache the result:
   * build it once when the pipeline is assembled, not per frame.
   *
   * @param {import('three/tsl').Node} colorNode a texture node (pass output)
   * @returns {import('three/tsl').Node<vec4>}
   */
  warpNode(colorSource) {
    const colorNode = colorSource?.isTextureNode ? colorSource : uniformTexture(colorSource);
    if (this._warp && this._warpColor === colorNode) return this._warp;
    const distort = this.distortTexNode;
    const strength = this.uStrength;
    const active = this.uActive;
    this._warp = Fn(() => {
      const raw = distort.sample(screenUV).xy.mul(strength.x).mul(active);
      const d = clamp(raw, vec2(-0.03), vec2(0.03));
      // Chromatic split across the refraction so the smear reads as air, not blur.
      const r = colorNode.sample(screenUV.add(d.mul(1.08))).r;
      const c = colorNode.sample(screenUV.add(d));
      const b = colorNode.sample(screenUV.add(d.mul(0.92))).b;
      return vec4(r, c.g, b, c.a);
    })();
    this._warpColor = colorNode;
    return this._warp;
  }

  dispose() {
    this.layer.dispose();
    this.rt?.dispose();
    this.distortTexNode.dispose?.();
  }
}

const _col = new THREE.Color();

let placeholderTexture = null;

function _placeholder() {
  if (!placeholderTexture) {
    placeholderTexture = new THREE.DataTexture(
      new Float32Array([0, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    placeholderTexture.name = 'fx-distort-empty';
    placeholderTexture.needsUpdate = true;
  }
  return placeholderTexture;
}
