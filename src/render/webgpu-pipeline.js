import { Lighting, RenderPipeline, Vector2 } from 'three/webgpu';
import { builtinAOContext, context, convertToTexture, metalness, roughness,
  mrt, normalView, pass, positionView, renderGroup, renderOutput, screenCoordinate, screenUV, texture3D,
  Fn, texture, uniform, vec4, velocity } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { AgXToneMapping, Color, SRGBColorSpace } from 'three/webgpu';
import { createAoBilateralBlur } from './ao-blur-webgpu.js';

/**
 * WebGPU frame graph shared by production gameplay and isolated GPU probes.
 * World and first-person
 * depth never mix; the latter has no MSAA and bypasses world TAA/SSR/fog.
 */
export function createWorldViewPipeline(renderer, scene, camera, viewScene, viewCamera,
  { gtao = true, ssrEnabled = false, taa = false, bloomStrength = 0.14,
    bloomThreshold = 1.6, grade = null, fog = null, warp = null,
    postPasses = [], afterDepth = null } = {}) {
  let aoPass = null, aoBlur = null, ssrPass = null, taaPass = null;
  const intermediates = [];
  let taaDepthPlaceholder = null;
  const asTexture = node => {
    const result = convertToTexture(node);
    if (result !== node && result.isRTTNode) intermediates.push(result);
    return result; // Existing texture/pass outputs remain borrowed.
  };
  const worldPass = pass(scene, camera, { samples: 0 });
  const viewPass = pass(viewScene, viewCamera, { samples: 0 });
  // Environment hooks specialize by camera. Give the view pass an explicit
  // cache identity even when its light/environment topology equals the world.
  viewPass.contextNode = context({});
  // PassNode resets Three's clear alpha to one for each pass (including after
  // native CSM renders). Clear the view scene to transparent black, otherwise
  // an empty pixel covers the entire world during alpha composition.
  const oldBefore = viewScene.onBeforeRender, oldAfter = viewScene.onAfterRender;
  const savedColor = new Color();
  let savedAlpha = 0;
  const beforeView = (r, s, c, target) => {
    oldBefore.call(viewScene, r, s, c, target);
    if (target !== viewPass.renderTarget) return;
    r.getClearColor(savedColor);
    savedAlpha = r.getClearAlpha();
    r.setClearColor(0, 0);
  };
  const afterView = (r, s, c, target) => {
    if (target === viewPass.renderTarget) r.setClearColor(savedColor, savedAlpha);
    oldAfter.call(viewScene, r, s, c, target);
  };
  viewScene.onBeforeRender = beforeView;
  viewScene.onAfterRender = afterView;
  const detach = () => {
    if (viewScene.onBeforeRender === beforeView) viewScene.onBeforeRender = oldBefore;
    if (viewScene.onAfterRender === afterView) viewScene.onAfterRender = oldAfter;
  };
  // Opaque geometry only: custom translucent particle fragment shaders cannot
  // produce MRT attachments. Layer 1 excludes the sky dome and soft FX.
  const prePass = pass(scene, camera, { samples: 0 });
  // Keep the original materials for mapped normals, alpha tests and vertex
  // deformation, but skip lighting/IBL and their bindings. A separate manager
  // isolates the prepass render-list/light cache from the lit world pass.
  prePass.lighting = new Lighting();
  prePass.lighting.enabled = false;
  scene.traverse((object) => { if (object.isLight) object.layers.enable(1); });
  prePass.setLayers({ mask: 2 });
  prePass.transparent = false;
  // GTAO sets a white clear before updating its depth dependency. With AO
  // scheduled outside world lighting, don't inherit that clear in normals.
  const updatePrepass = prePass.updateBefore, preClear = new Color();
  prePass.updateBefore = function (frame) {
    const r = frame.renderer, alpha = r.getClearAlpha();
    r.getClearColor(preClear); r.setClearColor(0, 1);
    try {
      updatePrepass.call(this, frame);
      afterDepth?.(); // Consumers now see this frame's opaque depth.
    } finally { r.setClearColor(preClear, alpha); }
  };
  const channels = { output: normalView };
  if (ssrEnabled) channels.surface = vec4(roughness, metalness, 0, 1);
  if (taa) channels.velocity = velocity;
  // The native depth attachment is nonlinear; publish positive view metres.
  channels.linearDepth = positionView.z.negate();
  prePass.setMRT(mrt(channels));
  if (gtao) {
    aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
    // Temporary setting while the upstream depth-sampling fix is under review.
    aoPass.resolutionScale = 0.5;
    aoBlur = createAoBilateralBlur(aoPass.getTextureNode(), prePass.getTextureNode('linearDepth'));
    // World shaders only sample the published texture. Traversing the RTT/AO
    // graph in each new mesh builder resets its fullscreen materials' contexts.
    // ScreenNode creates a fresh size uniform in each builder. Its differing
    // ID fragments otherwise-identical shared camera groups, including CSM's
    // inherited AO context. One pass-aware uniform keeps the same native UVs.
    const aoSize = uniform(new Vector2()).setGroup(renderGroup).onRenderUpdate(({ renderer }, self) => {
      const target = renderer.getRenderTarget();
      if (target) self.value.set(target.width, target.height);
      else renderer.getDrawingBufferSize(self.value);
    });
    worldPass.contextNode = builtinAOContext(texture(aoBlur.textureNode.value)
      .sample(screenCoordinate.div(aoSize)).r);
  }
  let world = worldPass.getTextureNode();
  if (ssrEnabled) {
    const surface = prePass.getTextureNode('surface');
    ssrPass = ssr(world, prePass.getTextureNode('depth'), prePass.getTextureNode(),
      { camera, roughnessNode: surface.r, metalnessNode: surface.g, reflectNonMetals: true });
    ssrPass.intensity.value = 0.16;
    world = vec4(world.rgb.add(ssrPass.rgb), world.a);
  }
  // Resolve only the world. The weapon's ADS motion has no valid world velocity.
  if (taa) {
    taaPass = traa(worldPass.getTextureNode(), prePass.getTextureNode('depth'),
      prePass.getTextureNode('velocity'), camera);
    // r186 replaces this owned placeholder during setup without disposing it.
    // Keep only the orphan, never the borrowed history target's depth texture.
    taaDepthPlaceholder = taaPass._previousDepthNode.value;
    // Use the published resolve texture instead of materializing an identity
    // RTT. Ultra still needs the pointwise TAA + SSR input before fog.
    world = ssrPass ? vec4(taaPass.rgb.add(ssrPass.rgb), taaPass.a) : taaPass.getTextureNode();
  }
  // Apply aerial perspective to world pixels only; the viewmodel is held in
  // view space and must never inherit world fog or temporal reprojection.
  if (fog) world = fog({ color: asTexture(world),
    depth: prePass.getTextureNode('linearDepth') });
  // World-depth haze must not distort an occluding first-person weapon.
  if (warp) world = warp(asTexture(world));
  const view = viewPass.getTextureNode();
  // The view pass is premultiplied; retain its partially transparent optic glass.
  let composite = world.mul(view.a.clamp(0, 1).oneMinus()).add(view);
  const exposure = uniform(1);
  for (const post of postPasses) {
    // Pointwise effects consume this fragment's colour directly. Resampling
    // effects keep the texture input contract and its materialization boundary.
    composite = post.asColorNode ? post.asColorNode(composite, exposure) :
      post.asNode(asTexture(composite), exposure);
  }
  const exposed = composite.mul(exposure);
  // A few viewmodel glints can hit RGBA16F's 65504 ceiling at glancing
  // angles. Cap only bloom's input; the original HDR colour stays intact,
  // while two anomalous pixels cannot light up half the screen.
  const glow = bloomStrength > 0 ? bloom(vec4(exposed.rgb.min(16), exposed.a),
    bloomStrength, 0, bloomThreshold) : null;
  const lit = glow ? exposed.add(glow) : exposed;
  // The authored LUT is display-referred; grade AFTER AgX and sRGB encoding.
  const final = grade ? lut3D(renderOutput(lit, AgXToneMapping, SRGBColorSpace),
    texture3D(grade.texture), grade.size, 1) : lit;
  // Publish current depth before any world soft particles or haze, even without
  // AO. PassNode deduplicates this dependency: exactly one prepass per frame.
  const output = Fn(() => {
    prePass.getTextureNode('linearDepth').sample(screenUV).toVar();
    if (aoBlur) aoBlur.textureNode.sample(screenUV).toVar();
    return final;
  })();
  const pipeline = new RenderPipeline(renderer, output);
  if (grade) pipeline.outputColorTransform = false;
  return {
    pipeline, worldPass, viewPass, prePass, aoPass, aoBlur, ssrPass, taaPass, exposure,
    linearDepth: prePass.getTextureNode('linearDepth'), detach,
    render() { pipeline.render(); },
    dispose() {
      detach();
      pipeline.dispose();
      for (const node of intermediates) node.dispose();
      worldPass.dispose();
      viewPass.dispose();
      prePass.dispose();
      aoBlur?.dispose();
      aoPass?.dispose();
      ssrPass?.dispose();
      taaPass?.dispose();
      // A first-frame-only build can sample history before its target is
      // initialized, so target disposal has no texture listener yet (r186).
      taaPass?._historyRenderTarget.texture.dispose();
      taaDepthPlaceholder?.dispose();
      glow?.dispose();
    },
  };
}
