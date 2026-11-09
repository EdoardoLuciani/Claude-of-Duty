import * as THREE from 'three';

import type { StaticWorld } from '../../src/physics/bvh.ts';
import type { SurfaceName } from '../../src/physics/surfaces.ts';

/** 6 m square floor at y = 0 as two world-space triangles. */
export const FLOOR = [-3, 0, -3, -3, 0, 3, 3, 0, 3, 3, 0, 3, 3, 0, -3, -3, 0, -3];

/** Register world-space triangles (9 floats each) through the production mesh path. */
export function addTriangles(
  world: StaticWorld,
  positions: number[],
  surface: SurfaceName
): number {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return world.addMesh(new THREE.Mesh(geometry), surface);
}
