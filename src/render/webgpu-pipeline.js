import { RenderPipeline } from 'three/webgpu';
import { builtinAOContext, convertToTexture, materialMetalness, materialRoughness,
  mrt, normalView, pass, positionView, renderOutput, screenUV, texture3D,
  uniform, vec4, velocity } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { AgXToneMapping, Color, SRGBColorSpace } from 'three/webgpu';

/**
 * WebGPU frame graph shared by production gameplay and isolated GPU probes.
 * World and first-person
 * depth never mix; the latter has no MSAA and bypasses world TAA/SSR/fog.
 */
export function createWorldViewPipeline(renderer, scene, camera, viewScene, viewCamera,
  { gtao = true, ssrEnabled = false, taa = false, bloomStrength = 0.14,
    bloomThreshold = 1.6, grade = null, fog = null, warp = null,
    postPasses = [] } = {}) {
  let aoPass = null, ssrPass = null, taaPass = null;
  const worldPass = pass(scene, camera, { samples: 0 });
  const viewPass = pass(viewScene, viewCamera, { samples: 0 });
  // PassNode resets Three's clear alpha to one for each pass (including after
  // native CSM renders). Clear the view scene to transparent black, otherwise
  // an empty pixel covers the entire world during alpha composition.
  const oldBefore = viewScene.onBeforeRender, oldAfter = viewScene.onAfterRender;
  const savedColor = new Color();
  let savedAlpha = 0;
  viewScene.onBeforeRender = (r, s, c, target) => {
    oldBefore.call(viewScene, r, s, c, target);
    if (target !== viewPass.renderTarget) return;
    r.getClearColor(savedColor);
    savedAlpha = r.getClearAlpha();
    r.setClearColor(0, 0);
  };
  viewScene.onAfterRender = (r, s, c, target) => {
    if (target === viewPass.renderTarget) r.setClearColor(savedColor, savedAlpha);
    oldAfter.call(viewScene, r, s, c, target);
  };
  // Opaque geometry only: custom translucent particle fragment shaders cannot
  // produce MRT attachments. Layer 1 excludes the sky dome and soft FX.
  const prePass = pass(scene, camera, { samples: 0 });
  // Both passes must see the same lights. Three caches scene lighting per
  // scene/camera, and an unlit layer-1 prepass can poison the world lighting.
  scene.traverse((object) => { if (object.isLight) object.layers.enable(1); });
  prePass.setLayers({ mask: 2 });
  prePass.transparent = false;
  const channels = { output: normalView };
  if (ssrEnabled) channels.surface = vec4(materialRoughness, materialMetalness, 0, 1);
  if (taa) channels.velocity = velocity;
  // The native depth attachment is nonlinear; publish positive view metres.
  channels.linearDepth = positionView.z.negate();
  prePass.setMRT(mrt(channels));
  if (gtao) {
    aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
    worldPass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
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
    world = ssrPass ? vec4(taaPass.rgb.add(ssrPass.rgb), taaPass.a) : taaPass;
  }
  // Apply aerial perspective to world pixels only; the viewmodel is held in
  // view space and must never inherit world fog or temporal reprojection.
  if (fog) world = fog({ color: convertToTexture(world),
    depth: prePass.getTextureNode('linearDepth') });
  const view = viewPass.getTextureNode();
  // The view pass is premultiplied; retain its partially transparent optic glass.
  let composite = world.mul(view.a.oneMinus()).add(view);
  const exposure = uniform(1);
  if (warp) composite = warp(convertToTexture(composite));
  for (const post of postPasses) composite = post.asNode(convertToTexture(composite), exposure);
  const exposed = grade ? composite.mul(exposure) : composite;
  // A few viewmodel glints can hit RGBA16F's 65504 ceiling at glancing
  // angles. Cap only bloom's input; the original HDR colour stays intact,
  // while two anomalous pixels cannot light up half the screen.
  const glow = bloomStrength > 0 ? bloom(vec4(exposed.rgb.min(16), exposed.a),
    bloomStrength, 0, bloomThreshold) : null;
  const lit = glow ? exposed.add(glow) : exposed;
  // The authored LUT is display-referred; grade AFTER AgX and sRGB encoding.
  const final = grade ? lut3D(renderOutput(lit, AgXToneMapping, SRGBColorSpace),
    texture3D(grade.texture), grade.size, 1) : lit;
  const pipeline = new RenderPipeline(renderer, final);
  if (grade) pipeline.outputColorTransform = false;
  return {
    pipeline, worldPass, viewPass, prePass, aoPass, ssrPass, taaPass, exposure,
    linearDepth: prePass.getTextureNode('linearDepth'),
    render() { pipeline.render(); },
    dispose() {
      viewScene.onBeforeRender = oldBefore;
      viewScene.onAfterRender = oldAfter;
      pipeline.dispose();
      worldPass.dispose();
      viewPass.dispose();
      prePass.dispose();
      aoPass?.dispose();
      ssrPass?.dispose();
      taaPass?.dispose();
      glow?.dispose();
    },
  };
}
