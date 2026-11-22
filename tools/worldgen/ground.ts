import * as THREE from 'three';

import type { Assembler } from './builder.ts';
import { BOX, BOX_SOFT, IDENT, LL } from './kit.ts';
import { GULLIES, MANHOLES } from './level/ground-covers.ts';
import { GROUND_STONES } from './level/ground-stones.ts';
import { STREET, ALLEYS } from './level/layout.ts';
import { PAVEMENT } from './level/pavement.ts';
import { ALLEY_MOUTHS, seatY } from './queries.ts';
import { fbm3, paintMasks } from './util.ts';

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

    for (const [from, to, h] of PAVEMENT[side]) {
      if (mouths.some((mouth): boolean => from < mouth.z1 - 0.001 && to > mouth.z0 + 0.001))
        throw new Error(`[world] pavement ${from}..${to} on side ${side} covers an alley mouth`);
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

  // Small loose stones at the street and alley material seams.
  for (const [name, x, z, yaw, scale, grime] of GROUND_STONES)
    A.put(name, x, seatY(x, z), z, yaw, scale, [1, grime, 1]);

  // ------------------------------------------------------------ covers --
  // manholes and gully gratings
  for (const [x, z, yaw] of MANHOLES) {
    const ring = A.cache('manhole', (): THREE.BufferGeometry => {
      const g = new THREE.CylinderGeometry(0.36, 0.36, 0.04, 18, 1);
      paintMasks(g, (px, py, pz, nx, ny, nz, out): void => {
        out[0] = ny > 0.5 ? 0.95 : 0.4;
        out[1] = 0.55;
      });
      return g;
    });
    A.add('metal_dark', ring, LL(IDENT, x, 0.035 + (1 - (x / HW) ** 2) * 0.05, z, yaw, 1, 1, 1));
  }
  for (const [side, z] of GULLIES)
    A.add('metal_dark', BOX(A), LL(IDENT, side * (HW - 0.22), WH - 0.03, z, 0, 0.42, 0.05, 0.62), {
      masks: [0.7, 0.8, 0.6],
    });
}
