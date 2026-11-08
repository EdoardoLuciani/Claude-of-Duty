import type { Box3, Object3D } from 'three';
import type { NavMetadata } from '../../src/ai/nav-format.ts';
import type { PhysicsSystem } from '../../src/physics/index.ts';
import type { WorldLadder } from '../../src/core/model-metadata.ts';

export interface NavBakeResult {
  buffer: Uint8Array;
  bvhMs: number;
  polygons: number;
  coverCount: number;
  components: number;
  bakeMs: number;
}
export function bakeNav(collisionScene: Object3D, bounds: Box3, provenance?: Partial<NavMetadata>, volumes?: WorldLadder[]): Promise<NavBakeResult>;
export function bakePhysicsNav(phys: PhysicsSystem, bounds: Box3, provenance?: Partial<NavMetadata>, bvhMs?: number, volumes?: WorldLadder[]): Promise<NavBakeResult>;
