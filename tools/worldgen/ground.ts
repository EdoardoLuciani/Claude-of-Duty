import * as THREE from 'three';

import type { Assembler } from './builder.ts';
import { BOX, BOX_SOFT, IDENT, LL } from './kit.ts';
import { STREET, ALLEYS } from './level/layout.ts';
import { ALLEY_MOUTHS, groundY } from './queries.ts';
import { fbm3, keyedRng, paintMasks } from './util.ts';

/**
 * WORLD — ground plane, road, kerbs and the stuff wind piles against them.
 *
 * The road is a cambered, subdivided strip so it catches grazing sunlight; the
 * pavements are individual slabs with gaps, broken corners and sand drifts, and
 * the alleys are dirt. Collision is a handful of flat boxes rather than the
 * visual triangles, which keeps the BVH tiny and the character controller smooth.
 */
export function buildGround(A: Assembler): void {
  const { halfWidth: HW, kerb: KB, walkH: WH, zMin, zMax } = STREET;

  // ------------------------------------------------------------- terrain --
  // Sandy ground under everything, gently undulating so the horizon isn't a
  // ruler-straight line where it meets the buildings.
  const S = 168;
  const N = 42;
  const terrain = new THREE.PlaneGeometry(S, S, N, N);
  terrain.rotateX(-Math.PI / 2);
  const pa = terrain.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const z = pa.getZ(i);
    const inStreet = Math.abs(x) < KB + 1 && z > zMin && z < zMax;
    const h = inStreet ? 0 : (fbm3(x * 0.045, 7.3, z * 0.045, 3) - 0.5) * 1.1 + 0.02;
    pa.setY(i, h - 0.03);
  }
  terrain.computeVertexNormals();
  paintMasks(terrain, (x, y, z, nx, ny, nz, out): void => {
    out[1] = 0.25 + fbm3(x * 0.3, 1.1, z * 0.3, 2) * 0.4;
    out[0] = 0.2;
  });
  A.add('sand', terrain);
  terrain.dispose();

  // ---------------------------------------------------------------- road --
  const roadLen = zMax - zMin;
  const road = new THREE.PlaneGeometry(HW * 2, roadLen, 12, Math.round(roadLen / 2));
  road.rotateX(-Math.PI / 2);
  const rp = road.getAttribute('position');
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const z = rp.getZ(i);
    const camber = (1 - (x / HW) ** 2) * 0.055;
    const wear = (fbm3(x * 0.55 + 3, 2.2, z * 0.35, 3) - 0.5) * 0.07;
    // shallow ruts where wheels have polished the surface
    const rut = -Math.exp(-((Math.abs(x) - 1.6) ** 2) / 0.5) * 0.022;
    rp.setY(i, camber + wear + rut);
  }
  road.computeVertexNormals();
  paintMasks(road, (x, y, z, nx, ny, nz, out): void => {
    const n = fbm3(x * 0.7, 4.4, z * 0.7, 3);
    out[1] = 0.1 + Math.max(0, (Math.abs(x) - 3.4) / 1.5) * 0.35 + n * 0.18;
    out[0] = 0.2 + n * 0.3;
  });
  road.translate(0, 0, (zMin + zMax) / 2);
  A.add('road_dust', road);
  road.dispose();

  // ------------------------------------------------------- pavement slabs --
  for (const side of [-1, 1]) {
    const rng = keyedRng('pavement', side);
    const cx = (side * (KB + HW)) / 2;
    const wSlab = KB - HW;
    const mouths = ALLEY_MOUTHS.filter((mouth): boolean => mouth.side === side);
    for (const mouth of mouths) {
      const from = Math.max(zMin, mouth.z0);
      const to = Math.min(zMax, mouth.z1);
      A.add('dirt', BOX(A), LL(IDENT, cx, 0.035, (from + to) / 2, 0, wSlab, 0.07, to - from), {
        masks: [0.2, 0.7, 0.4],
      });
    }

    let z = zMin;
    while (z < zMax) {
      const segLen = rng.range(3.2, 6.5);
      const gap = rng.float() < 0.12 ? rng.range(0.6, 1.6) : 0.06;
      // Slabs over an alley's edge stay at kerb height without a stain patch.
      let legacyMouth = false;
      for (const a of ALLEYS) {
        const [ax0, az0, ax1, az1] = a.rect;
        const inX = side > 0 ? ax0 >= KB - 0.5 : ax1 <= -KB + 0.5;
        if (inX && z + segLen > az0 - 0.2 && z < az1 + 0.2) legacyMouth = true;
      }
      const h = legacyMouth ? WH : WH + rng.range(-0.012, 0.012);
      let ranges = [[z + gap / 2, z + segLen - gap / 2]];
      for (const mouth of mouths) {
        const next = [];
        for (const [from, to] of ranges) {
          if (mouth.z1 <= from || mouth.z0 >= to) next.push([from, to]);
          else {
            if (mouth.z0 > from) next.push([from, mouth.z0]);
            if (mouth.z1 < to) next.push([mouth.z1, to]);
          }
        }
        ranges = next;
      }
      for (const [from, to] of ranges) {
        if (to - from < 0.02) continue;
        const cz = (from + to) / 2;
        A.add('concrete', BOX_SOFT(A), LL(IDENT, cx, h / 2, cz, 0, wSlab - 0.05, h, to - from), {
          masks: [0.6, 0.45, 0.2],
        });
        A.add(
          'concrete',
          BOX_SOFT(A),
          LL(IDENT, side * (HW + 0.11), (h + 0.022) / 2, cz, 0, 0.22, h + 0.022, to - from),
          {
            masks: [0.95, 0.35, 0.1],
          }
        );
      }
      z += segLen + gap;
    }
  }

  // ------------------------------------------------------------- alleys --
  for (const a of ALLEYS) {
    const [x0, z0, x1, z1] = a.rect;
    // rects are not guaranteed min→max (east gravel yard is z0 > z1); a negative
    // scale inverts the mesh so the top is backface-culled and seam stones float.
    const xa = Math.min(x0, x1),
      xb = Math.max(x0, x1);
    const za = Math.min(z0, z1),
      zb = Math.max(z0, z1);
    A.add(
      a.surface,
      BOX(A),
      LL(IDENT, (xa + xb) / 2, 0.03, (za + zb) / 2, 0, xb - xa, 0.06, zb - za),
      {
        masks: [0.2, 0.6, 0.35],
      }
    );
  }

  // --------------------------------------------------- material seams --
  // Every place two ground materials meet is otherwise a razor-straight polygon
  // edge with a value step across it — the loudest artefact in any low-angle
  // shot. Loose stones lying across the line break it up.
  const seam = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    keyA: string,
    keyB: string
  ): void => {
    const sr = keyedRng('seam', ax, az, bx, bz, keyA, keyB);
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(6, Math.round(len / 1.15));
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    // unit normal across the seam
    const nxs = -tz;
    const nzs = tx;
    for (let i = 0; i < n; i++) {
      const t = ((i + sr.range(0.15, 0.85)) / n) * len;
      const px = ax + tx * t;
      const pz = az + tz * t;
      // loose stones lying across the join
      if (A.has('rock_b')) {
        for (let k = 0; k < sr.int(1, 3); k++) {
          const off = sr.range(-0.55, 0.55);
          const sx = px + nxs * off + sr.range(-0.2, 0.2);
          const sz = pz + nzs * off + sr.range(-0.2, 0.2);
          const sy = Math.min(
            groundY(sx, sz),
            groundY(sx - 0.4, sz),
            groundY(sx + 0.4, sz),
            groundY(sx, sz - 0.4),
            groundY(sx, sz + 0.4)
          );
          A.put(
            sr.float() < 0.68 ? 'rock_b' : 'rock_a',
            sx,
            sy,
            sz,
            sr.float() * 6.28,
            sr.range(0.45, 1.0),
            [1, sr.range(1.0, 1.5), 1]
          );
        }
      }
    }
  };
  // The gutter, where the road surface meets the pavement: the seam the eye
  // lands on first in any street-level frame.
  seam(-HW + 0.08, zMin + 2, -HW + 0.08, zMax - 2, 'sand', 'road_dust');
  seam(HW - 0.08, zMin + 2, HW - 0.08, zMax - 2, 'sand', 'road_dust');
  // the pavement / open-ground line down both sides of the street, and the
  // perimeter of every alley and courtyard where its floor meets the sand
  seam(-KB, zMin + 2, -KB, zMax - 2, 'concrete', 'sand');
  seam(KB, zMin + 2, KB, zMax - 2, 'concrete', 'sand');
  for (const a of ALLEYS) {
    const [ax0, az0, ax1, az1] = a.rect;
    seam(ax0, az0, ax1, az0, a.surface, 'sand');
    seam(ax0, az1, ax1, az1, a.surface, 'sand');
    seam(ax0, az0, ax0, az1, a.surface, 'sand');
    seam(ax1, az0, ax1, az1, a.surface, 'sand');
  }

  // ------------------------------------------------------------ covers --
  // manholes and gully gratings
  for (let i = 0; i < 7; i++) {
    const rng = keyedRng('manhole', i);
    const z = rng.range(zMin + 6, zMax - 6);
    const x = rng.range(-2.5, 2.5);
    const ring = A.cache('manhole', (): THREE.BufferGeometry => {
      const g = new THREE.CylinderGeometry(0.36, 0.36, 0.04, 18, 1);
      paintMasks(g, (px, py, pz, nx, ny, nz, out): void => {
        out[0] = ny > 0.5 ? 0.95 : 0.4;
        out[1] = 0.55;
      });
      return g;
    });
    A.add(
      'metal_dark',
      ring,
      LL(IDENT, x, 0.035 + (1 - (x / HW) ** 2) * 0.05, z, rng.float() * 6.28, 1, 1, 1)
    );
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const z = keyedRng('gully', side, i).range(zMin + 8, zMax - 8);
      A.add(
        'metal_dark',
        BOX(A),
        LL(IDENT, side * (HW - 0.22), WH - 0.03, z, 0, 0.42, 0.05, 0.62),
        { masks: [0.7, 0.8, 0.6] }
      );
    }
  }
}
