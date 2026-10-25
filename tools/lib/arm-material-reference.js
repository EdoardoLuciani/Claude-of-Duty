import * as THREE from 'three';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

/**
 * Unmerged, pre-consolidation arm finish for independent BRDF/blood calibration.
 * Keep this reference outside runtime: gameplay uses createArmSurfaceMaterial.
 */
export function createArmReferenceMaterial(source) {
  const physical = source instanceof THREE.MeshPhysicalMaterial;
  const material = physical ? new MeshPhysicalNodeMaterial() : new MeshStandardNodeMaterial();
  material.copy(source);
  material.defines = { ...material.defines };
  if (physical && material.iridescenceThicknessRange && source.iridescenceThicknessRange) {
    material.iridescenceThicknessRange = [...source.iridescenceThicknessRange];
  }
  return material;
}
