/** Allocation-free scalar geometry with caller-owned result records; right-handed, Y-up, metres.
 * Capsule endpoints are sphere centres, not tips. Front-facing triangles are CCW;
 * geometric normal = normalize(cross(b-a,c-a)).
 */

import type { Matrix4Tuple } from 'three';

import { clamp } from '../core/math.ts';

export const EPS = 1e-9;
interface ClosestResult {
  d2: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  s: number;
  t: number;
}
interface HitRecord {
  hit: boolean;
  t: number;
  px: number;
  py: number;
  pz: number;
  nx: number;
  ny: number;
  nz: number;
  tri: number;
  surface: number;
  object: number;
  frontFace: boolean;
  body: unknown;
}

/** A closest-feature record. Reused everywhere; never allocated per query. */
export function makeClosest(): ClosestResult {
  return { d2: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, s: 0, t: 0 };
}

/** A raycast/sweep result record. */
export function makeHitRecord(): HitRecord {
  return {
    hit: false,
    t: 0,
    px: 0,
    py: 0,
    pz: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    tri: -1,
    surface: 0,
    object: -1,
    frontFace: true,
    body: null,
  };
}

/**
 * Möller–Trumbore. Returns the ray parameter t (distance if dir is unit) or
 * -1 on miss. Does not cull backfaces — penetration needs exit hits.
 * `out.frontFace` is written when out is supplied.
 */
export function rayTriangle(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  out?: Pick<HitRecord, 'frontFace'>
): number {
  const e1x = bx - ax,
    e1y = by - ay,
    e1z = bz - az;
  const e2x = cx - ax,
    e2y = cy - ay,
    e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return -1; // parallel
  const inv = 1 / det;
  const tx = ox - ax,
    ty = oy - ay,
    tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-6 || u > 1.000001) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-6 || u + v > 1.000001) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (out) out.frontFace = det > 0;
  return t;
}

/**
 * Slab test against an AABB using precomputed reciprocal direction.
 * Returns the entry distance, or Infinity on miss. Handles rays starting
 * inside the box (returns 0).
 */
export function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  ix: number,
  iy: number,
  iz: number,
  minx: number,
  miny: number,
  minz: number,
  maxx: number,
  maxy: number,
  maxz: number,
  tmax: number
): number {
  let t0 = (minx - ox) * ix;
  let t1 = (maxx - ox) * ix;
  let lo = t0 < t1 ? t0 : t1;
  let hi = t0 < t1 ? t1 : t0;
  t0 = (miny - oy) * iy;
  t1 = (maxy - oy) * iy;
  const lo1 = t0 < t1 ? t0 : t1;
  const hi1 = t0 < t1 ? t1 : t0;
  if (lo1 > lo) lo = lo1;
  if (hi1 < hi) hi = hi1;
  t0 = (minz - oz) * iz;
  t1 = (maxz - oz) * iz;
  const lo2 = t0 < t1 ? t0 : t1;
  const hi2 = t0 < t1 ? t1 : t0;
  if (lo2 > lo) lo = lo2;
  if (hi2 < hi) hi = hi2;
  if (hi < 0 || lo > hi || lo > tmax) return Infinity;
  return lo < 0 ? 0 : lo;
}

/** Ericson, Real-Time Collision Detection §5.1.5. Writes out.b* = point on tri. */
export function closestPtPointTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  out: ClosestResult
): void {
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az;
  const acx = cx - ax,
    acy = cy - ay,
    acz = cz - az;
  const apx = px - ax,
    apy = py - ay,
    apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out.bx = ax;
    out.by = ay;
    out.bz = az;
    return;
  }
  const bpx = px - bx,
    bpy = py - by,
    bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out.bx = bx;
    out.by = by;
    out.bz = bz;
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out.bx = ax + abx * v;
    out.by = ay + aby * v;
    out.bz = az + abz * v;
    return;
  }
  const cpx = px - cx,
    cpy = py - cy,
    cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out.bx = cx;
    out.by = cy;
    out.bz = cz;
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out.bx = ax + acx * w;
    out.by = ay + acy * w;
    out.bz = az + acz * w;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out.bx = bx + (cx - bx) * w;
    out.by = by + (cy - by) * w;
    out.bz = bz + (cz - bz) * w;
    return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out.bx = ax + abx * v + acx * w;
  out.by = ay + aby * v + acy * w;
  out.bz = az + abz * v + acz * w;
}

/**
 * Closest points between segments p1q1 and p2q2 (Ericson §5.1.9).
 * Writes out.a* (on segment 1), out.b* (on segment 2), out.s/out.t, out.d2.
 */
export function closestPtSegSeg(
  p1x: number,
  p1y: number,
  p1z: number,
  q1x: number,
  q1y: number,
  q1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
  q2x: number,
  q2y: number,
  q2z: number,
  out: ClosestResult
): number {
  const dx1 = q1x - p1x,
    dy1 = q1y - p1y,
    dz1 = q1z - p1z;
  const dx2 = q2x - p2x,
    dy2 = q2y - p2y,
    dz2 = q2z - p2z;
  const rx = p1x - p2x,
    ry = p1y - p2y,
    rz = p1z - p2z;
  const a = dx1 * dx1 + dy1 * dy1 + dz1 * dz1;
  const e = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
  const f = dx2 * rx + dy2 * ry + dz2 * rz;
  let s, t;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = dx1 * rx + dy1 * ry + dz1 * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dx1 * dx2 + dy1 * dy2 + dz1 * dz2;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const ax = p1x + dx1 * s,
    ay = p1y + dy1 * s,
    az = p1z + dz1 * s;
  const bx = p2x + dx2 * t,
    by = p2y + dy2 * t,
    bz = p2z + dz2 * t;
  out.ax = ax;
  out.ay = ay;
  out.az = az;
  out.bx = bx;
  out.by = by;
  out.bz = bz;
  out.s = s;
  out.t = t;
  const ex = ax - bx,
    ey = ay - by,
    ez = az - bz;
  out.d2 = ex * ex + ey * ey + ez * ez;
  return out.d2;
}

const _tmp = makeClosest();

/**
 * Squared distance between segment p0p1 and triangle abc, plus the closest
 * point pair (out.a* on the segment, out.b* on the triangle).
 *
 * This is the single most important routine in the system: capsule sweeps,
 * capsule overlap, ragdoll bone collision and rigid-body probes all reduce to
 * it. Cost is ~5 sub-queries worst case, early-outs on intersection.
 */
export function segTriangleClosest(
  p0x: number,
  p0y: number,
  p0z: number,
  p1x: number,
  p1y: number,
  p1z: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  out: ClosestResult
): number {
  // Plane straddle test first: if the segment crosses the triangle interior the
  // distance is exactly zero and we can skip the five edge/vertex sub-queries.
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az;
  const acx = cx - ax,
    acy = cy - ay,
    acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const d0 = nx * (p0x - ax) + ny * (p0y - ay) + nz * (p0z - az);
  const d1 = nx * (p1x - ax) + ny * (p1y - ay) + nz * (p1z - az);
  if (d0 > 0 !== d1 > 0) {
    const denom = d0 - d1;
    if (denom !== 0) {
      const u = d0 / denom;
      const ix = p0x + (p1x - p0x) * u;
      const iy = p0y + (p1y - p0y) * u;
      const iz = p0z + (p1z - p0z) * u;
      // barycentric inside test
      const vx = ix - ax,
        vy = iy - ay,
        vz = iz - az;
      const d00 = abx * abx + aby * aby + abz * abz;
      const d01 = abx * acx + aby * acy + abz * acz;
      const d11 = acx * acx + acy * acy + acz * acz;
      const d20 = vx * abx + vy * aby + vz * abz;
      const d21 = vx * acx + vy * acy + vz * acz;
      const den = d00 * d11 - d01 * d01;
      if (den !== 0) {
        const v = (d11 * d20 - d01 * d21) / den;
        const w = (d00 * d21 - d01 * d20) / den;
        if (v >= 0 && w >= 0 && v + w <= 1) {
          out.d2 = 0;
          out.ax = ix;
          out.ay = iy;
          out.az = iz;
          out.bx = ix;
          out.by = iy;
          out.bz = iz;
          out.s = u;
          out.t = 0;
          return 0;
        }
      }
    }
  }

  let best = Infinity;

  // Endpoints before edges, with strict improvement, retain the original tie order.
  for (let endpoint = 0; endpoint < 2; endpoint++) {
    const px = endpoint === 0 ? p0x : p1x;
    const py = endpoint === 0 ? p0y : p1y;
    const pz = endpoint === 0 ? p0z : p1z;
    closestPtPointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, _tmp);
    const ex = px - _tmp.bx,
      ey = py - _tmp.by,
      ez = pz - _tmp.bz;
    const d = ex * ex + ey * ey + ez * ez;
    if (d < best) {
      best = d;
      out.ax = px;
      out.ay = py;
      out.az = pz;
      out.bx = _tmp.bx;
      out.by = _tmp.by;
      out.bz = _tmp.bz;
      out.s = endpoint;
    }
  }

  // Segment vs triangle edges AB, BC, CA; strict improvement preserves tie order.
  let d = closestPtSegSeg(p0x, p0y, p0z, p1x, p1y, p1z, ax, ay, az, bx, by, bz, _tmp);
  if (d < best) {
    best = d;
    out.ax = _tmp.ax;
    out.ay = _tmp.ay;
    out.az = _tmp.az;
    out.bx = _tmp.bx;
    out.by = _tmp.by;
    out.bz = _tmp.bz;
    out.s = _tmp.s;
  }
  d = closestPtSegSeg(p0x, p0y, p0z, p1x, p1y, p1z, bx, by, bz, cx, cy, cz, _tmp);
  if (d < best) {
    best = d;
    out.ax = _tmp.ax;
    out.ay = _tmp.ay;
    out.az = _tmp.az;
    out.bx = _tmp.bx;
    out.by = _tmp.by;
    out.bz = _tmp.bz;
    out.s = _tmp.s;
  }
  d = closestPtSegSeg(p0x, p0y, p0z, p1x, p1y, p1z, cx, cy, cz, ax, ay, az, _tmp);
  if (d < best) {
    best = d;
    out.ax = _tmp.ax;
    out.ay = _tmp.ay;
    out.az = _tmp.az;
    out.bx = _tmp.bx;
    out.by = _tmp.by;
    out.bz = _tmp.bz;
    out.s = _tmp.s;
  }

  out.d2 = best;
  return best;
}

// Shared solve results; single-threaded and allocation-free.
let sphereB = 0;
let sphereSq = 0;
const cyl = { m: 0, n: 0, A: 0, B: 0, C: 0 };

/** Ray vs sphere as t = -sphereB ∓ sphereSq; false when the ray misses. */
function sphereRoots(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number
): boolean {
  const mx = ox - cx,
    my = oy - cy,
    mz = oz - cz;
  sphereB = mx * dx + my * dy + mz * dz;
  const disc = sphereB * sphereB - (mx * mx + my * my + mz * mz - r * r);
  if (disc < 0) return false;
  sphereSq = Math.sqrt(disc);
  return true;
}

/** Ray vs sphere. Returns entry distance or -1. */
export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  maxDist: number
): number {
  if (!sphereRoots(ox, oy, oz, dx, dy, dz, cx, cy, cz, r)) return -1;
  let t = -sphereB - sphereSq;
  if (t < 0) t = -sphereB + sphereSq; // origin inside
  return t < 0 || t > maxDist ? -1 : t;
}

/**
 * Ray vs the infinite cylinder around segment a..b. Fills `cyl`: the axial
 * parameter at t is n + t·m and the radial roots solve A t² + B t + C = 0.
 * Returns false for a degenerate segment.
 */
function solveCylinder(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  ax: number,
  ay: number,
  az: number,
  abx: number,
  aby: number,
  abz: number,
  r: number
): boolean {
  const abab = abx * abx + aby * aby + abz * abz;
  if (abab < EPS) return false;
  const aox = ox - ax,
    aoy = oy - ay,
    aoz = oz - az;
  const m = (cyl.m = (abx * dx + aby * dy + abz * dz) / abab);
  const n = (cyl.n = (abx * aox + aby * aoy + abz * aoz) / abab);
  const qx = dx - abx * m,
    qy = dy - aby * m,
    qz = dz - abz * m;
  const sx = aox - abx * n,
    sy = aoy - aby * n,
    sz = aoz - abz * n;
  cyl.A = qx * qx + qy * qy + qz * qz;
  cyl.B = 2 * (qx * sx + qy * sy + qz * sz);
  cyl.C = sx * sx + sy * sy + sz * sz - r * r;
  return true;
}

/**
 * Ray vs capsule (segment a..b, radius r). Returns distance or -1.
 * Solved as ray-vs-infinite-cylinder clipped by the two end spheres.
 */
export function rayCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
  maxDist: number
): number {
  if (!solveCylinder(ox, oy, oz, dx, dy, dz, ax, ay, az, bx - ax, by - ay, bz - az, r))
    return raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r, maxDist);
  const { m, n, A, B, C } = cyl;
  let best = -1;
  if (A > EPS) {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      let t = (-B - sq) / (2 * A);
      if (t < 0) t = (-B + sq) / (2 * A);
      if (t >= 0 && t <= maxDist) {
        const k = n + t * m;
        if (k >= 0 && k <= 1) best = t;
      }
    }
  } else if (C <= 0) {
    best = 0; // ray parallel to axis and already inside the cylinder
  }
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r, maxDist);
  if (t1 >= 0 && (best < 0 || t1 < best)) best = t1;
  const t2 = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r, maxDist);
  if (t2 >= 0 && (best < 0 || t2 < best)) best = t2;
  return best;
}

/** Last ray/capsule intersection. Origin may be on or inside the surface. */
export function rayCapsuleFar(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
  maxDist: number
): number {
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az;
  const EPS_T = 1e-4;
  let best = -1;
  if (!solveCylinder(ox, oy, oz, dx, dy, dz, ax, ay, az, abx, aby, abz, r)) {
    if (!sphereRoots(ox, oy, oz, dx, dy, dz, ax, ay, az, r)) return -1;
    const t = -sphereB + sphereSq;
    return t < 0 || t > maxDist ? -1 : t;
  }
  const { m, n, A, B, C } = cyl;
  if (A > EPS) {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const inv = 1 / (2 * A);
      for (let root = 0; root < 2; root++) {
        const t = (root === 0 ? -B - sq : -B + sq) * inv;
        const k = n + t * m;
        if (k >= 0 && k <= 1 && t > EPS_T && t <= maxDist && t > best) best = t;
      }
    }
  }

  for (let cap = 0; cap < 2; cap++) {
    const cx = cap === 0 ? ax : bx;
    const cy = cap === 0 ? ay : by;
    const cz = cap === 0 ? az : bz;
    if (!sphereRoots(ox, oy, oz, dx, dy, dz, cx, cy, cz, r)) continue;
    for (let root = 0; root < 2; root++) {
      const t = root === 0 ? -sphereB - sphereSq : -sphereB + sphereSq;
      if (t <= EPS_T || t > maxDist) continue;
      const projection =
        (ox + dx * t - cx) * abx + (oy + dy * t - cy) * aby + (oz + dz * t - cz) * abz;
      if (cap === 0 ? projection > 0 : projection < 0) continue;
      if (t > best) best = t;
    }
  }
  return best;
}

/** Exit distance from inside an oriented box; negative means no exit in range. */
export function rayObbFar(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  inv: Readonly<Matrix4Tuple>,
  hx: number,
  hy: number,
  hz: number,
  maxDist: number
): number {
  const x = inv[0] * ox + inv[4] * oy + inv[8] * oz + inv[12];
  const y = inv[1] * ox + inv[5] * oy + inv[9] * oz + inv[13];
  const z = inv[2] * ox + inv[6] * oy + inv[10] * oz + inv[14];
  const vx = inv[0] * dx + inv[4] * dy + inv[8] * dz;
  const vy = inv[1] * dx + inv[5] * dy + inv[9] * dz;
  const vz = inv[2] * dx + inv[6] * dy + inv[10] * dz;
  const t = Math.min(
    Math.abs(vx) > EPS ? ((vx > 0 ? hx : -hx) - x) / vx : Infinity,
    Math.abs(vy) > EPS ? ((vy > 0 ? hy : -hy) - y) / vy : Infinity,
    Math.abs(vz) > EPS ? ((vz > 0 ? hz : -hz) - z) / vz : Infinity
  );
  return t > EPS && t <= maxDist ? t : -1;
}

/** Ray vs oriented box. `inv` is the world->local matrix elements (Matrix4.elements). */
export function rayObb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  inv: Readonly<Matrix4Tuple>,
  hx: number,
  hy: number,
  hz: number,
  maxDist: number
): number {
  const lx = inv[0] * ox + inv[4] * oy + inv[8] * oz + inv[12];
  const ly = inv[1] * ox + inv[5] * oy + inv[9] * oz + inv[13];
  const lz = inv[2] * ox + inv[6] * oy + inv[10] * oz + inv[14];
  const ldx = inv[0] * dx + inv[4] * dy + inv[8] * dz;
  const ldy = inv[1] * dx + inv[5] * dy + inv[9] * dz;
  const ldz = inv[2] * dx + inv[6] * dy + inv[10] * dz;
  const t = rayAabb(
    lx,
    ly,
    lz,
    1 / (ldx || 1e-30),
    1 / (ldy || 1e-30),
    1 / (ldz || 1e-30),
    -hx,
    -hy,
    -hz,
    hx,
    hy,
    hz,
    maxDist
  );
  return t === Infinity ? -1 : t;
}
