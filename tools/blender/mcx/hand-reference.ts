#!/usr/bin/env bun
// Explicit offline calibration for Blender-authored wrists/fingers, not a build stage.
import { writeFileSync } from 'node:fs';

import { GRIP_CONTACTS, FIRING_FINGER_SPREAD } from '../../../src/weapons/grip-contacts.ts';
import { HAND_POSES } from '../../../src/weapons/hand-poses.ts';
import { Arm } from '../../../src/weapons/hands.ts';
import {
  basis,
  handPose,
  type GripFrame,
  type Side,
  type HandSideReference,
  type GripOptions,
} from '../hand-reference.ts';

const grips: Record<Side, GripFrame> = {
  right: { pos: [0.0351, -0.012, 0.086], finger: [0.15, 0.35, -0.92], back: [1, 0.03, 0.04] },
  left: { pos: [-0.073, 0.04, -0.243], finger: [0.7, -0.1, -0.71], back: [-0.14, -0.985, 0.001] },
};
const contact = GRIP_CONTACTS.mcx;
const vec3 = (value: number[]): [number, number, number] => [value[0]!, value[1]!, value[2]!];
const sides: Partial<Record<Side, HandSideReference>> = {};
for (const side of ['right', 'left'] as const) {
  const grip = grips[side];
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? 0.97 : 1 });
  arm.hand.position.fromArray(grip.pos);
  arm.hand.quaternion.copy(basis(grip.finger, grip.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left') {
    arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, 0.07, 0], [0, 0, 1], 0.026, {
      clearance: 0.001,
      poseName: 'clamp',
    });
  }
  const options: GripOptions =
    side === 'right'
      ? {
          thumb: vec3(contact.rightThumb),
          index: vec3(contact.trigger),
          spread: FIRING_FINGER_SPREAD,
        }
      : { thumb: vec3(contact.leftThumb), thumbPole: vec3(contact.leftThumbPole) };
  arm.fitGrip('mcx', options);
  sides[side] = {
    quaternion: arm.hand.quaternion.toArray(),
    grip: structuredClone(handPose(arm, 'mcx')),
  };
}
writeFileSync(
  new URL('../../../assets/weapons/mcx-virtus/hand-reference.json', import.meta.url),
  JSON.stringify({ grips, sides, pinch: HAND_POSES.pinch, open: HAND_POSES.open }, null, 2) + '\n'
);
console.log('MCX hand calibration written; rebuild Blender actions after editing.');
