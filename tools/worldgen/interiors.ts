import * as THREE from 'three';

import type { Assembler } from './builder.ts';
import type { BuildingInfo } from './buildings.ts';
import { BOX, BOX_FINE, BOX_THIN, IDENT, LL } from './kit.ts';
import type { CounterFootprint, RoomFixture, RoomProp } from './level/room-fixtures.ts';
import type { RectXZ } from './util.ts';
import { clothGeometry, chamferBox, fillMasks, rockGeometry } from './util.ts';

interface RoomSpec extends RectXZ {
  y: number;
  h: number;
  doors: { x: number; z: number }[];
  envelope: RectXZ;
  facadeOpenings: BuildingInfo['facadeOpenings'];
  partitions: RectXZ[];
  voids?: (RectXZ | undefined)[];
}

function inDoorway(r: Pick<RoomSpec, 'doors'>, x: number, z: number, rad = 1.25): boolean {
  for (const d of r.doors) {
    const dx = x - d.x;
    const dz = z - d.z;
    if (dx * dx + dz * dz < rad * rad) return true;
  }
  return false;
}

const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(
    0,
    Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1))
  );

function inVoid(r: Pick<RoomSpec, 'voids'>, x: number, z: number): boolean {
  for (const v of r.voids ?? []) {
    if (x >= v!.x0 && x <= v!.x1 && z >= v!.z0 && z <= v!.z1) return true;
  }
  return false;
}

function beamHitsVoid(
  r: Pick<RoomSpec, 'voids'>,
  alongX: boolean,
  jx: number,
  jz: number,
  span: number
): boolean {
  const h = span / 2;
  for (const v of r.voids ?? []) {
    if (alongX) {
      if (jz >= v!.z0 && jz <= v!.z1 && jx - h < v!.x1 && jx + h > v!.x0) return true;
    } else if (jx >= v!.x0 && jx <= v!.x1 && jz - h < v!.z1 && jz + h > v!.z0) return true;
  }
  return false;
}

/** True when the full footprint is backed by wall, excluding openings. */
function wallBacking(
  r: Pick<
    RoomSpec,
    'x0' | 'x1' | 'z0' | 'z1' | 'y' | 'envelope' | 'facadeOpenings' | 'partitions' | 'doors'
  >,
  side: number,
  t0: number,
  t1: number,
  y0: number,
  y1: number
): boolean {
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
      )
        return false;
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

/** Bare bulb on a twisted flex — the only light source in most of these rooms. */
function hangingBulb(A: Assembler, x: number, yCeil: number, z: number, drop: number): void {
  const wire = A.cache('bulbwire', (): THREE.BufferGeometry => {
    const g = new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1);
    fillMasks(g, 0.2, 0.4, 0);
    return g;
  });
  A.add('metal_dark', wire, LL(IDENT, x, yCeil - drop / 2, z, 0, 1, drop, 1));
  A.add('metal_dark', BOX_FINE(A), LL(IDENT, x, yCeil - 0.02, z, 0, 0.09, 0.04, 0.09), {
    masks: [0.5, 0.6, 0.3],
  });
  const bulb = A.cache('bulb', (): THREE.BufferGeometry => {
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

// -------------------------------------------------------------- workshop --
function workbench(
  A: Assembler,
  cx: number,
  y: number,
  cz: number,
  alongX: boolean,
  tw: number
): number {
  const top = 0.82;
  const thickness = 0.09;
  A.add(
    'wood_prop_dark',
    BOX(A),
    LL(IDENT, cx, y + top, cz, alongX ? 0 : Math.PI / 2, tw, thickness, 0.72),
    { masks: [0.8, 0.55, 0.25] }
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
  return y + (top + thickness / 2);
}

function shopCounter(A: Assembler, r: RoomSpec, counter: CounterFootprint): number {
  const { y } = r;
  const [ccx, ccz, clen, axis] = counter;
  const alongZ = axis === 'z';
  const cSX = alongZ ? 0.74 : clen;
  const cSZ = alongZ ? clen : 0.74;
  for (let i = 0; i <= 6; i++) {
    const t = -clen / 2 + (i / 6) * clen;
    const px = ccx + (alongZ ? 0 : t);
    const pz = ccz + (alongZ ? t : 0);
    if (inDoorway(r, px, pz))
      throw new Error(`[world] authored shop counter at ${ccx}/${ccz} blocks a doorway`);
  }
  const top = 0.9;
  const thickness = 0.06;
  A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx, y + top, ccz, 0, cSX, thickness, cSZ), {
    masks: [0.9, 0.4, 0.1],
  });
  A.add(
    'wood_prop_dark',
    BOX(A),
    LL(
      IDENT,
      ccx + (alongZ ? -0.32 : 0),
      y + 0.45,
      ccz + (alongZ ? 0 : 0.32),
      0,
      alongZ ? 0.09 : cSX,
      0.9,
      alongZ ? cSZ : 0.09
    ),
    {
      masks: [0.5, 0.6, 0.4],
    }
  );
  A.add('wood_prop_dark', BOX(A), LL(IDENT, ccx, y + 0.28, ccz, 0, cSX - 0.2, 0.04, cSZ - 0.2), {
    masks: [0.4, 0.7, 0.5],
  });
  return y + (top + thickness / 2);
}

function setProp(
  A: Assembler,
  [name, dx, dy, dz, yaw, scale, grime]: RoomProp,
  x: number,
  y: number,
  z: number
): void {
  if (!A.has(name)) throw new Error(`[world] unknown room prop prototype ${name}`);
  A.put(name, x + dx, y + dy, z + dz, yaw, scale, [1, grime, 1]);
}

/** Build kit geometry from a room's authored fixtures. Goods follow the
 * surface they sit on; the furniture does not depend on any cosmetic draws. */
export function furnishRoom(
  A: Assembler,
  id: string,
  r: RoomSpec,
  fixtures: readonly RoomFixture[]
): void {
  const { x0, x1, z0, z1, y, h } = r;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const sides = [
    { x: cx, z: z0, tx: 1, tz: 0, nx: 0, nz: 1, yaw: 0 },
    { x: x1, z: cz, tx: 0, tz: 1, nx: -1, nz: 0, yaw: Math.PI / 2 },
    { x: cx, z: z1, tx: 1, tz: 0, nx: 0, nz: -1, yaw: 0 },
    { x: x0, z: cz, tx: 0, tz: -1, nx: 1, nz: 0, yaw: Math.PI / 2 },
  ];
  const point = (side: number, along: number, offset: number): [number, number] => {
    const s = sides[side];
    return [s.x + s.tx * along + s.nx * offset, s.z + s.tz * along + s.nz * offset];
  };
  const backed = (
    side: number,
    x: number,
    z: number,
    half: number,
    y0: number,
    y1: number
  ): boolean => {
    const t = side % 2 === 0 ? x : z;
    return wallBacking(r, side, t - half, t + half, y0, y1);
  };
  for (const f of fixtures) {
    switch (f[0]) {
      case 'prop': {
        const [, ...prop] = f;
        setProp(A, prop, cx, y, cz);
        break;
      }
      case 'shelf': {
        const [, side, along, height, width, goods] = f;
        const [x, z] = point(side, along, 0.15);
        const sy = y + height;
        if (
          inDoorway(r, x, z) ||
          inVoid(r, x, z) ||
          !backed(side, x, z, width / 2 + 0.03, sy - 0.2, sy + 0.22)
        )
          throw new Error(`[world] ${id} shelf on side ${side} has lost its wall or clearance`);
        const { yaw } = sides[side];
        A.add('wood_prop_dark', BOX(A), LL(IDENT, x, sy, z, yaw, width, 0.035, 0.28), {
          masks: [0.85, 0.5, 0.15],
        });
        for (const direction of [-1, 1]) {
          const [bx, bz] = point(side, along + direction * (width / 2 - 0.12), 0.1);
          A.add('metal_dark', BOX_FINE(A), LL(IDENT, bx, sy - 0.09, bz, yaw, 0.03, 0.16, 0.18), {
            masks: [0.6, 0.6, 0.3],
          });
        }
        for (const good of goods) setProp(A, good, x, sy, z);
        break;
      }
      case 'counter': {
        const [, footprint, goods] = f;
        const top = shopCounter(A, r, footprint);
        const [x, z] = footprint;
        for (const good of goods) setProp(A, good, x, top, z);
        break;
      }
      case 'bench': {
        const [, alongX, width, goods] = f;
        if (inDoorway(r, cx, cz, width / 2 + 0.5))
          throw new Error(`[world] ${id} workbench blocks a doorway`);
        const top = workbench(A, cx, y, cz, alongX, width);
        for (const good of goods) setProp(A, good, cx, top, cz);
        break;
      }
      case 'conduit': {
        const [, side, from, to, height, drop, boxHeight, flex] = f;
        const at = (t: number, offset: number, dy: number): [number, number, number] => {
          const [x, z] = point(side, t, offset);
          return [x, y + dy, z];
        };
        const { yaw } = sides[side];
        const pipe = A.cache('conduit', (): THREE.BufferGeometry => {
          const geometry = new THREE.CylinderGeometry(0.016, 0.016, 1, 6, 1);
          return fillMasks(geometry, 0.35, 0.5, 0.1);
        });
        A.add(
          'metal_dark',
          pipe,
          LL(
            IDENT,
            ...at((from + to) / 2, 0.045, height),
            yaw,
            1,
            Math.abs(to - from),
            1,
            0,
            Math.PI / 2
          )
        );
        A.add(
          'metal_dark',
          pipe,
          LL(IDENT, ...at(drop, 0.045, (height + boxHeight) / 2), 0, 1, height - boxHeight, 1)
        );
        A.add(
          'metal_dark',
          BOX_FINE(A),
          LL(IDENT, ...at(drop, 0.055, boxHeight), yaw, 0.15, 0.19, 0.09),
          {
            masks: [0.55, 0.5, 0.2],
          }
        );
        if (flex)
          A.add(
            'metal_dark',
            pipe,
            LL(IDENT, ...at(drop + 0.06, 0.05, boxHeight - 0.28), 0, 0.4, 0.34, 0.4)
          );
        break;
      }
      case 'lean': {
        const [, side, along, tilt, height, width, key] = f;
        const [x, z] = point(side, along, 0.06 + (Math.sin(tilt) * height) / 2);
        const s = sides[side];
        const pitch = (s.nz || s.nx) * -tilt;
        A.add(
          key,
          BOX_THIN(A),
          LL(IDENT, x, y + (Math.cos(tilt) * height) / 2, z, s.yaw, width, height, 0.022, pitch),
          {
            masks: [0.7, 0.55, 0.3],
          }
        );
        break;
      }
      case 'joist': {
        const [, dx, dz, alongX, span, thickness] = f;
        if (beamHitsVoid(r, alongX, cx + dx, cz + dz, span))
          throw new Error(`[world] ${id} ceiling joist crosses a stair opening`);
        A.add(
          'wood_prop_dark',
          BOX(A),
          LL(
            IDENT,
            cx + dx,
            y + h - 0.06,
            cz + dz,
            alongX ? 0 : Math.PI / 2,
            span,
            0.11,
            thickness
          ),
          {
            masks: [0.35, 0.6, 0.45],
          }
        );
        break;
      }
      case 'bulb':
        hangingBulb(A, cx + f[1], y + h - 0.05, cz + f[2], f[3]);
        break;
      case 'rug': {
        const [, key, dx, dz, w, d, yaw, seed] = f;
        const g = clothGeometry(w, d, {
          segX: 8,
          segY: 6,
          sag: 0,
          wrinkle: 0.02,
          thickness: 0.0038,
          fray: 0.012,
          seed,
        });
        A.addOnce(key, g, LL(IDENT, cx + dx, y + 0.014, cz + dz, yaw, 1, 1, 1, -Math.PI / 2), {
          masks: [0.45, 0.55, 0.25],
        });
        break;
      }
      case 'blanket': {
        const g = clothGeometry(1.5, 0.9, {
          segX: 7,
          segY: 6,
          sag: 0.05,
          wrinkle: 0.05,
          thickness: 0.0032,
          fray: 0.012,
          seed: f[1],
        });
        A.addOnce(
          'fabric_teal',
          g,
          LL(IDENT, x0 + 1.2, y + 0.19, z1 - 1, 0, 1, 1, 1, -Math.PI / 2),
          { masks: [0.3, 0.5, 0.2] }
        );
        break;
      }
      case 'cushion': {
        const [, key, dx, dz, yaw] = f;
        const g = fillMasks(chamferBox(0.42, 0.14, 0.42, 0.06), 0.2, 0.4, 0.2);
        A.addOnce(key, g, LL(IDENT, cx + dx, y + 0.07, cz + dz, yaw));
        break;
      }
      case 'living-drape': {
        const [, near, seed] = f;
        const g = clothGeometry(1.7, 1.1, {
          segX: 8,
          segY: 7,
          sag: 0.04,
          wrinkle: 0.05,
          thickness: 0.0036,
          fray: 0.02,
          bow: -1,
          seed,
        });
        A.addOnce(
          'fabric_red',
          g,
          LL(IDENT, cx - 0.4, y + 1.65, near ? z0 + 0.09 : z1 - 0.09, near ? 0 : Math.PI),
          { masks: [0.3, 0.4, 0.2] }
        );
        break;
      }
      case 'wall-drape': {
        const [, side, along, height, w, drop, key, seed] = f;
        const [x, z] = point(side, along, 0.05);
        const { yaw } = sides[side];
        const g = clothGeometry(w, drop, {
          segX: 6,
          segY: 7,
          sag: 0.1,
          wrinkle: 0.09,
          thickness: 0.003,
          fray: 0.014,
          seed,
        });
        A.addOnce(key, g, LL(IDENT, x, y + height, z, yaw), { masks: [0.35, 0.6, 0.3] });
        A.add(
          'metal_dark',
          BOX_FINE(A),
          LL(IDENT, x, y + height + 0.34, z, yaw, 0.02, 0.02, 0.05),
          {
            masks: [0.7, 0.5, 0],
          }
        );
        break;
      }
      case 'ruin': {
        const [, dx, dz, fragments] = f;
        const x = cx + dx;
        const z = cz + dz;
        for (const [fx, fz, size, yaw, pitch, roll, seed] of fragments)
          A.addOnce(
            'concrete',
            rockGeometry(seed, size, 0, 0.75),
            LL(IDENT, x + fx, y + size * 0.3, z + fz, yaw, 1, 1, 1, pitch, roll),
            {
              masks: [0.3, 0.75, 0.45],
              visualOnly: true,
            }
          );
        break;
      }
      case 'ruin-drape': {
        const [, dx, dz, yaw, seed] = f;
        const g = clothGeometry(1.4, 1.1, {
          segX: 7,
          segY: 7,
          sag: 0.24,
          wrinkle: 0.075,
          twist: 0.08,
          fray: 0.02,
          seed,
        });
        A.addOnce(
          'fabric_cream',
          g,
          LL(IDENT, cx + dx, y + 0.035, cz + dz, yaw, 1, 1, 1, -Math.PI / 2),
          { masks: [0.4, 0.7, 0.3], visualOnly: true }
        );
        break;
      }
    }
  }
}
