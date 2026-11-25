import * as THREE from 'three';

import type { Assembler, PrototypeSpec } from '../builder.ts';
import { awning, BOX_FINE, BOX_THIN, mergeSimple, worldOf } from '../kit.ts';
import type { PALETTE } from '../palette.ts';
import { registerProps } from '../props.ts';
import { chamferBox, clothGeometry, fillMasks, trs } from '../util.ts';
import { BAY_SHIFT, TRAINING_STATION } from './training-layout.ts';
import { PAINT, paintPlane, paintText } from './training-markings.ts';

type Finish = keyof typeof PALETTE;
const matrix = new THREE.Matrix4();
const BACKWARD = Math.PI;

function box(
  A: Assembler,
  key: Finish,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  yaw = 0,
  pitch = 0,
  roll = 0
): void {
  A.add(key, BOX_THIN(A), trs(matrix, x, y, z, yaw, w, h, d, pitch, roll), {
    masks: [0.72, 0.45, 0.16],
  });
}

function cylinder(top: number, bottom: number, height: number, sides = 16): THREE.BufferGeometry {
  return fillMasks(new THREE.CylinderGeometry(top, bottom, height, sides), 0.43, 0.24, 0.12);
}

function issueCounter(A: Assembler): void {
  const { x, z } = TRAINING_STATION;
  // The public side looks toward spawn; the chair sits on the far side of the counter.
  const yaw = (105 * Math.PI) / 180;
  const frame = trs(new THREE.Matrix4(), x, 0, z, yaw);
  const at = (u: number, y: number, v: number): [number, number, number] => worldOf(frame, u, y, v);
  const part = (
    key: Finish,
    u: number,
    y: number,
    v: number,
    w: number,
    h: number,
    d: number
  ): void => {
    A.addBox(key, BOX_FINE(A), ...at(u, y, v), yaw, w, h, d);
  };
  part('wood_prop', 0, 1.04, 0, 1.92, 0.075, 0.72);
  part('metal_dark', 0, 0.966, 0, 1.84, 0.06, 0.65);
  for (const u of [-0.84, 0.84]) {
    for (const v of [-0.266, 0.266]) {
      part('metal_dark', u, 0.491, v, 0.063, 0.949, 0.063);
      part('rubber', u, 0.026, v, 0.095, 0.052, 0.095);
    }
    part('metal_dark', u, 0.22, 0, 0.054, 0.054, 0.53);
  }
  part('metal_blue', 0, 0.665, 0.287, 1.63, 0.49, 0.043);
  part('wood_prop_dark', 0, 0.245, -0.024, 1.65, 0.042, 0.51);
  part('metal_dark', 0.52, 0.806, -0.037, 0.52, 0.276, 0.49);
  for (const y of [0.758, 0.878]) {
    part('metal_blue', 0.52, y, -0.285, 0.484, 0.107, 0.016);
    part('steel', 0.52, y + 0.014, -0.306, 0.132, 0.018, 0.025);
  }
  paintText(A, 'training_letter', 'ISSUE COUNTER', ...at(-0.12, 0.67, 0.312), 0.105, false, yaw);
  // The fascia's clipboard pictogram repeats the sign-out sheet on the counter.
  for (const u of [-0.7, -0.49, -0.28])
    paintPlane(A, 'training_yellow', ...at(u, 0.83, 0.31), 0.16, 0.045, false, yaw);
  for (const [key, depth, y, w, h] of [
    ['training_ink', 0.311, 0.667, 0.278, 0.31],
    ['training_white', 0.312, 0.662, 0.137, 0.184],
    ['training_yellow', 0.313, 0.751, 0.082, 0.036],
    ['training_ink', 0.313, 0.679, 0.09, 0.01],
    ['training_ink', 0.313, 0.645, 0.09, 0.01],
    ['training_ink', 0.313, 0.611, 0.09, 0.01],
  ] as const)
    paintPlane(A, key, ...at(0.59, y, depth), w, h, false, yaw);
  part('wood_prop_dark', -0.3, 1.084, 0.084, 0.254, 0.013, 0.329);
  paintPlane(A, 'training_white', ...at(-0.3, 1.092, 0.084), 0.225, 0.288, true, yaw);
  for (let i = 0; i < 6; i++) {
    const v = -0.002 + i * 0.033;
    paintPlane(A, 'training_ink', ...at(-0.3, 1.093, v), 0.175, 0.004, true, yaw);
  }
  part('steel', -0.3, 1.1, -0.052, 0.105, 0.013, 0.031);
  part('metal_blue', -0.11, 1.089, 0.133, 0.012, 0.013, 0.145);
  const bell = A.cache('training:counter-bell', (): THREE.BufferGeometry =>
    cylinder(0.04, 0.063, 0.043)
  );
  A.add('steel', bell, trs(matrix, ...at(0.61, 1.099, 0.17)));
  part('metal_dark', 0.61, 1.129, 0.17, 0.025, 0.017, 0.025);
  A.putS('chair', ...at(0.07, 0, -0.72), yaw - 0.26, 1, 1, 1);
}

function repairBench(A: Assembler): void {
  const x = -17.54;
  const z = 14.69;
  box(A, 'wood_prop', x, 0.932, z, 2.21, 0.075, 0.67);
  box(A, 'metal_blue', x, 0.861, z, 2.11, 0.065, 0.6);
  box(A, 'wood_prop_dark', x, 0.255, z, 2.04, 0.048, 0.49);
  for (const dx of [-0.99, 0.99])
    for (const dz of [-0.26, 0.26])
      box(A, 'metal_dark', x + dx, 0.433, z + dz, 0.062, 0.865, 0.062);
  for (const dx of [-0.89, 0.89])
    box(A, 'wood_prop_dark', x + dx, 1.513, 15.216, 0.055, 0.81, 0.181);
  box(A, 'wood_pale', x, 1.513, 15.11, 2.17, 0.88, 0.034);
  for (const y of [1.058, 1.965]) box(A, 'metal_blue', x, y, 15.094, 2.22, 0.034, 0.063);
  for (const dx of [-1.102, 1.102]) box(A, 'metal_blue', x + dx, 1.513, 15.094, 0.038, 0.89, 0.063);
  const hole = A.cache('training:peg-hole', (): THREE.BufferGeometry =>
    new THREE.CircleGeometry(0.008, 6).rotateY(BACKWARD)
  );
  for (let row = 0; row < 9; row++)
    for (let col = 0; col < 23; col++)
      A.add(
        'training_ink',
        hole,
        trs(matrix, x - 0.99 + col * 0.09, 1.15 + row * 0.09, 15.091),
        PAINT
      );

  // Rubber mallet, combination spanner and two handled drivers on the board.
  box(A, 'wood_prop_dark', x - 0.65, 1.57, 15.047, 0.033, 0.42, 0.031, 0, 0, -0.16);
  box(A, 'rubber', x - 0.685, 1.78, 15.044, 0.189, 0.081, 0.074, 0, 0, -0.16);
  box(A, 'steel', x - 0.12, 1.543, 15.059, 0.039, 0.285, 0.022, 0, 0, 0.19);
  const jaw = A.cache('training:spanner-jaw', (): THREE.BufferGeometry =>
    fillMasks(
      new THREE.TorusGeometry(0.055, 0.013, 6, 14, Math.PI * 1.57).rotateZ(Math.PI * 0.73),
      0.8,
      0.18,
      0.12
    )
  );
  const eye = A.cache('training:spanner-eye', (): THREE.BufferGeometry =>
    fillMasks(new THREE.TorusGeometry(0.03, 0.011, 6, 14), 0.8, 0.18, 0.12)
  );
  A.add('steel', jaw, trs(matrix, x - 0.149, 1.701, 15.059));
  A.add('steel', eye, trs(matrix, x - 0.092, 1.401, 15.059));
  for (const [dx, y] of [
    [0.32, 1.61],
    [0.55, 1.53],
  ]) {
    box(A, 'metal_blue', x + dx, y, 15.045, 0.048, 0.135, 0.047);
    box(A, 'steel', x + dx, y - 0.139, 15.045, 0.014, 0.149, 0.014);
    box(A, 'steel', x + dx, y + 0.072, 15.066, 0.084, 0.016, 0.075);
  }
  A.putS('box_card_b', x + 0.72, 0.278, z, 0.16, 1, 0.9, 0.9);
  A.putS('bucket', x - 0.66, 0.28, z, 0, 0.8, 0.8, 0.8);
}

function equipmentShed(A: Assembler): void {
  const x = -15.65;
  const z = 13.83;
  const pitch = 0.128;
  const roofY = 2.82;
  const roofAt = (depth: number): number => roofY - (depth - z) * Math.tan(pitch);
  const front = 12.36;
  const back = 15.26;
  const roofWidth = 8.64;
  const roofDepth = 3.46;
  box(A, 'metal_green', x, roofY, z, roofWidth, 0.055, roofDepth, 0, pitch);
  for (let i = 0; i <= 24; i++)
    box(
      A,
      'metal_green',
      x + (i - 12) * 0.356,
      roofY + 0.035,
      z,
      0.021,
      0.025,
      roofDepth,
      0,
      pitch
    );
  for (const eave of [front, back])
    box(A, 'wood_prop_dark', x, roofAt(eave) - 0.12, eave, 8.26, 0.21, 0.16);
  for (const dx of [-4.02, 0, 4.02]) {
    box(A, 'wood_prop_dark', x + dx, roofY - 0.095, z, 0.12, 0.14, 3.24, 0, pitch);
    for (const eave of [front, back]) {
      const top = roofAt(eave) - 0.105;
      box(A, 'wood_prop', x + dx, (top + 0.115) / 2, eave, 0.168, top - 0.115, 0.168);
      box(A, 'concrete_prop', x + dx, 0.058, eave, 0.285, 0.116, 0.285);
      box(A, 'metal_dark', x + dx, 0.153, eave, 0.187, 0.077, 0.187);
    }
    // Short timber knees leave the front entirely open below the header.
    for (const side of dx === 0 ? [-1, 1] : [-Math.sign(dx)]) {
      const kneeY = roofAt(front) - 0.448;
      box(A, 'wood_prop', x + dx + side * 0.235, kneeY, front, 0.68, 0.1, 0.115, 0, 0, side * 0.62);
    }
  }
  box(A, 'metal_green', x, roofAt(12.13) - 0.071, 12.13, roofWidth, 0.16, 0.056);
  // Board-and-batten back and short returns leave the front bays legible in shadow.
  box(A, 'wood_prop', x, 1.29, 15.355, 8.18, 2.51, 0.079);
  for (let i = 0; i <= 27; i++)
    box(A, 'wood_prop_dark', x + (i - 13.5) * 0.292, 1.3, 15.29, 0.042, 2.52, 0.049);
  for (const dx of [-4.075, 4.075]) {
    box(A, 'wood_prop', x + dx, 1.22, 14.47, 0.09, 2.34, 1.69);
    box(A, 'wood_prop_dark', x + dx, 2.399, 14.47, 0.135, 0.055, 1.73);
  }
  repairBench(A);
  for (const shelf of [-14.52, -12.67]) {
    A.putS('shelf', shelf, 0, 14.91, BACKWARD, 1.43, 1, 1.34);
    for (const [offset, y] of [
      [-0.36, 0.237],
      [0.28, 0.736],
      [-0.22, 1.237],
    ])
      tote(A, shelf + offset, y, 14.89, BACKWARD, 0.8);
  }
}

function tote(A: Assembler, x: number, y: number, z: number, yaw: number, scale = 1): void {
  A.put('training_tote_body', x, y, z, yaw, scale);
  A.put('training_tote_lid', x, y, z, yaw, scale);
  A.put('training_tote_handle', x, y, z, yaw, scale);
}

function supplyLanding(A: Assembler): void {
  // Palletized returns and spare cord: one tidy load, not isolated cover props.
  const frame = new THREE.Matrix4();
  for (const { x, z, yaw, stacks } of [
    { x: 13.04 + BAY_SHIFT, z: 14.61, yaw: -0.12, stacks: [2, 1] },
    { x: 14.31 + BAY_SHIFT, z: 14.72, yaw: 0.04, stacks: [2, 2] },
  ]) {
    A.putS('pallet', x, 0.017, z, yaw, 1, 1, 1);
    trs(frame, x, 0, z, yaw);
    for (const [i, count] of stacks.entries()) {
      const [loadX, , loadZ] = worldOf(frame, (i * 2 - 1) * 0.285, 0, 0);
      for (let row = 0; row < count; row++)
        tote(A, loadX, 0.114 + row * 0.288, loadZ, BACKWARD + yaw);
    }
  }
  A.putS('pallet', 15.68 + BAY_SHIFT, 0.017, 14.72, 0.09, 1, 1, 1);
  A.putS('crate_c', 15.68 + BAY_SHIFT, 0.114, 14.72, 0.09, 1, 1, 1);
  const reels = [
    [17.48 + BAY_SHIFT, 14.12, 1, 0.24],
    [18.71 + BAY_SHIFT, 14.5, 0.76, -0.4],
    [19.73 + BAY_SHIFT, 13.66, 0.61, 0.87],
  ];
  for (const [x, z, scale, yaw] of reels) {
    A.put('training_reel_flange', x, 0.059 * scale, z, yaw, scale);
    A.put('training_reel_flange', x, 0.758 * scale, z, yaw, scale);
    A.put('training_reel_cord', x, 0.4085 * scale, z, yaw, scale);
    A.put('training_reel_hub', x, 0.826 * scale, z, yaw, scale);
    trs(frame, x, 0, z, yaw);
    for (const offset of [-0.21, 0.17]) {
      paintPlane(
        A,
        'training_ink',
        ...worldOf(frame, 0, 0.818 * scale, offset * scale),
        2 * Math.sqrt(0.54 ** 2 - offset ** 2) * scale,
        0.006 * scale,
        true,
        yaw
      );
    }
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + yaw;
      A.put(
        'training_reel_fastener',
        x + Math.cos(angle) * 0.19 * scale,
        0.822 * scale,
        z + Math.sin(angle) * 0.19 * scale,
        angle,
        scale
      );
    }
  }
}

function markerPocket(A: Assembler, x: number, z: number, side: -1 | 1): void {
  A.put('training_flag_ballast', x, 0.109, z);
  A.put('training_flag_ferrule', x, 0.222, z);
  A.put('training_flag_pole', x, 0.941, z);
  const yaw = side < 0 ? 0.36 : BACKWARD - 0.36;
  const frame = trs(matrix, x, 0, z, yaw);
  A.put(
    side < 0 ? 'training_yard_flag' : 'training_bay_flag',
    ...worldOf(frame, 0.318, 1.455, 0),
    yaw
  );
  for (const y of [1.311, 1.606]) A.put('training_flag_sleeve', x, y, z);
  const band = A.cache(
    'training:cone-reflector',
    (): THREE.BufferGeometry => new THREE.CylinderGeometry(0.078, 0.099, 0.079, 16, 1, true)
  );
  for (const [dx, dz] of [
    [0.12, 1.02],
    [-0.22, -0.93],
    [0.4, -1.77],
  ]) {
    A.put('training_cone_base', x + dx, 0.021, z + dz);
    A.put('training_cone_shell', x + dx, 0.248, z + dz);
    A.add('training_white', band, trs(matrix, x + dx, 0.274, z + dz), PAINT);
  }
}

function toteHandle(): THREE.BufferGeometry {
  const parts = [chamferBox(0.139, 0.025, 0.022, 0.007).translate(0, 0.199, 0.223)];
  for (const x of [-0.056, 0.056])
    parts.push(chamferBox(0.024, 0.032, 0.05, 0.006).translate(x, 0.199, 0.198));
  const handle = mergeSimple(parts);
  for (const part of parts) part.dispose();
  return handle;
}

function reelCord(): THREE.BufferGeometry {
  const halfWidth = 0.292;
  const profile = [new THREE.Vector2(0, -halfWidth)];
  for (let i = 0; i < 14; i++) {
    const pitch = (2 * halfWidth) / 14;
    const y = i * pitch - halfWidth;
    profile.push(new THREE.Vector2(0.355, y), new THREE.Vector2(0.367, y + pitch / 2));
  }
  profile.push(new THREE.Vector2(0.355, halfWidth), new THREE.Vector2(0, halfWidth));
  return fillMasks(new THREE.LatheGeometry(profile, 20), 0.34, 0.16, 0.1);
}

export function dressTraining(A: Assembler): void {
  registerProps(A);
  const batchProp = (id: string, spec: PrototypeSpec): void => {
    A.proto(id, { ...spec, batchVisual: true });
  };
  batchProp('training_tote_body', {
    key: 'metal_blue',
    geo: chamferBox(0.5, 0.259, 0.37, 0.026).translate(0, 0.1295, 0),
  });
  batchProp('training_tote_lid', {
    key: 'metal_dark',
    geo: chamferBox(0.53, 0.034, 0.39, 0.01).translate(0, 0.271, 0),
  });
  batchProp('training_tote_handle', { key: 'steel', geo: toteHandle() });
  batchProp('training_reel_flange', { key: 'wood_prop', geo: cylinder(0.544, 0.544, 0.118, 20) });
  batchProp('training_reel_cord', { key: 'rubber', geo: reelCord() });
  batchProp('training_reel_hub', { key: 'steel', geo: cylinder(0.082, 0.082, 0.025, 12) });
  batchProp('training_reel_fastener', { key: 'steel', geo: cylinder(0.025, 0.025, 0.015, 6) });
  batchProp('training_flag_ballast', { key: 'concrete_prop', geo: cylinder(0.21, 0.26, 0.218) });
  batchProp('training_flag_ferrule', { key: 'steel', geo: cylinder(0.051, 0.051, 0.077, 12) });
  batchProp('training_flag_pole', { key: 'metal_dark', geo: cylinder(0.02, 0.02, 1.44, 12) });
  batchProp('training_flag_sleeve', { key: 'steel', geo: cylinder(0.026, 0.026, 0.025, 12) });
  for (const [id, key, seed] of [
    ['training_yard_flag', 'fabric_teal', 3],
    ['training_bay_flag', 'fabric_red', 11],
  ] as const)
    batchProp(id, {
      key,
      geo: clothGeometry(0.67, 0.33, {
        segX: 10,
        segY: 4,
        sag: 0.025,
        wrinkle: 0.013,
        bulge: 0.042,
        seed,
      }),
    });
  batchProp('training_cone_base', { key: 'rubber', geo: chamferBox(0.315, 0.042, 0.315, 0.022) });
  batchProp('training_cone_shell', {
    key: 'training_red',
    ballisticSurface: 'rubber',
    geo: cylinder(0.04, 0.146, 0.414),
  });

  issueCounter(A);
  equipmentShed(A);
  supplyLanding(A);
  markerPocket(A, -9.05, -1.5, -1);
  markerPocket(A, 9.2 + BAY_SHIFT, -3.2, 1);

  // Trackside tyre course and a shaded water stop, outside the marked routes.
  for (let i = 0; i < 5; i++)
    A.put('tyre', -17.7 - (i % 2) * 0.65, 0, -10.4 - i * 0.74, i * 0.57, 1.16);
  for (const [x, z, yaw, cloth] of [
    [-21.26, -5.2, -Math.PI / 2, 'fabric_teal'],
    [21.26 + BAY_SHIFT, -7.5, Math.PI / 2, 'fabric_red'],
  ] as const) {
    const wall = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    awning(A, wall, 0, 2.41, 5.4, null, { depth: 1.95, key: cloth, key2: cloth, legs: true });
    const inside = x - Math.sign(x) * 1.04;
    A.put('table', inside, 0, z, yaw);
    A.put('chair', inside, 0, z + 1.37, 0.18);
  }
  A.put('water_tank', 17.2 + BAY_SHIFT, 0, -10.9, 0.1);
  // High pennants give the two side yards a silhouette from the arrival apron.
  for (const [x, z, flag] of [
    [-8.15, -8, 'training_yard_flag'],
    [8.15 + BAY_SHIFT, -11, 'training_bay_flag'],
  ] as const) {
    box(A, 'metal_dark', x, 2.09, z, 0.072, 4.18, 0.072);
    A.putS(flag, x + 0.64, 3.78, z - 0.13, 0.2, 2, 2.1, 1);
  }
}
