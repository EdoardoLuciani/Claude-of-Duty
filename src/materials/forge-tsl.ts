import { float, uv, vec2, vec3 } from 'three/tsl';
import {
  HalfFloatType,
  MeshBasicNodeMaterial,
  NoBlending,
  NoColorSpace,
  QuadMesh,
  RenderTarget,
  RepeatWrapping,
  SRGBColorSpace,
  LinearFilter,
  LinearMipmapLinearFilter,
} from 'three/webgpu';
import type { Node, Renderer } from 'three/webgpu';

import { normalFromHeight } from './normal-tsl.ts';
import { detailSurface, macroSurface } from './surfaces-tsl.ts';

export interface SurfaceNode {
  get(name: 'albedo' | 'height' | 'ao' | 'rough' | 'metal'): Node;
}
interface SurfaceBakeInput {
  size: number;
  worldSize: number;
  relief: number;
  surface: SurfaceNode;
}

const targetOptions = {
  depthBuffer: false,
  generateMipmaps: true,
  minFilter: LinearMipmapLinearFilter,
  magFilter: LinearFilter,
  wrapS: RepeatWrapping,
  wrapT: RepeatWrapping,
  colorSpace: NoColorSpace,
};

function bakeWithHeight(
  renderer: Renderer,
  size: number,
  outputs: readonly RenderTarget[],
  draw: (height: RenderTarget, material: MeshBasicNodeMaterial, quad: QuadMesh) => void
): void {
  const height = new RenderTarget(size, size, {
    depthBuffer: false,
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
    wrapT: RepeatWrapping,
  });
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new QuadMesh(material);
  const previous = renderer.getRenderTarget();
  try {
    draw(height, material, quad);
  } catch (error) {
    for (const output of outputs) output.dispose();
    throw error;
  } finally {
    renderer.setRenderTarget(previous);
    height.dispose();
    material.dispose();
  }
}

/** Bake the shared, linear RGBA macro map on the initialized WebGPU renderer. */
export function bakeMacro(renderer: Renderer, size = 256, seed = 2): RenderTarget {
  const target = new RenderTarget(size, size, targetOptions);
  // This is data, not sRGB colour. The fine fbm band lives in alpha; blending
  // would premultiply the three other channels and corrupt the packed map.
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const surface = macroSurface(uv(), float(seed));
  material.colorNode = surface.rgb;
  material.opacityNode = surface.a;
  const quad = new QuadMesh(material);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    quad.render(renderer);
  } catch (error) {
    target.dispose();
    throw error;
  } finally {
    renderer.setRenderTarget(previous);
    material.dispose();
  }
  return target; // The caller owns the target and its texture.
}

/** Bake linear micro albedo/height and its tangent-space Sobel normal. */
export function bakeDetail(
  renderer: Renderer,
  size = 1024,
  seed = 1
): {
  albedo: RenderTarget;
  normal: RenderTarget;
} {
  const albedo = new RenderTarget(size, size, targetOptions);
  const normal = new RenderTarget(size, size, targetOptions);
  const surface = detailSurface(uv(), float(seed));
  bakeWithHeight(renderer, size, [albedo, normal], (height, material, quad): void => {
    material.colorNode = vec3(surface.a);
    renderer.setRenderTarget(height);
    quad.render(renderer);

    material.colorNode = surface.rgb;
    material.opacityNode = surface.a;
    material.needsUpdate = true;
    renderer.setRenderTarget(albedo);
    quad.render(renderer);

    material.colorNode = normalFromHeight(
      height.texture,
      vec2(1 / size, 1 / size),
      float(0.0034 / 0.25)
    ); // 0.25 m tile, 3.4 mm relief
    material.opacityNode = float(1);
    material.needsUpdate = true;
    renderer.setRenderTarget(normal);
    quad.render(renderer);
  });
  return { albedo, normal }; // Caller owns both targets and their textures.
}

/** Bake a TSL surface with the legacy albedo+height / ORM / normal packing. */
export function bakeSurface(
  renderer: Renderer,
  { size, worldSize, relief, surface }: SurfaceBakeInput
): {
  albedo: RenderTarget;
  orm: RenderTarget;
  normal: RenderTarget;
} {
  const albedo = new RenderTarget(size, size, { ...targetOptions, colorSpace: SRGBColorSpace });
  const orm = new RenderTarget(size, size, targetOptions);
  const normal = new RenderTarget(size, size, targetOptions);
  bakeWithHeight(renderer, size, [albedo, orm, normal], (height, material, quad): void => {
    material.colorNode = vec3(surface.get('height').toFloat());
    renderer.setRenderTarget(height);
    quad.render(renderer);

    material.colorNode = surface.get('albedo').toVec3();
    material.opacityNode = surface.get('height').toFloat();
    material.needsUpdate = true;
    renderer.setRenderTarget(albedo);
    quad.render(renderer);

    material.colorNode = vec3(
      surface.get('ao').toFloat(),
      surface.get('rough').toFloat(),
      surface.get('metal').toFloat()
    );
    material.opacityNode = float(1);
    material.needsUpdate = true;
    renderer.setRenderTarget(orm);
    quad.render(renderer);

    material.colorNode = normalFromHeight(
      height.texture,
      vec2(1 / size, 1 / size),
      float(relief / worldSize)
    );
    material.needsUpdate = true;
    renderer.setRenderTarget(normal);
    quad.render(renderer);
  });
  return { albedo, orm, normal }; // Caller owns the three targets.
}
