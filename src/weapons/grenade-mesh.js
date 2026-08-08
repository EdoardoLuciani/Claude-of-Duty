import * as THREE from 'three';

/**
 * Shared frag-grenade mesh assets.
 *
 * Both the AI and the player throw grenades with the same body, so the mesh
 * is built once here instead of being owned by either system. Deliberately
 * never disposed: the assets are two small GPU objects built once per page
 * load, and disposing them from one owner would break the other.
 */
let geo = null;
let mat = null;

/** A fresh grenade mesh; geometry and material are shared. */
export function grenadeMesh() {
  if (!geo) {
    geo = new THREE.IcosahedronGeometry(0.045, 1);
    mat = new THREE.MeshStandardMaterial({
      color: 0x2c3226,
      roughness: 0.62,
      metalness: 0.85,
    });
  }
  return new THREE.Mesh(geo, mat);
}

/** The shared grenade material (for prewarm: compile its shader early). */
export function grenadeMaterial() {
  grenadeMesh();
  return mat;
}
