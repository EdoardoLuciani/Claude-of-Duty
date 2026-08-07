/** True inside (or within `margin` of) any authored building footprint. */
export function inBuilding(data, x, z, margin = 0.3) {
  const buildings = data.buildings;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i].spec ?? buildings[i];
    if (
      x > b.x - b.w / 2 - margin &&
      x < b.x + b.w / 2 + margin &&
      z > b.z - b.d / 2 - margin &&
      z < b.z + b.d / 2 + margin
    ) return true;
  }
  return false;
}

/** True on the street, pavement, or an alley. Coordinates are in level space. */
export function isOpen(data, x, z, margin = 0.3) {
  if (inBuilding(data, x, z, margin)) return false;
  const street = data.street;
  if (Math.abs(x) < street.kerb - 0.1 && z > street.zMin && z < street.zMax) return true;
  const alleys = data.alleys;
  for (let i = 0; i < alleys.length; i++) {
    const [x0, z0, x1, z1] = alleys[i].rect;
    if (x > x0 + margin && x < x1 - margin && z > z0 + margin && z < z1 - margin) return true;
  }
  return false;
}

/** Cheap analytic ground hint. Physics owns the exact collision height. */
export function groundY(data, x, z) {
  const street = data.street;
  if (Math.abs(x) < street.halfWidth)
    return (1 - (x / street.halfWidth) ** 2) * 0.055 + 0.004;
  if (Math.abs(x) < street.kerb && z > street.zMin && z < street.zMax) return street.walkH;
  return 0.03;
}
