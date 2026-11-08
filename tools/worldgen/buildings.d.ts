import type { Matrix4 } from 'three';

import type { Rng } from '../../src/core/rng.ts';
import type { Assembler } from './builder.js';

export interface StairFlight {
  floor: number;
  x: number;
  z: number;
  w?: number;
  ry?: number;
  run?: number;
  railing?: string;
  postEvery?: number;
  railKey?: string;
  landing?: boolean;
}
export interface ExteriorStair {
  side: number;
  doorX: number;
  toFloor?: number;
  fromFloor?: number;
  run?: number;
  w?: number;
  dir?: number;
  out?: number;
}
/** Authoring fields consumed by shared navigation/building regression tooling. */
export interface BuildingSpec {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  t?: number;
  floors?: number;
  enterable?: boolean;
  interiorFloors?: number;
  plinthH?: number;
  damage?: number | undefined;
  wallKey?: string;
  stairFlights?: StairFlight[];
  exteriorStairs?: ExteriorStair[];
}
export interface TraversableOpening {
  kind: 'door' | 'shop';
  side: number;
  w: number;
  from: [number, number, number];
  to: [number, number, number];
}
export interface BuildingInfo {
  spec: BuildingSpec;
  floorY: number[];
  floorYs?: number[];
  roofY: number;
  top: number;
  traversable: TraversableOpening[];
  ladders: Array<{
    x: number;
    z: number;
    y0: number;
    y1: number;
    radius: number;
    nx: number;
    nz: number;
  }>;
  facadeOpenings: Array<{
    side: number;
    f: number;
    kind: string;
    localX: number;
    x: number;
    z: number;
    w: number;
    y0: number;
    y1: number;
    reserved: boolean;
    authored: boolean;
  }>;
  balconies: Array<{ side: number; x: number; y: number; w: number; d: number; pm: Matrix4 }>;
  windows: Array<{
    side: number;
    f: number;
    state: string;
    x: number;
    y: number;
    w: number;
    h: number;
    pm: Matrix4;
  }>;
  awnings: Array<{ side: number; x: number; y: number; w: number; pm: Matrix4 }>;
}
export function buildBuilding(assembler: Assembler, spec: BuildingSpec): BuildingInfo;
export function exteriorStairBoxes(
  spec: BuildingSpec,
  info: BuildingInfo
): Array<{ x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }>;
export function collapseRoof(
  assembler: Assembler,
  rng: Rng,
  spec: BuildingSpec,
  info: BuildingInfo,
  hole: { x: number; z: number }
): void;
