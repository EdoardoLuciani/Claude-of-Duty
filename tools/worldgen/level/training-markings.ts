import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

import type { Assembler } from '../builder.ts';
import { Accum, quad, trs } from '../util.ts';

export type TrainingPaint =
  | 'training_white'
  | 'training_ink'
  | 'training_yellow'
  | 'training_red'
  | 'training_letter';
const PAINT = { visualOnly: true };
const matrix = new THREE.Matrix4();

export function paintPlane(
  A: Assembler,
  key: TrainingPaint,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  flat = false,
  yaw = 0
): void {
  const plane = A.cache('training:paint', quad);
  A.add(key, plane, trs(matrix, x, y, z, yaw, w, h, 1, flat ? -Math.PI / 2 : 0), PAINT);
}

export function paintRing(
  A: Assembler,
  key: TrainingPaint,
  x: number,
  y: number,
  z: number,
  inner: number,
  outer: number,
  flat = false
): void {
  const geo =
    inner > 0 ? new THREE.RingGeometry(inner, outer, 64) : new THREE.CircleGeometry(outer, 64);
  A.addOnce(key, geo, trs(matrix, x, y, z, 0, 1, 1, 1, flat ? -Math.PI / 2 : 0), PAINT);
}

// A small geometric sign alphabet. Each pair is a point on the letter's
// centerline; a pipe separates strokes. The bake needs no host font.
const STROKES: Partial<Record<string, string>> = {
  '0': '20 40 61 67 48 28 07 01 20',
  '1': '22 40 48|28 68',
  '2': '01 20 40 61 63 08 68',
  '4': '40 05 65|40 48',
  '5': '60 00 03 43 64 67 48 18 07',
  '6': '60 20 02 07 28 48 67 65 44 24 04',
  '8': '20 40 61 63 44 24 03 01 20|24 05 07 28 48 67 65 44',
  A: '08 30 68|14 54',
  B: '08 00 40 61 63 44 04|44 65 67 48 08',
  C: '61 40 20 02 06 28 48 67',
  D: '08 00 40 62 66 48 08',
  E: '60 00 08 68|04 54',
  F: '08 00 60|04 54',
  G: '61 40 20 02 06 28 48 66 64 34',
  H: '00 08|04 64|60 68',
  I: '10 50|30 38|18 58',
  J: '60 66 48 28 06',
  K: '00 08|60 04 68',
  L: '00 08 68',
  M: '08 00 34 60 68',
  N: '08 00 68 60',
  O: '20 40 62 66 48 28 06 02 20',
  P: '08 00 40 61 63 44 04',
  R: '08 00 40 61 63 44 04|34 68',
  S: '61 40 20 01 03 24 44 65 67 48 28 07',
  T: '00 60|30 38',
  U: '00 06 28 48 66 60',
  V: '00 38 60',
  W: '00 18 34 58 60',
  Y: '00 34 60|34 38',
  '>': '04 64|41 64 47',
  '<': '64 04|21 04 27',
};

export function paintText(
  A: Assembler,
  key: TrainingPaint,
  text: string,
  x: number,
  y: number,
  z: number,
  height: number,
  flat = false,
  yaw = 0
): void {
  const acc = new Accum();
  const left = -(text.length * 8.5 - 2.5) * 0.5;
  const style = SVGLoader.getStrokeStyle(1.44, undefined, 'round', 'square');
  for (const [i, letter] of Array.from(text).entries()) {
    if (letter === ' ') continue;
    const glyph = STROKES[letter];
    if (!glyph) throw new Error(`[world] unsupported training sign glyph ${letter}`);
    for (const path of glyph.split('|')) {
      const points = path
        .split(' ')
        .map(
          (pair): THREE.Vector2 =>
            new THREE.Vector2(left + i * 8.5 + Number(pair[0]), 4 - Number(pair[1]))
        );
      const stroke = SVGLoader.pointsToStroke(points, style);
      acc.add(stroke);
      stroke.dispose();
    }
  }
  const scale = height / 9.44;
  A.addOnce(
    key,
    acc.build(),
    trs(matrix, x, y, z, yaw, scale, scale, 1, flat ? -Math.PI / 2 : 0),
    PAINT
  );
}
