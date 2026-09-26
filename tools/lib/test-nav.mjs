// Small physical fixtures for behaviour tests; all routing uses production Detour.
import * as THREE from 'three';
import { SurfaceNav } from '../../src/ai/nav.js';
import { bakePhysicsNav } from '../worldgen/nav-bake.js';
import { physicsFor } from '../nav240/fixtures.mjs';

// Platform tuples: centre X, surface Y, centre Z, width, depth.
export async function testNav(platforms = [[5.5, 0, 5.5, 16, 16]]) {
  const scene = new THREE.Scene();
  for (const [x, y, z, width, depth] of platforms) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, .4, depth), new THREE.MeshBasicMaterial());
    mesh.position.set(x, y - .2, z); scene.add(mesh);
  }
  const physics = physicsFor(scene), bounds = new THREE.Box3().setFromObject(scene);
  const bake = await bakePhysicsNav(physics, bounds);
  scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  return SurfaceNav.load(bake.buffer, physics);
}
