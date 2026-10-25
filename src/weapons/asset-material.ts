import * as THREE from 'three';
import type { Material, Texture } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

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
  scene.traverse((object): void => {
    if (!(object instanceof THREE.Mesh)) return;
    if (requireSingleMaterial && Array.isArray(object.material)) {
      throw new Error('Weapon GLB: expected single-material mesh primitives');
    }
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, Material>;
    const source = mesh.material;
    let replacement = replacements.get(source);
    if (!replacement) {
      replacement = createWeaponMaterial(source);
      configure?.(source, replacement);
      for (const value of Object.values(replacement as object)) {
        if (value instanceof THREE.Texture)
          result.textures.add(value as Texture<unknown, THREE.TextureEventMap>);
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
  const images = new Set<ImageBitmap>();
  for (const texture of model.textures) {
    const image: unknown = texture.source?.data;
    if (
      typeof image === 'object' &&
      image !== null &&
      'close' in image &&
      typeof image.close === 'function'
    )
      images.add(image as ImageBitmap);
    texture.dispose();
  }
  for (const image of images) image.close();
  model.materials.clear();
  model.textures.clear();
}
