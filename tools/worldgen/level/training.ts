import * as THREE from 'three';

import type { WorldManifest } from '../../../src/core/model-metadata.ts';
import type { Assembler } from '../builder.ts';
import { placeBarrier } from '../industrial-props.ts';
import { BOX_THIN, ladderRun } from '../kit.ts';
import { fbm3, keyedRng, paintMasks, plainBox, rockGeometry, trs } from '../util.ts';
import { dressTraining } from './training-dressing.ts';
import {
  BAY_SHIFT,
  COURSE,
  FIRING_LINE,
  LADDER,
  START_HURDLE,
  RANGE_TARGETS,
  RETURN_FLIGHT,
  TRAINING_STATION,
  TRAINING_TARGETS,
} from './training-layout.ts';
import { paintPlane, paintRing, paintText } from './training-markings.ts';
import type { TrainingPaint } from './training-markings.ts';

const HALF_WIDTH = 21.5;
const BACK = -34;
const LONG_BACK = FIRING_LINE - 166;
const FRONT = 16;
const SIDE = 7.5;
const ENTRY = 5.6;
const FLOOR_PAINT = 0.005;
const APRON_EDGE = 5;
const OUTER = HALF_WIDTH + 0.4;
const matrix = new THREE.Matrix4();

const GROUND: { key: string; rect: [number, number, number, number] }[] = [
  { key: 'floor_concrete', rect: [-OUTER, APRON_EDGE, OUTER + BAY_SHIFT, FRONT + 0.4] },
  {
    key: 'training_gravel',
    rect: [-SIDE - 0.22, LONG_BACK - 0.4, SIDE + BAY_SHIFT + 0.22, BACK - 0.4],
  },
  { key: 'training_gravel', rect: [-SIDE, BACK - 0.4, SIDE + BAY_SHIFT, APRON_EDGE] },
  { key: 'training_gravel', rect: [-OUTER, BACK - 0.4, -SIDE, -23] },
  { key: 'training_gravel', rect: [-OUTER, -23, -19.8, APRON_EDGE] },
  { key: 'training_yard_asphalt', rect: [-19.8, -23, -9.4, APRON_EDGE] },
  { key: 'training_gravel', rect: [-9.4, -23, -SIDE, APRON_EDGE] },
  { key: 'training_gravel', rect: [SIDE + BAY_SHIFT, BACK - 0.4, OUTER + BAY_SHIFT, -4] },
  { key: 'training_gravel', rect: [SIDE + BAY_SHIFT, -4, 10.2 + BAY_SHIFT, APRON_EDGE] },
  { key: 'training_hardstand', rect: [10.2 + BAY_SHIFT, -4, 19.8 + BAY_SHIFT, APRON_EDGE] },
  { key: 'training_gravel', rect: [19.8 + BAY_SHIFT, -4, OUTER + BAY_SHIFT, APRON_EDGE] },
];

function box(
  A: Assembler,
  key: string,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  pitch = 0
): void {
  A.add(key, BOX_THIN(A), trs(matrix, x, y, z, 0, w, h, d, pitch));
}

function groundLine(
  A: Assembler,
  key: TrainingPaint,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  width = 0.07
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  paintPlane(
    A,
    key,
    (x0 + x1) / 2,
    FLOOR_PAINT,
    (z0 + z1) / 2,
    Math.hypot(dx, dz),
    width,
    true,
    Math.atan2(-dz, dx)
  );
}

function sign(
  A: Assembler,
  section: 'range' | 'yard' | 'bay',
  text: string,
  x: number,
  y: number,
  z: number,
  height: number
): void {
  const w = (text.length * 0.92 + 1.35) * height;
  box(A, `training_board_${section}`, x, y, z - 0.033, w, height * 1.6, 0.066);
  paintText(A, 'training_letter', text, x, y, z + 0.002, height);
}

function panelRun(
  A: Assembler,
  across: boolean,
  axis: number,
  start: number,
  step: number,
  heights: readonly number[],
  toe: number
): void {
  const put = (
    key: string,
    at: number,
    y: number,
    span: number,
    h: number,
    thick: number
  ): void => {
    if (across) box(A, key, at, y, axis, span, h, thick);
    else box(A, key, axis, y, at, thick, h, span);
  };
  put(
    'training_masonry',
    start + (step * heights.length) / 2,
    toe / 2,
    step * heights.length,
    toe,
    0.44
  );
  for (const [i, top] of heights.entries()) {
    const x = start + (i + 0.5) * step;
    for (let row = 0; row < 4; row++) {
      const h = (top - toe) / 4;
      put(
        row === 1 ? 'wood_pale' : 'wood_dark',
        x,
        toe + h * (row + 0.5),
        step,
        h,
        row % 2 ? 0.26 : 0.3
      );
    }
    put('metal_dark', x, top + 0.035, step, 0.07, 0.36);
    put('training_masonry', x - step / 2, top / 2, 0.16, top, 0.51);
  }
}

function compound(A: Assembler): void {
  for (const {
    key,
    rect: [x0, z0, x1, z1],
  } of GROUND)
    box(A, key, (x0 + x1) / 2, -0.18, (z0 + z1) / 2, x1 - x0, 0.36, z1 - z0);
  // Extend only the firing lanes; the two side yards keep their own end walls.
  for (const start of [-HALF_WIDTH, SIDE + BAY_SHIFT])
    panelRun(A, true, BACK, start, (HALF_WIDTH - SIDE) / 3, [2.65, 2.6, 2.65], 1.48);
  for (const x of [-SIDE, SIDE + BAY_SHIFT])
    panelRun(
      A,
      false,
      x,
      LONG_BACK,
      (BACK - LONG_BACK) / 6,
      [2.8, 2.65, 2.4, 2.4, 2.55, 2.8],
      1.48
    );
  panelRun(A, true, LONG_BACK, -SIDE, (SIDE * 2 + BAY_SHIFT) / 4, [2.8, 3.2, 3.2, 2.8], 1.48);
  panelRun(
    A,
    true,
    FRONT + 0.15,
    -HALF_WIDTH,
    (2 * HALF_WIDTH + BAY_SHIFT) / 10,
    [2.55, 2.55, 2.55, 2.3, 2.3, 2.3, 2.3, 2.5, 2.55, 2.55],
    0.86
  );
  const depth = FRONT + 0.15 - BACK;
  panelRun(
    A,
    false,
    -HALF_WIDTH,
    BACK,
    depth / 10,
    [2.8, 2.58, 2.42, 2.42, 2.35, 2.35, 2.55, 2.55, 2.42, 2.55],
    0.82
  );
  panelRun(
    A,
    false,
    HALF_WIDTH + BAY_SHIFT,
    BACK,
    depth / 10,
    [2.8, 2.8, 2.5, 2.5, 2.4, 2.48, 2.35, 2.35, 2.5, 2.55],
    0.82
  );
  for (const [x, section] of [
    [-SIDE, 'yard'],
    [SIDE + BAY_SHIFT, 'bay'],
  ] as const) {
    const bay = (ENTRY - BACK) / 8;
    panelRun(A, false, x, BACK, bay, [2.8, 2.66, 2.3, 1.55], 0.59);
    // Open rails at the apron separate the routes without boxing in the player.
    for (let i = 0; i <= 4; i++) {
      const z = ENTRY - i * bay;
      box(A, `training_board_${section}`, x, 0.47, z, 0.14, 0.94, 0.14);
      if (i < 4)
        for (const y of [0.39, 0.82]) box(A, 'wood_prop', x, y, z - bay / 2, 0.12, 0.12, bay);
    }
  }
}

// The site sits in a shallow cut: local banks give way to a higher, cooler ridge.
function ridge(
  A: Assembler,
  key: string,
  origin: readonly [x: number, z: number, yaw: number],
  width: number,
  depth: number,
  peaks: readonly number[]
): void {
  const [cx, cz, yaw] = origin;
  const elevation = (x: number, z: number): number => {
    const u = x / width + 0.5;
    const v = z / depth + 0.5;
    const i = Math.min(peaks.length - 2, Math.floor(u * (peaks.length - 1)));
    const t = u * (peaks.length - 1) - i;
    const p = THREE.MathUtils.lerp(peaks[i], peaks[i + 1], t * t * (3 - 2 * t));
    const edge = Math.min(1, u * 8, (1 - u) * 8);
    const roll = Math.sin(Math.PI * v) ** 1.24;
    return -0.45 + edge * roll * (p + (fbm3(x / 10, cx + cz, z / 9) - 0.5) * p * 0.45);
  };
  const land = new THREE.PlaneGeometry(width, depth, 56, 16).rotateX(-Math.PI / 2);
  const points = land.getAttribute('position');
  for (let i = 0; i < points.count; i++) points.setY(i, elevation(points.getX(i), points.getZ(i)));
  land.computeVertexNormals();
  paintMasks(land, (x, _y, z, _nx, ny, _nz, out): void => {
    const mottling = fbm3(x * 0.42, cx + cz, z * 0.42);
    out[0] = (1 - ny) * 0.75;
    out[1] = mottling * 0.85;
    out[2] = mottling * 0.28;
  });
  // All scenery is outside the physical boundary; it need not enter the BVH.
  A.addOnce(key, land, trs(matrix, cx, 0, cz, yaw), { visualOnly: true });

  if (key !== 'training_earth_bank') return;
  for (let i = 0; i < 144; i++) {
    const rng = keyedRng('training-bank-scatter', cx, cz, i);
    const x = rng.range(-width * 0.43, width * 0.43);
    const z = rng.range(-depth * 0.32, depth * 0.41);
    const shrub = i % 5 !== 0;
    const size = shrub ? rng.range(0.21, 0.73) : rng.range(0.48, 1.8);
    const wx = cx + x * Math.cos(yaw) + z * Math.sin(yaw);
    const wz = cz + z * Math.cos(yaw) - x * Math.sin(yaw);
    const scatter = A.cache(`training:bank-scatter:${shrub}:${i % 4}`, (): THREE.BufferGeometry =>
      rockGeometry(keyedRng('training-bank-shape', i % 4), 1, shrub ? 0 : 1, shrub ? 1 : 0.7)
    );
    for (let k = 0; k < (shrub ? 3 : 1); k++) {
      const s = size * rng.range(0.5, 1);
      const offset = k * s * 0.65;
      A.add(
        shrub ? 'training_scrub' : 'training_masonry',
        scatter,
        trs(
          matrix,
          wx + offset,
          elevation(x, z) + (shrub ? s * 0.14 : 0),
          wz + offset * 0.68,
          rng.range(0, 6.28),
          s * 1.7,
          s,
          s
        ),
        { visualOnly: true }
      );
    }
  }
}

function hills(A: Assembler): void {
  // The elevated walk looks over the fence into the valley between the banks.
  A.add('training_gravel', BOX_THIN(A), trs(matrix, 0, -0.6, -100, 0, 310, 0.2, 345), {
    visualOnly: true,
  });
  ridge(A, 'training_earth_bank', [0, LONG_BACK - 12, 0], 76, 24, [5, 8.8, 6.8, 5.2, 7.2, 9.5, 7]);
  ridge(A, 'training_earth_bank', [-33.5, -9, Math.PI / 2], 78, 24, [4.5, 7.2, 8.5, 5.4, 4.3, 2.8]);
  ridge(
    A,
    'training_earth_bank',
    [35.5 + BAY_SHIFT, -12, -Math.PI / 2],
    86,
    28,
    [3.2, 5, 5.8, 6.4, 9.2, 7.2]
  );
  ridge(A, 'training_foothill', [5, LONG_BACK - 44, 0], 195, 62, [8, 18, 20, 13, 10, 22, 25, 14]);
  ridge(
    A,
    'training_ridgeline',
    [-6, LONG_BACK - 85, 0],
    340,
    108,
    [22, 37, 30, 44, 28, 37, 30, 20]
  );
}

const RANGE_LABELS = RANGE_TARGETS.map(({ z }): string => `${FIRING_LINE - z} M`);

function targets(A: Assembler): void {
  const face = A.proto('training_target_face', { geo: plainBox(), key: 'training_white' });
  const backing = A.proto('training_target_backing', { geo: plainBox(), key: 'metal_green' });
  const faceDepth = 0.065;
  const backingDepth = 0.06;
  const airGap = 0.02;
  for (const [i, target] of TRAINING_TARGETS.entries()) {
    const { x, y, z, width, height } = target;
    const foot = y - height / 2;
    for (const dx of [-width * 0.34, width * 0.34]) {
      box(A, 'metal_dark', x + dx, foot / 2, z - 0.12, 0.08, foot, 0.08);
      box(A, 'concrete_dark', x + dx, 0.05, z - 0.12, 0.23, 0.1, 0.36);
    }
    // Cook the backing as a closed solid; separate it from the board's exit face.
    A.putS(
      backing,
      x,
      y,
      z - faceDepth - airGap - backingDepth / 2,
      0,
      width + 0.11,
      height + 0.11,
      backingDepth
    );
    A.putS(face, x, y, z - faceDepth / 2, 0, width, height, faceDepth);
    const radius = width * 0.46;
    for (const inner of [0.34, 0.57, 0.8])
      paintRing(A, 'training_ink', x, y, z + 0.002, radius * inner, radius * (inner + 0.045));
    paintRing(A, 'training_red', x, y, z + 0.002, 0, radius * 0.22);
    const top = y + height / 2;
    box(A, 'metal_dark', x, top + 0.12, z - 0.119, 0.06, 0.24, 0.06);
    sign(
      A,
      i < RANGE_LABELS.length ? 'range' : 'yard',
      'label' in target ? target.label : RANGE_LABELS[i],
      x,
      top + 0.23,
      z - 0.052,
      'label' in target ? 0.34 : 0.145
    );
  }
}

// Undersides of the pavilion beams, workshop eave and ladder landing. One
// anchor drives the visible fitting and the manifest light just below its lens.
const WORK_LIGHTS = [
  { x: TRAINING_STATION.x, y: 3.75, z: 11.18, night: 28, range: 9 },
  { x: 4.7, y: 3.265, z: 5.8, night: 19, range: 10 },
  { x: 17, y: 3.75, z: 11.18, night: 25, range: 11 },
  { x: -17.54, y: 2.77, z: 12.36, night: 15, range: 8 },
  { x: LADDER.x, y: LADDER.y1 - 0.2, z: -14.7, night: 21, range: 9 },
];

function workLights(A: Assembler): void {
  for (const { x, y, z } of WORK_LIGHTS) {
    for (const [key, drop, w, h, d] of [
      ['metal_dark', 0.055, 0.98, 0.11, 0.24],
      ['lamp_lens', 0.13, 0.86, 0.04, 0.17],
    ] as const)
      A.add(key, BOX_THIN(A), trs(matrix, x, y - drop, z, 0, w, h, d), { visualOnly: true });
  }
}

function pavilion(A: Assembler): void {
  const beamZ = 5.8;
  const roofZ = 8.59;
  const pitch = -0.09;
  const mid = BAY_SHIFT / 2;
  // The roof covers the line but stops short of the arrival point at z=12.
  // Player spawn chooses the first surface seen by a raycast from above.
  box(A, 'training_roof', mid, 3.72, roofZ, 15.55 + BAY_SHIFT, 0.11, 5.82, pitch);
  box(A, 'wood_dark', mid, 3.39, beamZ, 14.95 + BAY_SHIFT, 0.25, 0.21);
  box(A, 'wood_dark', mid, 3.87, 11.18, 14.95 + BAY_SHIFT, 0.24, 0.22);
  for (let x = -7.16; x <= 7.16 + BAY_SHIFT; x += 2.45)
    box(A, 'wood_dark', x, 3.6, roofZ, 0.16, 0.19, 5.73, pitch);
  for (const x of [-7.16, mid, 7.16 + BAY_SHIFT]) {
    for (const [z, h] of [
      [beamZ, 3.42],
      [11.18, 3.86],
    ]) {
      box(A, 'training_masonry', x, 0.22, z, 0.45, 0.44, 0.45);
      box(A, 'wood_dark', x, (h + 0.44) / 2, z, 0.23, h - 0.44, 0.24);
      box(A, 'metal_dark', x, 0.52, z, 0.255, 0.16, 0.28);
    }
  }
  for (const z of [5.69, 11.49])
    box(
      A,
      'training_board_range',
      mid,
      3.72 - (z - roofZ) * Math.sin(pitch),
      z,
      15.6 + BAY_SHIFT,
      0.17,
      0.08
    );

  for (const [section, text, x, h] of [
    ['yard', '< PARKOUR', -5.03, 0.27],
    ['range', 'FIRING LINE', 0, 0.3],
    ['bay', 'BAY >', 5.03 + BAY_SHIFT, 0.27],
  ] as const) {
    box(A, 'metal_dark', x, 3.03, beamZ + 0.058, 0.11, 0.62, 0.12);
    sign(A, section, text, x, 2.7, beamZ + 0.13, h);
  }

  for (const [i, { x }] of RANGE_TARGETS.entries()) {
    groundLine(A, 'training_white', x - 0.98, FIRING_LINE, x + 0.98, FIRING_LINE, 0.12);
    paintText(A, 'training_ink', RANGE_LABELS[i], x, FLOOR_PAINT, FIRING_LINE - 3.4, 0.52, true);
  }
}

function entrySign(
  A: Assembler,
  section: 'yard' | 'bay',
  name: string,
  subtitle: string,
  x: number,
  z: number
): void {
  for (const dx of [-0.71, 0.71]) {
    box(A, 'training_masonry', x + dx, 0.08, z - 0.12, 0.22, 0.16, 0.31);
    box(A, 'metal_dark', x + dx, 0.89, z - 0.12, 0.1, 1.46, 0.1);
  }
  const width = name.length * 0.22 + 0.37;
  box(A, `training_board_${section}`, x, 1.48, z - 0.07, width, 0.54, 0.14);
  paintText(A, 'training_letter', name, x, 1.57, z + 0.002, 0.24);
  paintText(A, 'training_letter', subtitle, x, 1.35, z + 0.002, 0.112);
}

/** Open timber trestles: the cap is the actual landing surface, paint is not collision. */
function trestle(
  A: Assembler,
  x: number,
  z: number,
  width: number,
  depth: number,
  top: number
): void {
  const cap = 0.15;
  for (const dz of [-1, 1]) {
    const end = z + dz * (depth / 2 - 0.15);
    for (const dx of [-1, 1])
      box(
        A,
        'wood_prop_dark',
        x + dx * (width / 2 - 0.11),
        (top - cap) / 2,
        end,
        0.16,
        top - cap,
        0.18
      );
    box(A, 'metal_dark', x, top - cap - 0.07, end, width, 0.14, 0.2);
  }
  if (top > 2) {
    const run = depth - 0.3;
    const rise = top - 0.8;
    for (const side of [-1, 1])
      box(
        A,
        'metal_blue',
        x + side * (width / 2 - 0.11),
        top / 2,
        z,
        0.085,
        0.13,
        Math.hypot(run, rise),
        side * Math.atan2(rise, run)
      );
  }
  box(A, 'wood_prop', x, top - cap / 2, z, width, cap, depth);
  for (const dz of [-1, 1])
    paintPlane(
      A,
      'training_yellow',
      x,
      top + FLOOR_PAINT,
      z + dz * (depth / 2 - 0.12),
      width - 0.1,
      0.12,
      true
    );
}

function practiceYard(A: Assembler): void {
  const { x, z } = START_HURDLE;
  entrySign(A, 'yard', 'PARKOUR', 'VAULT TO START', -10.3, 4.4);
  paintText(A, 'training_ink', 'START', x, FLOOR_PAINT, 6.8, 0.48, true);
  for (const edge of [x - 1.35, x + 1.35]) groundLine(A, 'training_yellow', edge, 6.2, edge, -0.5);
  placeBarrier(A, x, 0, z);
  paintText(A, 'training_white', 'VAULT', x, FLOOR_PAINT, -0.3, 0.42, true);

  // The low zigzag feeds the tower without changing the player's jump or mantle rules.
  // Missed jumps land on walkable ground; either side is a route back to the start.
  trestle(A, x, -4.7, 2.4, 2.5, 0.65);
  trestle(A, x - 1.1, -8.15, 1.72, 2.05, 1.0);
  trestle(A, x + 0.1, -11.65, 0.68, 3.1, 1.22);
  trestle(A, LADDER.x, -15.95, 2.25, 3.0, LADDER.y0);

  // The climb motor steps outward at the top: leave a well between the rungs
  // and upper landing, with both the foot and the dismount over solid decking.
  const mast = LADDER.z - 0.46;
  ladderRun(
    A,
    new THREE.Matrix4().makeTranslation(LADDER.x, LADDER.y0, mast),
    LADDER.y1 - LADDER.y0,
    { w: 0.67, key: 'steel' }
  );
  for (const dx of [-0.34, 0.34]) {
    box(A, 'metal_blue', LADDER.x + dx, 2.97, mast - 0.08, 0.1, 5.94, 0.16);
  }
  for (const y of [1.32, 5.02]) {
    box(A, 'metal_dark', LADDER.x, y, mast - 0.1, 1.17, 0.12, 0.12);
    for (const dx of [-0.54, 0.54])
      box(A, 'metal_dark', LADDER.x + dx, y, mast + 0.51, 0.09, 0.12, 1.32);
  }
  sign(A, 'yard', '< HIGH WALK', LADDER.x, 5.88, mast, 0.16);
  trestle(A, -13.25, -14.7, 3.45, 2.46, LADDER.y1);
  sign(A, 'yard', 'CLIMB', -13.25, LADDER.y1 - 0.17, -13.46, 0.22);
  paintText(A, 'training_white', 'HIT A', -12.75, LADDER.y1 + FLOOR_PAINT, -15.15, 0.23, true);
  // Jump left from the lookout, turn downrange and line up the offset beam.
  trestle(A, -16.8, -14.7, 1.48, 2.05, 5.38);
  trestle(A, -16.25, -18.28, 0.62, 2.95, 5.62);
  const summit = 5.8;
  trestle(A, -15.5, -24.65, 1.9, 7.1, summit);
  // Sustained crouch, not a single slide bar. Open sides keep the next landing visible.
  for (const dx of [-0.88, 0.88]) {
    for (const dz of [-1.9, 0, 1.9])
      box(A, 'metal_blue', -15.5 + dx, summit + 0.61, -25 + dz, 0.1, 1.22, 0.1);
    box(A, 'wood_prop', -15.5 + dx, summit + 0.5, -25, 0.08, 0.12, 3.92);
  }
  box(A, 'training_roof', -15.5, summit + 1.28, -25, 1.96, 0.12, 4.0);
  sign(A, 'yard', 'CROUCH', -15.5, summit + 1.39, -22.98, 0.18);
  paintText(A, 'training_white', 'DROP >', -15.5, summit + FLOOR_PAINT, -27.6, 0.22, true);
  // Drop once, turn back toward the apron, and pull up two deep ledges.
  // Their solid risers give the mantle probe a face from either side of the tread.
  for (const [z, top] of [
    [-27.6, 3.45],
    [-25.3, 4.75],
    [-23, 6.0],
  ]) {
    trestle(A, -12.65, z, 2.0, 2.3, top);
    box(A, 'metal_blue', -12.65, top - 0.77, z - 1.08, 1.95, 1.24, 0.14);
  }
  for (const [z, top] of [
    [-26.46, 4.75],
    [-24.16, 6],
  ])
    paintText(A, 'training_yellow', 'PULL UP', -12.65, top - 0.5, z, 0.2, false, Math.PI);
  paintText(A, 'training_white', 'TURN', -12.65, 3.45 + FLOOR_PAINT, -27.6, 0.27, true);
  paintText(A, 'training_white', 'HIT B', -12.65, 6 + FLOOR_PAINT, -23, 0.28, true, Math.PI);
  sign(A, 'yard', 'SUMMIT', -12.65, 5.8, -21.84, 0.22);
  returnFlight(A);
}

/** A shuttered practice facade frames the runway; the sill is its first standable surface. */
function returnFlight(A: Assembler): void {
  const { x, window, sill, edge, gap, rise } = RETURN_FLIGHT;
  const depth = edge - window;
  // Cantilever the runway off the summit, keeping the existing ladder climb clear below.
  box(A, 'wood_prop', x, sill - 0.1, window + depth / 2, 1.9, 0.2, depth);
  for (const side of [-1, 1]) {
    box(A, 'metal_blue', x + side * 0.77, sill - 0.3, window + depth / 2, 0.12, 0.2, depth);
    box(A, 'metal_dark', x + side * 0.77, 3.45, edge - 1.85, 0.14, 6.9, 0.16);
    box(A, 'wood_prop_dark', x + side * 1.14, 7.8, window + 0.12, 0.74, 3.6, 0.25);
    box(A, 'metal_blue', x + side * 0.79, 8.34, window + 0.12, 0.09, 2.28, 0.31);
  }
  box(A, 'wood_prop', x, 6.6, window + 0.13, 1.6, 1.2, 0.26);
  box(A, 'training_board_yard', x, 9.49, window + 0.12, 3.02, 0.22, 0.31);
  paintText(A, 'training_letter', 'WINDOW', x, 9.49, window - 0.04, 0.16, false, Math.PI);
  paintText(A, 'training_white', 'SPRINT', x, sill + FLOOR_PAINT, edge - 2.35, 0.27, true, Math.PI);
  paintPlane(A, 'training_yellow', x, sill + FLOOR_PAINT, edge - 0.12, 1.83, 0.14, true);

  const lip = edge + gap;
  const top = sill + rise;
  // Suspend the catch deck over the existing lookout rather than obstructing the low route.
  box(A, 'wood_prop', x, top - 0.09, lip + 1.25, 1.8, 0.18, 2.5);
  box(A, 'metal_blue', x, top - 0.75, lip + 0.09, 1.8, 1.14, 0.18);
  box(A, 'metal_blue', x, top - 1.31, lip + 2.35, 4.75, 0.18, 0.22);
  for (const side of [-1, 1]) {
    box(A, 'metal_dark', x + side * 2.28, (top - 1.4) / 2, lip + 2.35, 0.16, top - 1.4, 0.18);
    box(A, 'metal_blue', x + side * 0.82, top - 0.74, lip + 1.26, 0.1, 0.13, 2.55, 0.47);
  }
  paintPlane(A, 'training_yellow', x, top + FLOOR_PAINT, lip + 0.12, 1.73, 0.14, true);
  paintText(A, 'training_letter', 'FINISH', x, top - 0.52, lip - 0.005, 0.23, false, Math.PI);
}

function grenadeBay(A: Assembler): void {
  const x = 15 + BAY_SHIFT;
  entrySign(A, 'bay', 'GRENADE BAY', 'NEAR  FAR', 18.2 + BAY_SHIFT, 4.4);
  groundLine(A, 'training_red', 10.5 + BAY_SHIFT, 7.2, 19.5 + BAY_SHIFT, 7.2, 0.16);
  paintText(A, 'training_ink', 'THROW LINE', x, FLOOR_PAINT, 8.06, 0.47, true);
  for (const [name, z, radius] of [
    ['NEAR', 1.5, 1.6],
    ['FAR', -15.5, 2.65],
  ] as const) {
    paintRing(A, 'training_red', x, FLOOR_PAINT, z, radius - 0.15, radius, true);
    paintRing(A, 'training_white', x, FLOOR_PAINT, z, radius * 0.34, radius * 0.34 + 0.085, true);
    paintText(A, 'training_ink', name, x, FLOOR_PAINT, z + radius + 0.57, 0.49, true);
  }
  placeBarrier(A, x, 0, -6.5);
  paintText(A, 'training_white', 'BOUNCE', x, 0.56, -6.265, 0.24);
}

export function buildTraining(A: Assembler): void {
  compound(A);
  hills(A);
  targets(A);
  pavilion(A);
  practiceYard(A);
  grenadeBay(A);
  dressTraining(A);
  workLights(A);
}

export function trainingMetadata(
  A: Assembler,
  sourceHash: string
): Omit<WorldManifest, 'assets' | 'navigation' | 'stats' | 'mapId' | 'mode'> & {
  coordinateSystem: string;
} {
  const spawns: Array<WorldManifest['spawns'][number] & { id: string }> = [
    {
      id: 'firing_line',
      position: [0, 0, FIRING_LINE],
      yaw: 0,
      forward: [0, 0, -1],
      tag: 'firing line',
    },
  ];
  return {
    version: 2,
    coordinateSystem: 'three-y-up-metres',
    sourceHash,
    transform: A.xform.toArray(),
    bounds: {
      min: [-HALF_WIDTH - 0.5, -1, LONG_BACK - 0.5],
      max: [HALF_WIDTH + BAY_SHIFT + 0.5, RETURN_FLIGHT.sill + RETURN_FLIGHT.rise + 2, FRONT + 0.5],
    },
    spawns,
    volumes: [LADDER],
    lights: WORK_LIGHTS.map(({ x, y, z, night, range }): WorldManifest['lights'][number] => ({
      kind: 'street',
      position: [x, y - 0.24, z],
      color: [1, 0.65, 0.34],
      range,
      priority: 3,
      day: 0,
      night,
    })),
    WORLD: {
      MARKERS: { RANGE_STATION: TRAINING_STATION, RANGE_TARGETS: TRAINING_TARGETS, COURSE },
    },
    query: {
      alleys: GROUND.map(
        ({ key, rect }): { rect: (typeof GROUND)[number]['rect']; surface: string } => ({
          rect,
          surface: A.surfaceOf(key),
        })
      ),
    },
  };
}
