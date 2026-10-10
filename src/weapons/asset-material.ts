import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { Material } from 'three';

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
