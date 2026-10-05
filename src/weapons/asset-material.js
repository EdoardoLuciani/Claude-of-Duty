import { MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

/** Native PBR without changing the authored factors/maps. Textures stay shared
 * with the source; the owning loader retains their existing disposal policy. */
export function createWeaponMaterial(source) {
  const material = new MeshPhysicalNodeMaterial();
  const copy = source.isMeshPhysicalMaterial
    ? MeshPhysicalMaterial.prototype.copy : MeshStandardMaterial.prototype.copy;
  copy.call(material, source);
  material.defines.PHYSICAL = '';
  return material;
}
