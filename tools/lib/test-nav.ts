// Small physical fixtures for behaviour tests; all routing uses production Detour.
import * as THREE from 'three';

import { SurfaceNav } from '../../src/ai/nav.ts';
import { physicsFor } from '../nav240/fixtures.ts';
import { bakePhysicsNav } from '../worldgen/nav-bake.js';

// Platform tuples: centre X, surface Y, centre Z, width, depth.
export async function testNav(platforms: readonly (readonly [number, number, number, number, number])[] = [[5.5, 0, 5.5, 16, 16]]): Promise<SurfaceNav> {
  const scene = new THREE.Scene();
  for (const [x, y, z, width, depth] of platforms) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.4, depth),
      new THREE.MeshBasicMaterial()
    );
    mesh.position.set(x, y - 0.2, z);
    scene.add(mesh);
  }
  const physics = physicsFor(scene),
    bounds = new THREE.Box3().setFromObject(scene);
  const bake = await bakePhysicsNav(physics, bounds);
  scene.traverse((o): void => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry: unknown = o.geometry;
    if (geometry instanceof THREE.BufferGeometry) geometry.dispose();
    const material: unknown = o.material;
    if (Array.isArray(material)) {
      for (const entry: unknown of material) if (entry instanceof THREE.Material) entry.dispose();
    } else if (material instanceof THREE.Material) material.dispose();
  });
  return SurfaceNav.load(bake.buffer, physics);
}
