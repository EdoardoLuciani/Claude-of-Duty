import { STREET, ALLEYS, BUILDINGS } from './layout.js';

/** True inside (or within `margin` of) any authored building footprint. */
export function inBuilding(x, z, margin = 0.3) {
  for (let i = 0; i < BUILDINGS.length; i++) {
    const b = BUILDINGS[i];
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
export function isOpen(x, z, margin = 0.3) {
  if (inBuilding(x, z, margin)) return false;
  if (Math.abs(x) < STREET.kerb - 0.1 && z > STREET.zMin && z < STREET.zMax) return true;
  for (const a of ALLEYS) {
    const [x0, z0, x1, z1] = a.rect;
    if (x > x0 + margin && x < x1 - margin && z > z0 + margin && z < z1 - margin) return true;
  }
  return false;
}

/** Cheap analytic ground hint. Physics owns the exact collision height. */
export function groundY(x, z) {
  if (Math.abs(x) < STREET.halfWidth)
    return (1 - (x / STREET.halfWidth) ** 2) * 0.055 + 0.004;
  if (Math.abs(x) < STREET.kerb && z > STREET.zMin && z < STREET.zMax) return STREET.walkH;
  return 0.03;
}
