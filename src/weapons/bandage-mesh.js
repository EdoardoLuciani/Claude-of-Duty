import * as THREE from 'three';

/**
 * Field bandage: a short cloth roll for the right palm, plus wrap rings that
 * sit on the left forearm. Shared materials; one group per viewmodel.
 *
 * Roll local space: origin in the palm, +Z toward the fingers (hand -Z is
 * fingers, so the mesh is rotated into the palm in viewmodel.js).
 */

const clothMat = new THREE.MeshStandardMaterial({
  color: 0xcbb892,
  roughness: 0.9,
  metalness: 0.04,
  envMapIntensity: 0.35,
});
const coreMat = new THREE.MeshStandardMaterial({
  color: 0x8d7a52,
  roughness: 0.86,
  metalness: 0.05,
  envMapIntensity: 0.3,
});

const _rollGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.052, 12, 1, false);
const _coreGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.054, 8, 1, false);
const _tailGeo = new THREE.BoxGeometry(0.018, 0.0022, 0.046);
const _ringGeo = new THREE.TorusGeometry(0.033, 0.0052, 5, 14);

export function bandageMesh() {
  const group = new THREE.Group();
  group.name = 'ow-bandage';

  const roll = new THREE.Mesh(_rollGeo, clothMat);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0.0, -0.016, -0.046);
  roll.castShadow = true;
  group.add(roll);

  const core = new THREE.Mesh(_coreGeo, coreMat);
  core.rotation.z = Math.PI / 2;
  core.position.set(0.0, -0.016, -0.046);
  group.add(core);

  const tail = new THREE.Mesh(_tailGeo, clothMat);
  tail.position.set(0.012, -0.02, -0.072);
  tail.rotation.y = 0.35;
  group.add(tail);

  group.visible = false;
  return group;
}

export function bandageWrapRing() {
  const mesh = new THREE.Mesh(_ringGeo, clothMat);
  mesh.castShadow = true;
  mesh.visible = false;
  return mesh;
}

export function disposeBandageGeometry() {
  _rollGeo.dispose();
  _coreGeo.dispose();
  _tailGeo.dispose();
  _ringGeo.dispose();
  clothMat.dispose();
  coreMat.dispose();
}
