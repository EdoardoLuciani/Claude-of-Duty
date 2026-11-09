#!/usr/bin/env bun
// Offline contact authoring seed. Blender owns the resulting action curves;
// this does not run in the game or modify the shared arm asset.
import { writeFileSync } from 'node:fs';

import { Arm } from '../../../src/weapons/hands.ts';
import {
  basis,
  handPose,
  type GripFrame,
  type Side,
  type HandPose,
  type HandSideReference,
} from '../hand-reference.ts';

const grips: Record<Side, GripFrame> = {
  right: { pos: [0.031, -0.037, 0.087], finger: [0, 0.25, -0.968], back: [0.98, 0.01, -0.2] },
  left: { pos: [-0.037, -0.05, 0.072], finger: [-0.15, 0.18, -0.972], back: [-0.99, 0.12, -0.13] },
};
type SideReference = HandSideReference & { release?: HandPose };
const sides: Partial<Record<Side, SideReference>> = {};
const result = { grips, sides };
for (const side of ['right', 'left'] as const) {
  const g = grips[side];
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? 0.97 : 1 });
  arm.hand.position.fromArray(g.pos);
  arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripPistol' : 'cup');
  arm.fitGrip(
    'p320',
    side === 'right'
      ? {
          thumb: [-0.023, 0.012, 0.024],
          index: [0, -0.008, -0.035],
          spread: [0, 0.6, 0.62, 0.64],
          fingers: [
            [0.05, 0.7, 1.1],
            [0.78, 1.18, 0.72],
            [0.84, 1.24, 0.75],
            [0.9, 1.3, 0.78],
          ],
        }
      : {
          thumb: [-0.024, 0.01, -0.014],
          thumbPole: [0, 0, -1],
          spread: [0.35, 0.4, 0.45, 0.5],
          fingers: [
            [0.82, 1.12, 0.86],
            [0.85, 1.14, 0.9],
            [0.9, 1.18, 0.9],
            [0.95, 1.2, 0.85],
          ],
        }
  );
  const entry: SideReference = {
    quaternion: arm.hand.quaternion.toArray(),
    grip: structuredClone(handPose(arm, 'p320')),
  };
  sides[side] = entry;
  arm.fitGrip('release', {
    thumb: side === 'right' ? [-0.022, -0.018, 0.003] : [-0.022, 0.02, 0.006],
    thumbPole: side === 'right' ? [0, 0, 1] : [0, 0, -1],
  });
  entry.release = structuredClone(handPose(arm, 'release'));
}
// Retained/fresh magazine contact in the magazine's local frame. Blender
// keys this contact against the magazine trajectory, not a free-floating path.
const support = new Arm(-1, { scale: 0.97 });
const magGrip: GripFrame = {
  pos: [-0.032, -0.146, 0.035],
  finger: [0.08, 0.96, -0.26],
  back: [-1, 0, 0],
};
support.hand.position.fromArray(magGrip.pos);
support.hand.quaternion.copy(basis(magGrip.finger, magGrip.back));
support.setPose('wrap');
support.fitToCylinder(
  support.hand.position,
  support.hand.quaternion,
  [0, -0.04, 0.014],
  [0, 1, -0.22],
  0.016,
  { clearance: 0.0015, poseName: 'magazine' }
);
support.fitGrip('magazine', { thumb: [0.012, -0.065, 0.025], thumbPole: [0, 0, 1] });
const magazine = {
  pos: magGrip.pos,
  quaternion: support.hand.quaternion.toArray(),
  pose: handPose(support, 'magazine'),
};
writeFileSync(
  new URL('../../../assets/weapons/p320-compact/hand-reference.json', import.meta.url),
  JSON.stringify({ ...result, magazine }, null, 2) + '\n'
);
console.log('P320 contact seed written; rebuild Blender actions after changing this file.');
