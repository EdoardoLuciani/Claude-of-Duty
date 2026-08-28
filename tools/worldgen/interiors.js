import * as THREE from 'three';
import { BOX, BOX_FINE, BOX_THIN, IDENT, LL, rubbleMound } from './kit.js';
import { clothGeometry, patchGeometry, chamferBox, fillMasks } from './util.js';

function inDoorway(r, x, z, rad = 0.85) {
  for (const d of r.doors ?? []) {
    const dx = x - d.x;
    const dz = z - d.z;
    if (dx * dx + dz * dz < rad * rad) return true;
  }
  return false;
}

/** The room edge is the building's outer wall (and so may be a shopfront hole). */
function sideOnEnvelope(r, side, s) {
  const e = r.envelope;
  if (!e) return false;
  if (side === 0 && Math.abs(s.pz - e.z0) < 0.3) return true;
  if (side === 2 && Math.abs(s.pz - e.z1) < 0.3) return true;
  if (side === 3 && Math.abs(s.px - e.x0) < 0.3) return true;
  if (side === 1 && Math.abs(s.px - e.x1) < 0.3) return true;
  return false;
}

/** Room edge is a real wall (envelope or a partition covering most of it). */
function sideIsWall(r, side, s) {
  const e = r.envelope;
  if (e) {
    if (side === 0 && Math.abs(s.pz - e.z0) < 0.3) return true;
    if (side === 2 && Math.abs(s.pz - e.z1) < 0.3) return true;
    if (side === 3 && Math.abs(s.px - e.x0) < 0.3) return true;
    if (side === 1 && Math.abs(s.px - e.x1) < 0.3) return true;
  }
  const hit = (u0, u1, v0, v1) =>
    Math.max(0, Math.min(Math.max(u0, u1), Math.max(v0, v1)) - Math.max(Math.min(u0, u1), Math.min(v0, v1)));
  let span = 0;
  for (const w of r.partitions ?? []) {
    if ((side === 0 || side === 2) && Math.abs(w.z1 - w.z0) < 0.25 && Math.abs(s.pz - w.z0) < 0.3) {
      span += hit(w.x0, w.x1, r.x0, r.x1);
    } else if ((side === 1 || side === 3) && Math.abs(w.x1 - w.x0) < 0.25 && Math.abs(s.px - w.x0) < 0.3) {
      span += hit(w.z0, w.z1, r.z0, r.z1);
    }
  }
  return span >= s.len * 0.8;
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
    A.put(
      'litter',
      rng.range(x0 + 0.2, x1 - 0.2),
      y + 0.015,
      rng.range(z0 + 0.2, z1 - 0.2),
      rng.float() * 6.28,
      rng.range(0.7, 1.3),
      [1, 1.3, 1]
    );
  }
  for (let i = 0; i < rng.int(2, 5); i++) {
    A.put(
      rng.pick(['brick_a', 'brick_b', 'rock_b']),
      rng.range(x0 + 0.25, x1 - 0.25),
      y + 0.04,
      rng.range(z0 + 0.25, z1 - 0.25),
      rng.float() * 6.28,
      rng.range(0.5, 1.0),
      [1, 1.4, 1]
    );
  }

  if (kind === 'shop') furnishShop(A, rng, r, cx, cz, w, d);
  else if (kind === 'living') furnishLiving(A, rng, r, cx, cz);
  else if (kind === 'ruin') furnishRuin(A, rng, r, cx, cz);

  // Everything above dresses the MIDDLE of the room. An interior camera is
  // almost always 2-3 m off a wall, so the walls and the wall/floor junction
  // are most of the frame and have to carry the shot on their own.
  dressWalls(A, rng, r);
  dressCeiling(A, rng, r);

  // hanging bulb, roughly central, offset so it isn't dead centre
  if (kind !== 'ruin' || rng.float() < 0.5) {
    hangingBulb(A, rng, cx + rng.range(-0.8, 0.8), y + h - 0.05, cz + rng.range(-0.8, 0.8));
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
    /**
     * The building's street side is a shopfront: a 3 m hole, not a wall. Any
     * shelf, conduit run or leaning sheet placed on it hangs in mid-air across
     * the opening — which is exactly how it looked the first time round.
     */
    const isOpening = side === r.street;
    const solid = !isOpening && sideIsWall(r, side, s);
    /**
     * ...but the piers each side of that opening are wall, and in the canonical
     * interior camera they are two thirds of the frame. So the opening face is
     * not skipped outright: everything above floor level is confined to the
     * outer 30% of its length, which is pier in every bay layout here.
     */
    const pierT = () =>
      (rng.float() < 0.5 ? -1 : 1) * rng.range(half * 0.62, half) ;
    const anyT = () => rng.range(-half, half);
    const wallT = isOpening ? pierT : anyT;
    const dressUp = solid || isOpening;
    /**
     * An "opening" side whose edge is not the building's outer wall is an
     * interior partition — and partitions can stop short of the side's end.
     * Anything hung past the partition's end floats in the open room, so
     * wall-mounted dressing is only added where actual wall runs behind it.
     */
    const backedByWall = (t) => {
      if (solid) return true;
      if (!isOpening) return false;
      if (sideOnEnvelope(r, side, s)) return true;
      const [wx, wz] = at(s, t, 0.05);
      for (const w of r.partitions ?? []) {
        if (
          wx > Math.min(w.x0, w.x1) - 0.35 && wx < Math.max(w.x0, w.x1) + 0.35 &&
          wz > Math.min(w.z0, w.z1) - 0.35 && wz < Math.max(w.z0, w.z1) + 0.35
        ) return true;
      }
      return false;
    };

    // ---- surface conduit: two drops and a run under the ceiling ----------
    if (dressUp && rng.float() < 0.8) {
      const pipe = A.cache('conduit', () => {
        const g = new THREE.CylinderGeometry(0.016, 0.016, 1, 6, 1);
        fillMasks(g, 0.35, 0.5, 0.1);
        return g;
      });
      const runY = y + h - rng.range(0.18, 0.4);
      const t0 = isOpening ? wallT() : rng.range(-half, 0);
      const t1 = isOpening
        ? t0 + Math.sign(-t0 || 1) * rng.range(0.3, 0.55)
        : t0 + rng.range(0.8, Math.max(1.0, half - t0));
      // the drop, plus the junction box it feeds
      const dropT = rng.float() < 0.5 ? t0 : t1;
      const boxY = y + rng.range(1.15, 1.55);
      const flexRoll = rng.float();
      if (backedByWall(t0) && backedByWall(t1) && backedByWall(dropT)) {
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
      const sLen = Math.min(rng.range(isOpening ? 0.6 : 0.9, isOpening ? 1.0 : 1.8), s.len - 0.6);
      const st = isOpening
        ? wallT()
        : rng.range(-half + sLen / 2, half - sLen / 2);
      const [sx, sz] = at(s, st, 0.15);
      if (!inDoorway(r, sx, sz) && backedByWall(st)) {
        A.add('wood_prop_dark', BOX(A), LL(IDENT, sx, sy, sz, s.yaw, sLen, 0.035, 0.28), {
          masks: [0.85, 0.5, 0.15],
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
    if (solid && rng.float() < 0.5) {
      const lean = rng.range(0.13, 0.22);
      const lt = rng.range(-half, half);
      const lh = rng.range(1.1, 1.8);
      const lw = rng.range(0.5, 1.0);
      const off = 0.06 + (Math.sin(lean) * lh) / 2;
      const [lx, lz] = at(s, lt, off);
      const key = rng.pick(['plywood', 'corrugated', 'wood_prop_dark']);
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
    if (solid && rng.float() < 0.45) {
      const ht = wallT();
      const [hx, hz] = at(s, ht, 0.05);
      const hy = y + rng.range(1.3, 1.85);
      const cl = clothGeometry(rng.range(0.45, 0.8), rng.range(0.6, 1.0), {
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
  A.interiorLights?.push({ x, y: yCeil - drop - 0.05, z });
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
  const ccx = alongZ ? (r.street === 1 ? x1 - 1.3 : x0 + 1.3) : cx;
  const ccz = alongZ ? cz : frontZ ? cz - frontZ * (d * 0.5 - 1.3) : cz + d * 0.18;
  const clen = Math.min((alongZ ? d : w) - 1.4, 4.4);
  const cSX = alongZ ? 0.74 : clen;
  const cSZ = alongZ ? clen : 0.74;
  A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx, y + 0.9, ccz, 0, cSX, 0.06, cSZ), {
    masks: [0.9, 0.4, 0.1],
  });
  A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx + (alongZ ? -0.32 : 0), y + 0.45, ccz + (alongZ ? 0 : 0.32), 0, alongZ ? 0.09 : cSX, 0.9, alongZ ? cSZ : 0.09), {
    masks: [0.5, 0.6, 0.4],
  });
  A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx, y + 0.28, ccz, 0, cSX - 0.2, 0.04, cSZ - 0.2), {
    masks: [0.4, 0.7, 0.5],
  });
  for (let i = 0; i < 6; i++) {
    const t = rng.range(-clen / 2 + 0.3, clen / 2 - 0.3);
    const px = ccx + (alongZ ? rng.range(-0.22, 0.22) : t);
    const pz = ccz + (alongZ ? t : rng.range(-0.22, 0.22));
    if (rng.float() < 0.45) {
      A.put('tray', px, y + 0.94, pz, rng.range(-0.4, 0.4) + (alongZ ? Math.PI / 2 : 0), 1, [1, 1.1, 1]);
      A.put('produce', px, y + 0.96, pz, rng.float() * 6.28, 1, [1, 1, 1]);
    } else {
      A.put(
        rng.pick(['box_card_a', 'box_card_b', 'crate_b', 'bottle', 'can', 'bucket']),
        px,
        y + 0.94,
        pz,
        rng.float() * 6.28,
        rng.range(0.6, 0.9),
        [1, 1.15, 1]
      );
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
  // wall-hung rug / poster
  const wall = clothGeometry(1.7, 1.1, { segX: 8, segY: 7, sag: 0.04, wrinkle: 0.05, thickness: 0.0036, fray: 0.02, bow: -1, rng });
  A.addOnce('fabric_red', wall, LL(IDENT, cx - 0.4, y + 1.65, z0 + 0.09, 0, 1, 1, 1), {
    masks: [0.3, 0.4, 0.2],
  });
}

// ------------------------------------------------------------------- ruin --
function furnishRuin(A, rng, r, cx, cz) {
  const { y } = r;
  // The sheet reuses the mound's offset so it always lies over the rubble.
  // The old independent sheet offsets are still drawn (and discarded) so the
  // rng stream — and with it every placement downstream — stays identical.
  const mx = cx + rng.range(-1, 1);
  const mz = cz + rng.range(-1, 1);
  const mr = rng.range(1.4, 2.2);
  if (!inDoorway(r, cx, cz, 1.2)) {
    rubbleMound(A, rng, mx, y, mz, mr, 22);
  }
  // dust sheet lying over the rubble: belly down to the floor, edges propped
  // by the rocks under it
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
