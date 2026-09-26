import { HalfFloatType, Mesh, MeshBasicNodeMaterial, NoBlending, NoColorSpace,
  OrthographicCamera, PlaneGeometry, RenderTarget, RepeatWrapping, SRGBColorSpace,
  LinearFilter, LinearMipmapLinearFilter, Scene } from 'three/webgpu';
import { float, uv, vec2, vec3 } from 'three/tsl';
import { detailSurface, macroSurface } from './surfaces-tsl.js';
import { normalFromHeight } from './normal-tsl.js';

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

/** Bake linear micro albedo/height and its tangent-space Sobel normal. */
export function bakeDetail(renderer, size = 1024, seed = 1) {
  const options = { depthBuffer: false, generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
    wrapS: RepeatWrapping, wrapT: RepeatWrapping, colorSpace: NoColorSpace };
  const albedo = new RenderTarget(size, size, options);
  const normal = new RenderTarget(size, size, options);
  const height = new RenderTarget(size, size, {
    depthBuffer: false, type: HalfFloatType, minFilter: LinearFilter,
    magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping,
  });
  const material = new MeshBasicNodeMaterial({ transparent: true, blending: NoBlending,
    depthTest: false, depthWrite: false, toneMapped: false });
  const surface = detailSurface(uv(), float(seed));
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  const previous = renderer.getRenderTarget();
  try {
    material.colorNode = vec3(surface.a);
    material.opacityNode = float(1);
    renderer.setRenderTarget(height);
    renderer.render(scene, camera);

    material.colorNode = surface.rgb;
    material.opacityNode = surface.a;
    material.needsUpdate = true;
    renderer.setRenderTarget(albedo);
    renderer.render(scene, camera);

    material.colorNode = normalFromHeight(height.texture, vec2(1 / size, 1 / size),
      float(0.0034 / 0.25)); // 0.25 m tile, 3.4 mm relief (generator.js)
    material.opacityNode = float(1);
    material.needsUpdate = true;
    renderer.setRenderTarget(normal);
    renderer.render(scene, camera);
  } catch (error) {
    albedo.dispose();
    normal.dispose();
    throw error;
  } finally {
    renderer.setRenderTarget(previous);
    height.dispose();
    geometry.dispose();
    material.dispose();
  }
  return { albedo, normal }; // Caller owns both targets and their textures.
}

/** Bake a TSL surface with the legacy albedo+height / ORM / normal packing. */
export function bakeSurface(renderer, { size, worldSize, relief, surface }) {
  const options = { depthBuffer: false, generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
    wrapS: RepeatWrapping, wrapT: RepeatWrapping };
  const albedo = new RenderTarget(size, size, { ...options, colorSpace: SRGBColorSpace });
  const orm = new RenderTarget(size, size, { ...options, colorSpace: NoColorSpace });
  const normal = new RenderTarget(size, size, { ...options, colorSpace: NoColorSpace });
  const height = new RenderTarget(size, size, {
    depthBuffer: false, type: HalfFloatType, minFilter: LinearFilter,
    magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping,
  });
  const material = new MeshBasicNodeMaterial({ transparent: true, blending: NoBlending,
    depthTest: false, depthWrite: false, toneMapped: false });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  const previous = renderer.getRenderTarget();
  try {
    material.colorNode = vec3(surface.get('height'));
    renderer.setRenderTarget(height);
    renderer.render(scene, camera);

    material.colorNode = surface.get('albedo');
    material.opacityNode = surface.get('height');
    material.needsUpdate = true;
    renderer.setRenderTarget(albedo);
    renderer.render(scene, camera);

    material.colorNode = vec3(surface.get('ao'), surface.get('rough'), surface.get('metal'));
    material.opacityNode = float(1);
    material.needsUpdate = true;
    renderer.setRenderTarget(orm);
    renderer.render(scene, camera);

    material.colorNode = normalFromHeight(height.texture, vec2(1 / size, 1 / size),
      float(relief / worldSize));
    material.needsUpdate = true;
    renderer.setRenderTarget(normal);
    renderer.render(scene, camera);
  } catch (error) {
    albedo.dispose();
    orm.dispose();
    normal.dispose();
    throw error;
  } finally {
    renderer.setRenderTarget(previous);
    height.dispose();
    geometry.dispose();
    material.dispose();
  }
  return { albedo, orm, normal }; // Caller owns the three targets.
}
