import * as THREE from 'three';

const geometry = new THREE.IcosahedronGeometry(0.045, 1);
const material = new THREE.MeshStandardMaterial({
  color: 0x2c3226,
  roughness: 0.62,
  metalness: 0.85,
});

/** A fresh grenade mesh with shared geometry and material. */
export function grenadeMesh() {
  return new THREE.Mesh(geometry, material);
}

/** The shared grenade material, exposed for shader prewarming. */
export function grenadeMaterial() {
  return material;
}
