/** Runtime spatial queries driven entirely by the loaded world manifest. */
import type { WorldManifest, WorldLadder } from '../core/model-metadata.ts';

type BuildingFootprint = NonNullable<WorldManifest['buildings']>[number]['spec'];
type WorldQueryMetadata = Pick<WorldManifest, 'query' | 'volumes'> & {
  buildings?: readonly (BuildingFootprint | { spec: BuildingFootprint })[];
};
type ClimbLadder = WorldLadder & { nx: number; nz: number };

// Manifest data may lack exit normals; never publish an invalid climb.
function isClimbLadder(ladder: WorldLadder): ladder is ClimbLadder {
  return (
    Number.isFinite(ladder.x) &&
    Number.isFinite(ladder.z) &&
    Number.isFinite(ladder.y0) &&
    Number.isFinite(ladder.y1) &&
    typeof ladder.nx === 'number' &&
    Number.isFinite(ladder.nx) &&
    typeof ladder.nz === 'number' &&
    Number.isFinite(ladder.nz)
  );
}

export class WorldQueries {
  declare buildings: BuildingFootprint[];
  declare street: NonNullable<NonNullable<WorldManifest['query']>['street']>;
  declare alleys: NonNullable<NonNullable<WorldManifest['query']>['alleys']>;
  declare ladders: WorldLadder[];

  constructor(meta: WorldQueryMetadata) {
    this.buildings = (meta.buildings ?? []).map(
      (
        building
      ): {
        x: number;
        z: number;
        w: number;
        d: number;
        enterable?: boolean;
        collapse?: boolean;
        ruin?: boolean;
        setback?: { from?: number };
      } => ('spec' in building ? building.spec : building)
    );
    const street = meta.query?.street;
    if (!street) throw new Error('[world] manifest is missing query.street metadata');
    this.street = street;
    this.alleys = meta.query?.alleys ?? [];
    this.ladders = (meta.volumes ?? []).filter((volume): boolean => volume.kind === 'ladder');
  }

  /** Ladder whose catch cylinder contains the world-space point, or null. */
  ladderAt(x: number, y: number, z: number): ClimbLadder | null {
    for (const ladder of this.ladders) {
      if (!isClimbLadder(ladder)) continue;
      const dx = x - ladder.x;
      const dz = z - ladder.z;
      const r = ladder.radius;
      if (dx * dx + dz * dz > r * r) continue;
      if (y < ladder.y0 - 0.5 || y > ladder.y1 + 0.5) continue;
      return ladder;
    }
    return null;
  }

  /** True inside (or within `margin` of) an authored building footprint. */
  inBuilding(x: number, z: number, margin = 0.3): boolean {
    for (const building of this.buildings) {
      if (
        x > building.x - building.w / 2 - margin &&
        x < building.x + building.w / 2 + margin &&
        z > building.z - building.d / 2 - margin &&
        z < building.z + building.d / 2 + margin
      )
        return true;
    }
    return false;
  }

  /** True on the street, pavement, or an authored alley/open area. */
  isOpen(x: number, z: number, margin = 0.3): boolean {
    if (this.inBuilding(x, z, margin)) return false;
    const street = this.street;
    if (Math.abs(x) < street.kerb - 0.1 && z > street.zMin && z < street.zMax) return true;
    for (const alley of this.alleys) {
      const [x0, z0, x1, z1] = alley.rect;
      if (x > x0 + margin && x < x1 - margin && z > z0 + margin && z < z1 - margin) return true;
    }
    return false;
  }

  /** Cheap analytic ground hint; physics owns the exact collision height. */
  groundY(x: number, z: number): number {
    const street = this.street;
    if (Math.abs(x) < street.halfWidth) {
      return (1 - (x / street.halfWidth) ** 2) * 0.055 + 0.004;
    }
    if (Math.abs(x) < street.kerb && z > street.zMin && z < street.zMax) return street.walkH;
    return 0.03;
  }
}
