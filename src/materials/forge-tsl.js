import { Mesh, MeshBasicNodeMaterial, NoBlending, NoColorSpace,
  OrthographicCamera, PlaneGeometry, RenderTarget, RepeatWrapping,
  LinearFilter, LinearMipmapLinearFilter, Scene } from 'three/webgpu';
import { float, uv } from 'three/tsl';
import { macroSurface } from './surfaces-tsl.js';

/** Bake the shared, linear RGBA macro map on the initialized WebGPU renderer. */
export function bakeMacro(renderer, size = 256, seed = 2) {
  const target = new RenderTarget(size, size, {
    depthBuffer: false, generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
    wrapS: RepeatWrapping, wrapT: RepeatWrapping, colorSpace: NoColorSpace,
  });
  // This is data, not sRGB colour. The fine fbm band lives in alpha; blending
  // would premultiply the three other channels and corrupt the packed map.
  const material = new MeshBasicNodeMaterial({ transparent: true, blending: NoBlending,
    depthTest: false, depthWrite: false, toneMapped: false });
  const surface = macroSurface(uv(), float(seed));
  material.colorNode = surface.rgb;
  material.opacityNode = surface.a;
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } catch (error) {
    target.dispose();
    throw error;
  } finally {
    renderer.setRenderTarget(previous);
    geometry.dispose();
    material.dispose();
  }
  return target; // The caller owns the target and its texture.
}
