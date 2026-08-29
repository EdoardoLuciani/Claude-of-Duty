import { BUILDINGS, STREET, ALLEYS } from './layout.js';
import { fbm3 } from './util.js';

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

/** Terrain vertex height — must mirror the sand plane in buildGround():
 * flattened inside the street corridor, fbm-sculpted outside, shifted down
 * 0.03 so the road/pavement slabs sit above it. */
const TERRAIN_STEP = 4; // 168 m plane / 42 segments
const TERRAIN_HALF = 84;
function terrainVertexY(x, z) {
  const inCorridor = Math.abs(x) < STREET.kerb + 1 && z > STREET.zMin && z < STREET.zMax;
  const h = inCorridor ? 0 : (fbm3(x * 0.045, 7.3, z * 0.045, 3) - 0.5) * 1.1 + 0.02;
  return h - 0.03;
}

/** Terrain surface height — replicates buildGround()'s sand mesh exactly:
 * same vertex heights on the 4 m grid, same quad diagonal (top-left →
 * bottom-right in world XZ), triangle-interpolated. */
function terrainY(x, z) {
  const gx = Math.min(TERRAIN_HALF - 1e-4, Math.max(-TERRAIN_HALF, x));
  const gz = Math.min(TERRAIN_HALF - 1e-4, Math.max(-TERRAIN_HALF, z));
  const x0 = Math.floor((gx + TERRAIN_HALF) / TERRAIN_STEP) * TERRAIN_STEP - TERRAIN_HALF;
  const z0 = Math.floor((gz + TERRAIN_HALF) / TERRAIN_STEP) * TERRAIN_STEP - TERRAIN_HALF;
  const u = (gx - x0) / TERRAIN_STEP;
  const w = (gz - z0) / TERRAIN_STEP;
  const hA = terrainVertexY(x0, z0);             // (0,0)
  const hB = terrainVertexY(x0, z0 + TERRAIN_STEP);   // (0,1)
  const hC = terrainVertexY(x0 + TERRAIN_STEP, z0 + TERRAIN_STEP); // (1,1)
  const hD = terrainVertexY(x0 + TERRAIN_STEP, z0);   // (1,0)
  // PlaneGeometry splits each quad along the (0,1)-(1,0) diagonal
  if (u + w <= 1) return hA * (1 - u - w) + hB * w + hD * u;
  return hC * (u + w - 1) + hB * (1 - u) + hD * (1 - w);
}

/** Cheap analytic ground hint; physics owns the exact collision height.
 * Tracks the surfaces buildGround() actually renders — road camber, pavement
 * tops, alley overlays and the undulating sand — so scattered dressing lands
 * on the visual ground instead of a flat guess. */
export function groundY(x, z) {
  if (z > STREET.zMin && z < STREET.zMax) {
    if (Math.abs(x) < STREET.halfWidth) {
      return (1 - (x / STREET.halfWidth) ** 2) * 0.055 + 0.004;
    }
    if (Math.abs(x) < STREET.kerb) return STREET.walkH;
    for (const alley of ALLEYS) {
      const [x0, z0, x1, z1] = alley.rect;
      if (x > x0 && x < x1 && z > z0 && z < z1) return 0.06; // alley overlay top
    }
    if (Math.abs(x) < STREET.kerb + 1) return -0.03; // flattened corridor shoulder
  }
  return terrainY(x, z);
}
