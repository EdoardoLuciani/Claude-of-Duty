import { BUILDINGS, STREET, ALLEYS } from './layout.js';
import { fbm3 } from './util.js';

export const ALLEY_MOUTHS = [];
for (const alley of ALLEYS) {
  const [x0, z0, x1, z1] = alley.rect;
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const za = Math.min(z0, z1) - 0.2, zb = Math.max(z0, z1) + 0.2;
  if (xa >= STREET.kerb - 0.5) ALLEY_MOUTHS.push({ side: 1, z0: za, z1: zb });
  if (xb <= -STREET.kerb + 0.5) ALLEY_MOUTHS.push({ side: -1, z0: za, z1: zb });
}

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

/** Highest authored slab (floor, terrace, roof) at/below `maxY` in LEVEL xz. */
export function structureY(x, z, buildings, maxY = Infinity) {
  let best = -Infinity;
  const take = (y) => { if (y <= maxY && y > best) best = y; };
  const inside = (cx, cz, w, d, inset) =>
    Math.abs(x - cx) <= w / 2 - inset && Math.abs(z - cz) <= d / 2 - inset;
  for (const info of buildings) {
    const spec = info.spec;
    const groundFloor = spec.interiorFloors ? 0.16 : Math.max(0.13, spec.plinthH ?? 0.42);
    if (inside(spec.x, spec.z, spec.w, spec.d, 0.18)) take(groundFloor);
    const rs = info.roofSpec ?? spec;
    if (inside(rs.x, rs.z, rs.w, rs.d, 0.12)) take(info.roofY);
    for (const terrace of info.terraces) {
      if (inside(terrace.cx, terrace.cz, terrace.sx, terrace.sz, 0.05)) take(terrace.y);
    }
    for (let f = 1; f < info.floorY.length; f++) {
      const useRoof = spec.setback && f >= spec.setback.from;
      const fs = useRoof ? rs : spec;
      if (inside(fs.x, fs.z, fs.w, fs.d, 0.18)) take(info.floorY[f]);
    }
  }
  return best;
}

/** True on the street, pavement, or an alley. */
export function isOpen(x, z, margin = 0.3) {
  if (inBuilding(x, z, margin)) return false;
  if (Math.abs(x) < STREET.kerb - 0.1 && z > STREET.zMin && z < STREET.zMax) return true;
  for (const alley of ALLEYS) {
    const [x0, z0, x1, z1] = alley.rect;
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
    const za = Math.min(z0, z1), zb = Math.max(z0, z1);
    if (
      x > xa + margin && x < xb - margin &&
      z > za + margin && z < zb - margin
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
    if (Math.abs(x) < STREET.kerb) {
      const side = x > 0 ? 1 : -1;
      for (const mouth of ALLEY_MOUTHS) {
        if (mouth.side === side && z > mouth.z0 && z < mouth.z1) return 0.07;
      }
      return STREET.walkH;
    }
    for (const alley of ALLEYS) {
      const [x0, z0, x1, z1] = alley.rect;
      // rects are not guaranteed min→max (east gravel yard is z0 > z1)
      const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
      const za = Math.min(z0, z1), zb = Math.max(z0, z1);
      if (x > xa && x < xb && z > za && z < zb) return 0.06; // alley overlay top
    }
  }
  return terrainY(x, z);
}
