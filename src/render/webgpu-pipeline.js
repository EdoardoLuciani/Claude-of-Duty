import { RenderPipeline } from 'three/webgpu';
import { builtinAOContext, materialMetalness, materialRoughness, mrt, normalView,
  output, pass, positionView, renderOutput, screenUV, texture3D, uniform, vec4,
  velocity } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { AgXToneMapping, SRGBColorSpace } from 'three/webgpu';

/**
 * WebGPU frame graph shared by the isolated boot probe and, once the remaining
 * GLSL effects are ported, the production render owner. World and first-person
 * depth never mix; the latter has no MSAA and bypasses world TAA/SSR/fog.
 */
export function createWorldViewPipeline(renderer, scene, camera, viewScene, viewCamera,
  { gtao = true, ssrEnabled = false, taa = false, bloomStrength = 0.14,
    bloomThreshold = 1.6, grade = null } = {}) {
  let prePass = null, aoPass = null, ssrPass = null, taaPass = null;
  const worldPass = pass(scene, camera, { samples: 0 });
  const viewPass = pass(viewScene, viewCamera, { samples: 0 });
  // The native depth attachment is perspective nonlinear. Soft particles and
  // aerial perspective consume metres, so publish a separate positive view Z.
  worldPass.setMRT(mrt(taa
    ? { output, velocity, linearDepth: positionView.z.negate() }
    : { output, linearDepth: positionView.z.negate() }));
  if (gtao || ssrEnabled) {
    prePass = pass(scene, camera, { samples: 0 });
    prePass.setMRT(ssrEnabled
      ? mrt({ output: normalView, surface: vec4(materialRoughness, materialMetalness, 0, 1) })
      : mrt({ output: normalView }));
    if (gtao) {
      aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
      worldPass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
    }
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
    taaPass = traa(worldPass.getTextureNode(), worldPass.getTextureNode('depth'),
      worldPass.getTextureNode('velocity'), camera);
    world = ssrPass ? vec4(taaPass.rgb.add(ssrPass.rgb), taaPass.a) : taaPass;
  }
  const view = viewPass.getTextureNode();
  // The view pass is premultiplied; retain its partially transparent optic glass.
  const composite = world.mul(view.a.oneMinus()).add(view);
  const exposure = grade ? uniform(1) : null;
  const exposed = exposure ? composite.mul(exposure) : composite;
  const glow = bloomStrength > 0 ? bloom(exposed, bloomStrength, 0, bloomThreshold) : null;
  const lit = glow ? exposed.add(glow) : exposed;
  // The authored LUT is display-referred; grade AFTER AgX and sRGB encoding.
  const final = grade ? lut3D(renderOutput(lit, AgXToneMapping, SRGBColorSpace),
    texture3D(grade.texture), grade.size, 1) : lit;
  const pipeline = new RenderPipeline(renderer, final);
  if (grade) pipeline.outputColorTransform = false;
  return {
    pipeline, worldPass, viewPass, prePass, aoPass, ssrPass, taaPass, exposure,
    linearDepth: worldPass.getTextureNode('linearDepth'),
    render() { pipeline.render(); },
    dispose() {
      pipeline.dispose();
      worldPass.dispose();
      viewPass.dispose();
      prePass?.dispose();
      aoPass?.dispose();
      ssrPass?.dispose();
      taaPass?.dispose();
      glow?.dispose();
    },
  };
}
