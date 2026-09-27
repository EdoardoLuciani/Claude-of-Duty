import { RenderPipeline } from 'three/webgpu';
import { builtinAOContext, mrt, normalView, pass, screenUV } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/**
 * WebGPU frame graph shared by the isolated boot probe and, once the remaining
 * GLSL effects are ported, the production render owner. World and first-person
 * depth never mix; the latter has no MSAA and is composed before bloom/exposure.
 */
export function createWorldViewPipeline(renderer, scene, camera, viewScene, viewCamera,
  { gtao = true, bloomStrength = 0.14, bloomThreshold = 1.6 } = {}) {
  let prePass = null, aoPass = null;
  const worldPass = pass(scene, camera, { samples: 0 });
  const viewPass = pass(viewScene, viewCamera, { samples: 0 });
  if (gtao) {
    prePass = pass(scene, camera, { samples: 0 });
    prePass.setMRT(mrt({ output: normalView }));
    aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
    worldPass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
  }
  // The view pass is premultiplied. Compositing it before bloom keeps optic
  // glass partially transparent while retaining world silhouettes behind it.
  const composite = worldPass.mul(viewPass.a.oneMinus()).add(viewPass);
  const glow = bloomStrength > 0 ? bloom(composite, bloomStrength, 0, bloomThreshold) : null;
  const pipeline = new RenderPipeline(renderer, glow ? composite.add(glow) : composite);
  return {
    pipeline, worldPass, viewPass, prePass, aoPass,
    render() { pipeline.render(); },
    dispose() {
      pipeline.dispose();
      worldPass.dispose();
      viewPass.dispose();
      prePass?.dispose();
      aoPass?.dispose();
      glow?.dispose();
    },
  };
}
