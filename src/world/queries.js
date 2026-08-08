/** Runtime spatial queries driven entirely by the loaded world manifest. */
export class WorldQueries {
  constructor(meta) {
    this.buildings = (meta.buildings ?? []).map((building) => building.spec ?? building);
    this.street = meta.query?.street;
    this.alleys = meta.query?.alleys ?? [];
    if (!this.street) throw new Error('[world] manifest is missing query.street metadata');
  }

  /** True inside (or within `margin` of) an authored building footprint. */
  inBuilding(x, z, margin = 0.3) {
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
  isOpen(x, z, margin = 0.3) {
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
  groundY(x, z) {
    const street = this.street;
    if (Math.abs(x) < street.halfWidth) {
      return (1 - (x / street.halfWidth) ** 2) * 0.055 + 0.004;
    }
    if (Math.abs(x) < street.kerb && z > street.zMin && z < street.zMax) return street.walkH;
    return 0.03;
  }
}
