import { BUILDINGS, STREET, ALLEYS } from './layout.js';

/** True inside (or within `margin` of) an authored building footprint. */
export function inBuilding(x, z, margin = 0.3) {
  for (const b of BUILDINGS) {
    if (
      x > b.x - b.w / 2 - margin &&
      x < b.x + b.w / 2 + margin &&
      z > b.z - b.d / 2 - margin &&
      z < b.z + b.d / 2 + margin
    ) return true;
  }
  return false;
}

/** True on the street, pavement, or an alley. */
export function isOpen(x, z, margin = 0.3) {
  if (inBuilding(x, z, margin)) return false;
  if (Math.abs(x) < STREET.kerb - 0.1 && z > STREET.zMin && z < STREET.zMax) return true;
  for (const alley of ALLEYS) {
    const [x0, z0, x1, z1] = alley.rect;
    if (
      x > x0 + margin && x < x1 - margin &&
      z > z0 + margin && z < z1 - margin
    ) return true;
  }
  return false;
}

/** Cheap analytic ground hint; physics owns the exact collision height. */
export function groundY(x, z) {
  if (Math.abs(x) < STREET.halfWidth)
    return (1 - (x / STREET.halfWidth) ** 2) * 0.055 + 0.004;
  if (Math.abs(x) < STREET.kerb && z > STREET.zMin && z < STREET.zMax) return STREET.walkH;
  return 0.03;
}
