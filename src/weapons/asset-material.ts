import * as THREE from 'three';
import type { Material, Texture } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

import { isClosable } from '../core/guards.ts';
import { isMesh, isTexture } from '../core/three-guards.ts';

/** Native PBR without changing the authored factors/maps. Textures stay shared
 * with the source; the owning loader retains their existing disposal policy. */
export function createWeaponMaterial(source: Material): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial().copy(source);
  // NodeMaterial.copy shares plain objects. Keep destination markers local;
  // standard GLB sources must not acquire PHYSICAL through this adapter.
  material.defines = { ...material.defines, PHYSICAL: '' };
  material.iridescenceThicknessRange = [...material.iridescenceThicknessRange];
  return material;
}

export interface WeaponSceneMaterials {
  materials: Set<Material>;
  textures: Set<Texture>;
}

/** Convert one shared adapter material per authored GLTF material. */
export function convertWeaponScene(
  scene: THREE.Object3D,
  configure?: (source: Material, replacement: MeshPhysicalNodeMaterial) => void,
  requireSingleMaterial = false
): WeaponSceneMaterials {
  const result: WeaponSceneMaterials = { materials: new Set(), textures: new Set() };
  const replacements = new Map<Material, MeshPhysicalNodeMaterial>();
  const sharedTextures = new Map<string, Texture>();
  scene.traverse((object): void => {
    if (!isMesh(object)) return;
    if (requireSingleMaterial && Array.isArray(object.material)) {
      throw new Error('Weapon GLB: expected single-material mesh primitives');
    }
    const mesh = object;
    const source = mesh.material;
    if (Array.isArray(source))
      throw new Error('Weapon GLB: expected single-material mesh primitives');
    let replacement = replacements.get(source);
    if (!replacement) {
      replacement = createWeaponMaterial(source);
      configure?.(source, replacement);
      // GLTFLoader clones UV1 maps per assignment, including roughness/metalness.
      // Reuse only identical static maps; WebGPU otherwise uploads every clone.
      for (const slot of [
        'map',
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'emissiveMap',
        'aoMap',
      ] as const) {
        const texture = replacement[slot];
        if (!texture) continue;
        if (texture.matrixAutoUpdate) texture.updateMatrix();
        const key = JSON.stringify([
          texture.source.uuid,
          texture.channel,
          texture.mapping,
          texture.format,
          texture.type,
          texture.colorSpace,
          texture.wrapS,
          texture.wrapT,
          texture.magFilter,
          texture.minFilter,
          texture.anisotropy,
          texture.flipY,
          texture.premultiplyAlpha,
          texture.unpackAlignment,
          texture.generateMipmaps,
          texture.matrixAutoUpdate,
          ...texture.matrix.elements,
        ]);
        const shared = sharedTextures.get(key);
        if (shared) replacement[slot] = shared;
        else sharedTextures.set(key, texture);
      }
      for (const value of Object.values(replacement as object)) {
        if (isTexture(value)) result.textures.add(value);
      }
      result.materials.add(replacement);
      replacements.set(source, replacement);
      source.dispose();
    }
    mesh.material = replacement;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  });
  return result;
}

/** Dispose the adapter's owned finishes, closing shared decoded images once. */
export function disposeWeaponMaterials(model: {
  materials: Set<Material>;
  textures: Set<Texture>;
}): void {
  for (const material of model.materials) material.dispose();
  const images = new Set<object>();
  for (const texture of model.textures) {
    const image: unknown = texture.source?.data;
    if (
      typeof image === 'object' &&
      image !== null &&
      'close' in image &&
      typeof image.close === 'function'
    )
      images.add(image);
    texture.dispose();
  }
  for (const image of images) if (isClosable(image)) image.close();
  model.materials.clear();
  model.textures.clear();
}
