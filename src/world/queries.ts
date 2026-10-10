/** Runtime spatial queries driven entirely by the loaded world manifest. */
interface BuildingFootprint {
  x: number;
  z: number;
  w: number;
  d: number;
}

type BuildingRecord = BuildingFootprint | { spec: BuildingFootprint };

interface StreetQuery {
  halfWidth: number;
  kerb: number;
  walkH: number;
  zMin: number;
  zMax: number;
}

interface AlleyQuery {
  rect: readonly [number, number, number, number];
}

interface LadderVolume {
  kind: 'ladder';
  x: number;
  y0: number;
  y1: number;
  z: number;
  radius: number;
}

interface WorldQueryMetadata {
  buildings?: readonly BuildingRecord[];
  query?: {
    street?: StreetQuery;
    alleys?: readonly AlleyQuery[];
  };
  volumes?: readonly LadderVolume[];
}

export class WorldQueries {
  declare buildings: BuildingFootprint[];
  declare street: StreetQuery;
  declare alleys: readonly AlleyQuery[];
  declare ladders: LadderVolume[];

  constructor(meta: WorldQueryMetadata) {
    this.buildings = (meta.buildings ?? []).map((building) => 'spec' in building ? building.spec : building);
    const street = meta.query?.street;
    if (!street) throw new Error('[world] manifest is missing query.street metadata');
    this.street = street;
    this.alleys = meta.query?.alleys ?? [];
    this.ladders = (meta.volumes ?? []).filter((volume) => volume.kind === 'ladder');
  }

  /** Ladder whose catch cylinder contains the world-space point, or null. */
  ladderAt(x: number, y: number, z: number): LadderVolume | null {
    for (const ladder of this.ladders) {
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
      ) return true;
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
