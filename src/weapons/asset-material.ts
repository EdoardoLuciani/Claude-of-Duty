import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { Material, Texture } from 'three';

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

/** Dispose the adapter's owned finishes, closing shared decoded images once. */
export function disposeWeaponMaterials(model: { materials: Set<Material>; textures: Set<Texture> }): void {
  for (const material of model.materials) material.dispose();
  const images = new Set<ImageBitmap>();
  for (const texture of model.textures) {
    const image: unknown = texture.source?.data;
    if (typeof image === 'object' && image !== null && 'close' in image && typeof image.close === 'function')
      images.add(image as ImageBitmap);
    texture.dispose();
  }
  for (const image of images) image.close();
  model.materials.clear(); model.textures.clear();
}
