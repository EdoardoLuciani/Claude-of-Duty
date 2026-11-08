import { isRecord } from '../../src/core/guards.ts';
import type { ModelVec3, WorldManifest } from '../../src/core/model-metadata.ts';
import { parseWorldManifest } from '../../src/core/model-metadata.ts';
import type { BuildingSpec, TraversableOpening } from '../../tools/worldgen/buildings.js';

export interface NavigationBuilding {
  spec: BuildingSpec;
  floorY: number[];
  roofY: number;
  traversable: TraversableOpening[];
}
export type NavigationMetadata = Omit<WorldManifest, 'buildings'> & {
  buildings: NavigationBuilding[];
};
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('navigation fixture requires an object');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('navigation fixture requires a finite number');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('navigation fixture requires a string');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('navigation fixture requires a boolean');
  return value;
}
function array<T>(value: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('navigation fixture requires an array');
  return value.map((entry: unknown): T => parse(entry));
}
function point(value: unknown): ModelVec3 {
  const [x, y, z, ...rest] = array(value, number);
  if (x === undefined || y === undefined || z === undefined || rest.length)
    throw new Error('navigation fixture requires three coordinates');
  return [x, y, z];
}
function spec(value: unknown): BuildingSpec {
  const source = record(value);
  const result: BuildingSpec = {
    id: string(source.id),
    x: number(source.x),
    z: number(source.z),
    w: number(source.w),
    d: number(source.d),
  };
  if (source.t !== undefined) result.t = number(source.t);
  if (source.enterable !== undefined) result.enterable = boolean(source.enterable);
  if (source.interiorFloors !== undefined) result.interiorFloors = number(source.interiorFloors);
  if (source.plinthH !== undefined) result.plinthH = number(source.plinthH);
  if (source.stairFlights !== undefined)
    result.stairFlights = array(
      source.stairFlights,
      (value): NonNullable<BuildingSpec['stairFlights']>[number] => {
        const flight = record(value);
        const result: NonNullable<BuildingSpec['stairFlights']>[number] = {
          floor: number(flight.floor),
          x: number(flight.x),
          z: number(flight.z),
          w: number(flight.w),
        };
        if (flight.ry !== undefined) result.ry = number(flight.ry);
        if (flight.run !== undefined) result.run = number(flight.run);
        return result;
      }
    );
  if (source.exteriorStairs !== undefined)
    result.exteriorStairs = array(
      source.exteriorStairs,
      (value): NonNullable<BuildingSpec['exteriorStairs']>[number] => {
        const flight = record(value);
        const result: NonNullable<BuildingSpec['exteriorStairs']>[number] = {
          side: number(flight.side),
          doorX: number(flight.doorX),
        };
        if (flight.toFloor !== undefined) result.toFloor = number(flight.toFloor);
        return result;
      }
    );
  return result;
}
function opening(value: unknown): TraversableOpening {
  const source = record(value);
  if (source.kind !== 'door' && source.kind !== 'shop')
    throw new Error('navigation fixture requires a traversable opening');
  return {
    kind: source.kind,
    side: number(source.side),
    w: number(source.w),
    from: point(source.from),
    to: point(source.to),
  };
}
export function parseNavigationMetadata(value: unknown): NavigationMetadata {
  const source = record(value);
  return {
    ...parseWorldManifest(value),
    buildings: array(source.buildings, (value): NavigationBuilding => {
      const building = record(value);
      return {
        spec: spec(building.spec),
        floorY: array(building.floorY, number),
        roofY: number(building.roofY),
        traversable: array(building.traversable, opening),
      };
    }),
  };
}
