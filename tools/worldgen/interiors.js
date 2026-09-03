import * as THREE from 'three';
import { BOX, BOX_FINE, BOX_THIN, IDENT, LL, rubbleMound } from './kit.js';
import { clothGeometry, patchGeometry, chamferBox, fillMasks } from './util.js';

function inDoorway(r, x, z, rad = 1.25) {
  for (const d of r.doors) {
    const dx = x - d.x;
    const dz = z - d.z;
    if (dx * dx + dz * dz < rad * rad) return true;
  }
  return false;
}

/** The room edge is the building's outer wall. */
function sideOnEnvelope(r, side, s) {
  const e = r.envelope;
  if (side === 0) return Math.abs(s.pz - e.z0) < 0.3;
  if (side === 2) return Math.abs(s.pz - e.z1) < 0.3;
  if (side === 3) return Math.abs(s.px - e.x0) < 0.3;
  return Math.abs(s.px - e.x1) < 0.3;
}

const overlap = (a0, a1, b0, b1) =>
  Math.max(0, Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1)));

/** True when the full footprint is backed by wall, excluding openings. */
export function wallBacking(r, side, t0, t1, y0, y1) {
  const horizontal = side === 0 || side === 2;
  const edge = side === 0 ? r.z0 : side === 2 ? r.z1 : side === 3 ? r.x0 : r.x1;
  const onEnvelope = horizontal
    ? Math.abs(edge - (side === 0 ? r.envelope.z0 : r.envelope.z1)) < 0.3
    : Math.abs(edge - (side === 3 ? r.envelope.x0 : r.envelope.x1)) < 0.3;
  const c0 = Math.min(t0, t1);
  const c1 = Math.max(t0, t1);

  if (onEnvelope) {
    for (const opening of r.facadeOpenings) {
      if (opening.side !== side) continue;
      const oc = horizontal ? opening.x : opening.z;
      if (
        overlap(c0, c1, oc - opening.w / 2, oc + opening.w / 2) > 0.001 &&
        overlap(y0, y1, opening.y0, opening.y1) > 0.001
      ) return false;
    }
    return true;
  }

  let covered = 0;
  for (const wall of r.partitions) {
    const aligned = horizontal
      ? Math.abs(wall.z1 - wall.z0) < 0.25 && Math.abs(edge - wall.z0) < 0.3
      : Math.abs(wall.x1 - wall.x0) < 0.25 && Math.abs(edge - wall.x0) < 0.3;
    if (!aligned) continue;
    const a0 = horizontal ? wall.x0 : wall.z0;
    const a1 = horizontal ? wall.x1 : wall.z1;
    covered += overlap(c0, c1, a0, a1);
  }
  if (covered < c1 - c0 - 0.02) return false;

  // Partition door records are centre points; their authored clear width is
  // 1.05 m and their height is 2.36 m.
  if (overlap(y0, y1, r.y, r.y + 2.36) > 0.001) {
    for (const door of r.doors) {
      const dc = horizontal ? door.x : door.z;
      if (overlap(c0, c1, dc - 0.525, dc + 0.525) > 0.001) return false;
    }
  }
  return true;
}

/**
 * WORLD — procedural interior micro-detail.
 *
 * Gameplay-significant furniture and floor props are explicitly authored in
 * placements/interiors.js. This module only builds attached dressing and small
 * debris whose exact transform does not affect traversal.
 */

/** Furnish one room. Rect is in level space; y is the floor surface. */
export function furnishRoom(A, rng, r) {
  const { kind, x0, z0, x1, z1, y, h } = r;
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z1 - z0);
  if (w < 1.2 || d < 1.2) return;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  // floor dressing everybody gets: dust patches, plaster fall, litter
  const patches = rng.int(2, 4);
  for (let i = 0; i < patches; i++) {
    const g = patchGeometry(rng, rng.range(0.4, 1.1), { lobes: 8, wobble: 0.5 });
    A.addOnce(
      'dirt',
      g,
      LL(IDENT, rng.range(x0 + 0.3, x1 - 0.3), y + 0.012, rng.range(z0 + 0.3, z1 - 0.3), rng.float() * 6.28),
      { masks: [0.1, 0.8, 0.5] }
    );
  }
  for (let i = 0; i < rng.int(4, 9); i++) {
    const px = rng.range(x0 + 0.2, x1 - 0.2);
    const pz = rng.range(z0 + 0.2, z1 - 0.2);
    const ry = rng.float() * 6.28;
    const scale = rng.range(0.7, 1.3);
    if (!inDoorway(r, px, pz)) A.put('litter', px, y + 0.015, pz, ry, scale, [1, 1.3, 1]);
  }
  for (let i = 0; i < rng.int(2, 5); i++) {
    const prototype = rng.pick(['brick_a', 'brick_b', 'rock_b']);
    const px = rng.range(x0 + 0.25, x1 - 0.25);
    const pz = rng.range(z0 + 0.25, z1 - 0.25);
    const ry = rng.float() * 6.28;
    const scale = rng.range(0.5, 1.0);
    if (!inDoorway(r, px, pz)) A.put(prototype, px, y + 0.04, pz, ry, scale, [1, 1.4, 1]);
  }

  if (kind === 'shop') furnishShop(A, rng, r, cx, cz, w, d);
  else if (kind === 'living') furnishLiving(A, rng, r, cx, cz);
  else if (kind === 'storage' && r.detail) furnishStorage(A, rng, r, cx, cz, w, d);
  else if (kind === 'workshop') furnishWorkshop(A, rng, r, cx, cz, w, d);
  else if (kind === 'ruin') furnishRuin(A, rng, r, cx, cz);

  // Everything above dresses the MIDDLE of the room. An interior camera is
  // almost always 2-3 m off a wall, so the walls and the wall/floor junction
  // are most of the frame and have to carry the shot on their own.
  dressWalls(A, rng, r);
  dressCeiling(A, rng, r);

  // hanging bulb, roughly central, offset so it isn't dead centre
  if (kind !== 'ruin' || rng.float() < 0.5) {
    hangingBulb(
      A,
      rng,
      cx + rng.range(-0.8, 0.8),
      y + h - 0.05,
      cz + rng.range(-0.8, 0.8)
    );
  }
}

/**
 * WALL DRESSING.
 *
 * Runs on every furnished room, along all four walls. A bare interior wall is
 * the single flattest thing a renderer can show you, and the interior shot
 * scored lowest of the eleven for exactly that reason: "zero props, bare stud
 * walls and empty boxes". Each wall gets, at random:
 *
 *   - a plank shelf on two brackets with goods on it
 *   - surface-run electrical conduit and a junction box (every building here
 *     is wired on the surface, and a 3 m vertical line breaks a flat panel
 *     better than any amount of noise)
 *   - something leaning against it at 8-12 degrees
 *   - a swept wedge of dust and plaster fall in the junction itself
 *
 * Everything is placed in contact: the leaning objects touch top and bottom,
 * and the dust wedge straddles the floor join so nothing reads as a decal
 * pasted onto a plane.
 */
function dressWalls(A, rng, r) {
  const { x0, z0, x1, z1, y, h, kind } = r;
  const sides = [
    { px: (x0 + x1) / 2, pz: z0, tx: 1, tz: 0, nx: 0, nz: 1, len: x1 - x0, yaw: 0 },
    { px: x1, pz: (z0 + z1) / 2, tx: 0, tz: 1, nx: -1, nz: 0, len: z1 - z0, yaw: Math.PI / 2 },
    { px: (x0 + x1) / 2, pz: z1, tx: 1, tz: 0, nx: 0, nz: -1, len: x1 - x0, yaw: 0 },
    { px: x0, pz: (z0 + z1) / 2, tx: 0, tz: -1, nx: 1, nz: 0, len: z1 - z0, yaw: Math.PI / 2 },
  ];

  const at = (s, t, off) => [s.px + s.tx * t + s.nx * off, s.pz + s.tz * t + s.nz * off];

  for (let side = 0; side < 4; side++) {
    const s = sides[side];
    if (s.len < 1.6) continue;
    const half = s.len / 2 - 0.35;
    const horizontal = side === 0 || side === 2;
    const tangentAt = (t) => horizontal ? s.px + s.tx * t : s.pz + s.tz * t;
    const backedByWall = (t, halfWidth, y0, y1) => {
      const c = tangentAt(t);
      return wallBacking(r, side, c - halfWidth, c + halfWidth, y0, y1);
    };
    const dressUp = sideOnEnvelope(r, side, s) || r.partitions.some((wall) => {
      if (horizontal) return Math.abs(wall.z1 - wall.z0) < 0.25 && Math.abs(s.pz - wall.z0) < 0.3;
      return Math.abs(wall.x1 - wall.x0) < 0.25 && Math.abs(s.px - wall.x0) < 0.3;
    });
    const wallT = () => rng.range(-half, half);

    // ---- surface conduit: two drops and a run under the ceiling ----------
    if (dressUp && rng.float() < 0.8) {
      const pipe = A.cache('conduit', () => {
        const g = new THREE.CylinderGeometry(0.016, 0.016, 1, 6, 1);
        fillMasks(g, 0.35, 0.5, 0.1);
        return g;
      });
      const runY = y + h - rng.range(0.18, 0.4);
      const t0 = rng.range(-half, 0);
      const t1 = t0 + rng.range(0.8, Math.max(1.0, half - t0));
      // the drop, plus the junction box it feeds
      const dropT = rng.float() < 0.5 ? t0 : t1;
      const boxY = y + rng.range(1.15, 1.55);
      const flexRoll = rng.float();
      const runMid = (t0 + t1) / 2;
      const runHalf = Math.abs(t1 - t0) / 2 + 0.03;
      const dropHalf = 0.11;
      if (
        backedByWall(runMid, runHalf, runY - 0.03, runY + 0.03) &&
        backedByWall(dropT, dropHalf, boxY - 0.38, runY + 0.03)
      ) {
        const [rx0, rz0] = at(s, (t0 + t1) / 2, 0.045);
        A.add(
          'metal_dark',
          pipe,
          LL(IDENT, rx0, runY, rz0, s.yaw, 1, Math.abs(t1 - t0), 1, 0, Math.PI / 2)
        );
        const [dx, dz] = at(s, dropT, 0.045);
        A.add('metal_dark', pipe, LL(IDENT, dx, (runY + boxY) / 2, dz, 0, 1, runY - boxY, 1));
        A.add('metal_dark', BOX_FINE(A), LL(IDENT, ...insert(at(s, dropT, 0.055), boxY), s.yaw, 0.15, 0.19, 0.09), {
          masks: [0.55, 0.5, 0.2],
        });
        // and a stub of flex hanging out of it
        if (flexRoll < 0.5) {
          A.add(
            'metal_dark',
            pipe,
            LL(IDENT, ...insert(at(s, dropT + 0.06, 0.05), boxY - 0.28), 0, 0.4, 0.34, 0.4)
          );
        }
      }
    }

    // ---- a plank shelf on two brackets, with goods --------------------------
    if (dressUp && kind !== 'ruin' && rng.float() < 0.55) {
      const sy = y + rng.range(1.05, 1.65);
      const sLen = Math.min(rng.range(0.9, 1.8), s.len - 0.6);
      const st = rng.range(-half + sLen / 2, half - sLen / 2);
      const [sx, sz] = at(s, st, 0.15);
      if (!inDoorway(r, sx, sz) && backedByWall(st, sLen / 2 + 0.03, sy - 0.2, sy + 0.22)) {
        A.add('wood_prop_dark', BOX(A), LL(IDENT, sx, sy, sz, s.yaw, sLen, 0.035, 0.28), {
          masks: [0.85, 0.5, 0.15],
          support: 'shelf',
        });
        for (const bt of [-1, 1]) {
          const [bx, bz] = at(s, st + bt * (sLen / 2 - 0.12), 0.1);
          A.add('metal_dark', BOX_FINE(A), LL(IDENT, bx, sy - 0.09, bz, s.yaw, 0.03, 0.16, 0.18), {
            masks: [0.6, 0.6, 0.3],
          });
        }
        for (let i = 0; i < rng.int(2, 5); i++) {
          const [gx, gz] = at(s, st + rng.range(-sLen / 2 + 0.12, sLen / 2 - 0.12), rng.range(0.11, 0.2));
          A.put(
            rng.pick(['bottle', 'can', 'box_card_b', 'bucket']),
            gx,
            sy + 0.02,
            gz,
            rng.float() * 6.28,
            rng.range(0.6, 0.95),
            [1, 1.1, 1]
          );
        }
      }
    }

    // ---- something leaning on it -------------------------------------------
    if (dressUp && rng.float() < 0.5) {
      const lean = rng.range(0.13, 0.22);
      const lt = rng.range(-half, half);
      const lh = rng.range(1.1, 1.8);
      const lw = rng.range(0.5, 1.0);
      const off = 0.06 + (Math.sin(lean) * lh) / 2;
      const [lx, lz] = at(s, lt, off);
      const key = rng.pick(['plywood', 'corrugated', 'wood_prop_dark']);
      if (!backedByWall(lt, lw / 2 + 0.04, y, y + lh)) continue;
      // Tip the top INTO the wall. After the yaw the sheet's local -Z faces
      // the wall on sides 0/3 and its +Z on sides 1/2, so the sign of the
      // tilt has to follow the inward normal or the sheet leans out into the
      // room and floats at both ends.
      const leanSign = s.nz !== 0 ? -s.nz : -s.nx;
      A.add(
        key,
        BOX_THIN(A),
        LL(IDENT, lx, y + (Math.cos(lean) * lh) / 2, lz, s.yaw, lw, lh, 0.022, leanSign * lean, 0),
        { masks: [0.7, 0.55, 0.3] }
      );
    }

    // ---- swept dust and plaster fall in the junction ------------------------
    // A wall does not meet a floor on a line. Three flat lobes straddling the
    // join plus a handful of chips is the cheapest thing that grounds a room.
    const nWedge = Math.max(2, Math.round(s.len / 1.5));
    for (let i = 0; i < nWedge; i++) {
      const wt = ((i + rng.range(0.2, 0.8)) / nWedge - 0.5) * s.len;
      const [wx, wz] = at(s, wt, rng.range(0.05, 0.3));
      const g = patchGeometry(rng, rng.range(0.3, 0.75), { lobes: 9, wobble: 0.55 });
      A.addOnce('dirt', g, LL(IDENT, wx, y + 0.011, wz, rng.float() * 6.28, 1, 1, rng.range(0.35, 0.6)), {
        masks: [0.1, 0.85, 0.55],
      });
      if (rng.float() < 0.7) {
        const [cx2, cz2] = at(s, wt + rng.range(-0.3, 0.3), rng.range(0.06, 0.34));
        if (inDoorway(r, cx2, cz2)) continue;
        A.put(
          rng.pick(['brick_a', 'brick_b', 'rock_b', 'litter', 'litter']),
          cx2,
          y + 0.03,
          cz2,
          rng.float() * 6.28,
          rng.range(0.45, 0.9),
          [1, 1.4, 1]
        );
      }
    }

    // ---- a sack or a cloth hung on a nail ----------------------------------
    if (dressUp && rng.float() < 0.45) {
      const ht = wallT();
      const [hx, hz] = at(s, ht, 0.05);
      const hy = y + rng.range(1.3, 1.85);
      const cw = rng.range(0.45, 0.8);
      const ch = rng.range(0.6, 1.0);
      if (!backedByWall(ht, cw / 2 + 0.03, hy - ch / 2, hy + ch / 2 + 0.05)) continue;
      const cl = clothGeometry(cw, ch, {
        segX: 6,
        segY: 7,
        sag: 0.1,
        wrinkle: 0.09,
        thickness: 0.003,
        fray: 0.014,
        rng,
      });
      A.addOnce(rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']), cl, LL(IDENT, hx, hy, hz, s.yaw), {
        masks: [0.35, 0.6, 0.3],
      });
      A.add('metal_dark', BOX_FINE(A), LL(IDENT, hx, hy + 0.34, hz, s.yaw, 0.02, 0.02, 0.05), {
        masks: [0.7, 0.5, 0],
      });
    }
  }
}

/** [x, z] + y -> the (x, y, z) argument triple LL wants. */
function insert(xz, y) {
  return [xz[0], y, xz[1]];
}

/**
 * Exposed structure overhead. A ceiling plane with nothing on it reads as the
 * inside of a box; joists, a conduit run and a hanging cable give the top of
 * the frame something to occlude and something for the bulb to rim-light.
 */
function dressCeiling(A, rng, r) {
  const { x0, z0, x1, z1, y, h } = r;
  const w = x1 - x0;
  const d = z1 - z0;
  if (h < 2.1 || w < 1.6 || d < 1.6) return;
  const alongX = w < d;
  const span = alongX ? w : d;
  const runLen = alongX ? d : w;
  const n = Math.max(2, Math.round(runLen / rng.range(0.75, 1.15)));
  for (let i = 1; i < n; i++) {
    const t = (i / n - 0.5) * runLen;
    const jx = alongX ? (x0 + x1) / 2 : (x0 + x1) / 2 + t;
    const jz = alongX ? (z0 + z1) / 2 + t : (z0 + z1) / 2;
    A.add(
      'wood_prop_dark',
      BOX(A),
      LL(
        IDENT,
        jx,
        y + h - 0.06,
        jz,
        alongX ? 0 : Math.PI / 2,
        span - 0.05,
        0.11,
        rng.range(0.055, 0.075)
      ),
      { masks: [0.35, 0.6, 0.45] }
    );
  }
}

/** Bare bulb on a twisted flex — the only light source in most of these rooms. */
function hangingBulb(A, rng, x, yCeil, z) {
  const drop = rng.range(0.35, 0.95);
  const wire = A.cache('bulbwire', () => {
    const g = new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1);
    fillMasks(g, 0.2, 0.4, 0);
    return g;
  });
  A.add('metal_dark', wire, LL(IDENT, x, yCeil - drop / 2, z, 0, 1, drop, 1));
  A.add('metal_dark', BOX_FINE(A), LL(IDENT, x, yCeil - 0.02, z, 0, 0.09, 0.04, 0.09), {
    masks: [0.5, 0.6, 0.3],
  });
  const bulb = A.cache('bulb', () => {
    const g = new THREE.SphereGeometry(0.045, 10, 7);
    g.scale(1, 1.25, 1);
    fillMasks(g, 0.1, 0.2, 0);
    return g;
  });
  A.add('emissive_warm', bulb, LL(IDENT, x, yCeil - drop - 0.05, z, 0, 1, 1, 1));
  A.add('metal_dark', BOX_FINE(A), LL(IDENT, x, yCeil - drop + 0.02, z, 0, 0.05, 0.06, 0.05), {
    masks: [0.6, 0.4, 0],
  });
  if (A.interiorLights.length < 15) A.interiorLights.push({ x, y: yCeil - drop - 0.05, z });
}

// --------------------------------------------------------------- storage --
function furnishStorage(A, rng, r, cx, cz, w, d) {
  const { y } = r;
  const alongX = w >= d;
  for (const offset of [-0.75, 0.75]) {
    const px = cx + (alongX ? offset : 0);
    const pz = cz + (alongX ? 0 : offset);
    const prototype = rng.pick(['crate_a', 'crate_b', 'box_card_a']);
    const ry = rng.range(-0.2, 0.2);
    if (!inDoorway(r, px, pz)) A.put(prototype, px, y, pz, ry, 1, [1, 1.15, 1]);
  }
  const bx = cx + (alongX ? 0 : 0.9);
  const bz = cz + (alongX ? 0.9 : 0);
  const bry = rng.float() * 6.28;
  if (!inDoorway(r, bx, bz)) A.put('barrel_rust', bx, y, bz, bry, 1, [1, 1.2, 1]);
}

// -------------------------------------------------------------- workshop --
function furnishWorkshop(A, rng, r, cx, cz, w, d) {
  const { y } = r;
  const alongX = w >= d;
  const tw = Math.min(2.2, (alongX ? w : d) - 1.4);
  if (inDoorway(r, cx, cz, tw / 2 + 0.5)) return;
  A.add(
    'wood_prop_dark',
    BOX(A),
    LL(IDENT, cx, y + 0.82, cz, alongX ? 0 : Math.PI / 2, tw, 0.09, 0.72),
    { masks: [0.8, 0.55, 0.25], support: 'counter' }
  );
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const ox = alongX ? sx * (tw / 2 - 0.12) : sz * 0.25;
      const oz = alongX ? sz * 0.25 : sx * (tw / 2 - 0.12);
      A.add('wood_prop_dark', BOX(A), LL(IDENT, cx + ox, y + 0.4, cz + oz, 0, 0.11, 0.8, 0.11), {
        masks: [0.65, 0.65, 0.35],
      });
    }
  }
  for (let i = 0; i < 4; i++) {
    const t = rng.range(-tw / 2 + 0.18, tw / 2 - 0.18);
    A.put(
      rng.pick(['can', 'bottle', 'box_card_b', 'gas_bottle']),
      cx + (alongX ? t : rng.range(-0.18, 0.18)),
      y + 0.88,
      cz + (alongX ? rng.range(-0.18, 0.18) : t),
      rng.float() * 6.28,
      rng.range(0.65, 0.9),
      [1, 1.1, 1]
    );
  }
}

// ------------------------------------------------------------------- shop --
function furnishShop(A, rng, r, cx, cz, w, d) {
  const { x0, x1, y } = r;
  const frontZ = r.street === 0 ? -1 : r.street === 2 ? 1 : 0;
  // rug on the floor
  addRug(A, rng, cx + rng.range(-0.5, 0.5), y, cz + rng.range(-0.5, 0.5), rng.range(1.6, 2.4));

  /**
   * The counter runs PARALLEL to the shop's frontage, a metre inside it, the way
   * a real market shop is arranged: it fills the lower third of the view out of
   * the shop with goods instead of walling the opening off.
   */
  const alongZ = r.street === 1 || r.street === 3;
  let ccx = alongZ ? (r.street === 1 ? x1 - 1.3 : x0 + 1.3) : cx;
  let ccz = alongZ ? cz : frontZ ? cz - frontZ * (d * 0.5 - 1.3) : cz + d * 0.18;
  let clen = Math.min((alongZ ? d : w) - 1.4, 4.4);
  const shop = r.facadeOpenings.find((opening) => opening.kind === 'shop' && opening.side === r.street);
  if (shop) {
    clen = Math.min(clen, Math.max(1.2, shop.w - 0.4));
    if (alongZ) ccz = shop.z;
    else ccx = shop.x;
  }
  const cSX = alongZ ? 0.74 : clen;
  const cSZ = alongZ ? clen : 0.74;
  let clear = true;
  for (let i = 0; i <= 6; i++) {
    const t = -clen / 2 + (i / 6) * clen;
    const px = ccx + (alongZ ? 0 : t);
    const pz = ccz + (alongZ ? t : 0);
    if (inDoorway(r, px, pz)) { clear = false; break; }
  }
  if (clear) {
    A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx, y + 0.9, ccz, 0, cSX, 0.06, cSZ), {
      masks: [0.9, 0.4, 0.1],
      support: 'counter',
    });
    A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx + (alongZ ? -0.32 : 0), y + 0.45, ccz + (alongZ ? 0 : 0.32), 0, alongZ ? 0.09 : cSX, 0.9, alongZ ? cSZ : 0.09), {
      masks: [0.5, 0.6, 0.4],
    });
    A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx, y + 0.28, ccz, 0, cSX - 0.2, 0.04, cSZ - 0.2), {
      masks: [0.4, 0.7, 0.5],
    });
  }
  const occupied = [];
  for (let i = 0; i < 6; i++) {
    const t = rng.range(-clen / 2 + 0.3, clen / 2 - 0.3);
    const px = ccx + (alongZ ? rng.range(-0.22, 0.22) : t);
    const pz = ccz + (alongZ ? t : rng.range(-0.22, 0.22));
    const hasRoom = occupied.every(([ox, oz]) => Math.hypot(px - ox, pz - oz) >= 0.68);
    if (rng.float() < 0.45) {
      const trayYaw = rng.range(-0.4, 0.4) + (alongZ ? Math.PI / 2 : 0);
      const produceYaw = rng.float() * 6.28;
      if (clear && hasRoom) {
        A.put('tray', px, y + 0.94, pz, trayYaw, 1, [1, 1.1, 1]);
        A.put('produce', px, y + 0.96, pz, produceYaw, 1, [1, 1, 1]);
        occupied.push([px, pz]);
      }
    } else {
      const prototype = rng.pick(['box_card_a', 'box_card_b', 'crate_b', 'bottle', 'can', 'bucket']);
      const yaw = rng.float() * 6.28;
      const scale = rng.range(0.6, 0.9);
      if (clear && hasRoom) {
        A.put(prototype, px, y + 0.94, pz, yaw, scale, [1, 1.15, 1]);
        occupied.push([px, pz]);
      }
    }
  }
}

// ----------------------------------------------------------------- living --
function furnishLiving(A, rng, r, cx, cz) {
  const { x0, z0, z1, y } = r;
  addRug(A, rng, cx, y, cz, rng.range(2.0, 2.8));
  // blanket
  const bl = clothGeometry(1.5, 0.9, { segX: 7, segY: 6, sag: 0.05, wrinkle: 0.05, thickness: 0.0032, fray: 0.012, rng });
  A.addOnce('fabric_teal', bl, LL(IDENT, x0 + 1.2, y + 0.19, z1 - 1.0, 0, 1, 1, 1, -Math.PI / 2), {
    masks: [0.3, 0.5, 0.2],
  });
  // cushions
  for (let i = 0; i < 3; i++) {
    const g = chamferBox(0.42, 0.14, 0.42, 0.06);
    fillMasks(g, 0.2, 0.4, 0.2);
    A.addOnce(
      rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']),
      g,
      LL(IDENT, cx + rng.range(-1, 1), y + 0.07, cz + rng.range(-1, 1), rng.float() * 6.28)
    );
  }
  // Prefer the near wall without bridging a facade opening.
  const rugX = cx - 0.4;
  const rugY = y + 1.65;
  const onNear = wallBacking(r, 0, rugX - 0.85, rugX + 0.85, rugY - 0.55, rugY + 0.55);
  const onFar = wallBacking(r, 2, rugX - 0.85, rugX + 0.85, rugY - 0.55, rugY + 0.55);
  const wall = clothGeometry(1.7, 1.1, { segX: 8, segY: 7, sag: 0.04, wrinkle: 0.05, thickness: 0.0036, fray: 0.02, bow: -1, rng });
  if (onNear || onFar) {
    A.addOnce(
      'fabric_red',
      wall,
      LL(IDENT, rugX, rugY, onNear ? z0 + 0.09 : z1 - 0.09, onNear ? 0 : Math.PI),
      { masks: [0.3, 0.4, 0.2] }
    );
  } else {
    wall.dispose();
  }
}

// ------------------------------------------------------------------- ruin --
function furnishRuin(A, rng, r, cx, cz) {
  const { y } = r;
  // Reuse the mound offset for the sheet, retaining the old RNG draw count.
  const mx = cx + rng.range(-1, 1);
  const mz = cz + rng.range(-1, 1);
  const mr = rng.range(1.4, 2.2);
  if (!inDoorway(r, mx, mz, mr + 0.45)) rubbleMound(A, rng, mx, y, mz, mr, 22);
  rng.range(-1.5, 1.5); // old sheet x offset, consumed for stream stability
  rng.range(-1.5, 1.5); // old sheet z offset
  const sYaw = rng.float() * 6.28;
  const sheet = clothGeometry(1.4, 1.1, { segX: 7, segY: 7, sag: 0.24, wrinkle: 0.075, twist: 0.08, fray: 0.02, rng });
  A.addOnce(
    'fabric_cream',
    sheet,
    LL(IDENT, mx, y + 0.25, mz, sYaw, 1, 1, 1, -Math.PI / 2),
    { masks: [0.4, 0.7, 0.3] }
  );
}

// ---------------------------------------------------------------- helpers --
function addRug(A, rng, x, y, z, size) {
  const g = clothGeometry(size, size * rng.range(0.55, 0.75), {
    segX: 8,
    segY: 6,
    sag: 0.0,
    wrinkle: 0.02,
    thickness: 0.0038,
    fray: 0.012,
    rng,
  });
  A.addOnce(
    rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']),
    g,
    LL(IDENT, x, y + 0.014, z, rng.range(-0.4, 0.4), 1, 1, 1, -Math.PI / 2),
    { masks: [0.45, 0.55, 0.25] }
  );
}
