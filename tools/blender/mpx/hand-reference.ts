#!/usr/bin/env bun
// Offline shared-hand contact fitting. Blender owns the subsequent curves.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import * as THREE from 'three';

import { Arm } from '../../../src/weapons/hands.ts';
import {
  basis,
  fitFinger,
  handPose,
  snapshotFingers,
  type GripFrame,
  type Side,
  type HandPose,
  type HandSideReference,
} from '../hand-reference.ts';

const snapshot = (arm: Arm): HandPose => ({
  ...snapshotFingers(arm),
  thumb: arm.thumb.joints.map((j): number => -j.rotation.x),
  thumbBase: [arm.thumb.root.rotation.x, arm.thumb.root.rotation.y, arm.thumb.root.rotation.z],
});
function thumbPose(
  arm: Arm,
  name: string,
  target: THREE.Vector3Tuple,
  pole: THREE.Vector3Tuple = [0, 0, 1]
): HandPose {
  arm.poses[name] = snapshot(arm);
  arm.setPose(name);
  arm.fitGrip(name, { thumb: target, thumbPole: pole });
  arm.root.updateMatrixWorld(true);
  const p = new THREE.Vector3(0, 0, -0.026 * arm.scale).applyMatrix4(
    arm.thumb.joints[1].matrixWorld
  );
  assert(p.distanceTo(new THREE.Vector3(...target)) < 0.002, `${name}: unreachable thumb`);
  assert(handPose(arm, name).thumb[1] < 1.6, `${name}: over-flexed thumb`);
  return structuredClone(handPose(arm, name));
}
// Lower the firing wrist and tilt it forward; the fitter preserves the same
// trigger, thumb and three grip-pad targets under the existing joint bounds.
const grips: Record<Side, GripFrame> = {
  right: { pos: [0.03, -0.11, 0.16], finger: [0, 0.111, -0.9938], back: [1, 0, 0] },
  left: { pos: [-0.067, -0.022, -0.125], finger: [0.7, -0.1, -0.71], back: [-0.14, -0.985, 0.001] },
};
const sides: Partial<
  Record<
    Side,
    HandSideReference & {
      thumb: THREE.Vector3Tuple;
      indexed?: HandPose;
      pads?: THREE.Vector3Tuple[];
    }
  >
> = {};
const result = { grips, sides };
for (const side of ['right', 'left'] as const) {
  const g = grips[side];
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? 0.97 : 1 });
  arm.hand.position.fromArray(g.pos);
  arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left') {
    arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, 0.005, 0], [0, 0, 1], 0.025, {
      clearance: 0.0015,
      poseName: 'mpx',
    });
    const thumb: THREE.Vector3Tuple = [-0.024, 0.038, -0.166];
    arm.fitGrip('mpx', { thumb, thumbPole: [0, 0, -1] });
    result.sides.left = {
      quaternion: arm.hand.quaternion.toArray(),
      grip: structuredClone(handPose(arm, 'mpx')),
      thumb,
    };
  } else {
    const pads: THREE.Vector3Tuple[] = [
      [0, -0.058, 0.008],
      [-0.017, -0.087, 0.058],
      [-0.018, -0.105, 0.07],
      [-0.017, -0.127, 0.084],
    ];
    for (let i = 0; i < 4; i++) fitFinger(arm, i, pads[i], 'MPX', i === 0);
    const thumb: THREE.Vector3Tuple = [-0.022, -0.067, 0.067],
      grip = thumbPose(arm, 'mpx', thumb);
    for (const joint of arm.fingers[0].joints) joint.rotation.x = -0.05;
    fitFinger(arm, 0, [0.029, -0.039, -0.014], 'MPX', true);
    result.sides.right = {
      quaternion: arm.hand.quaternion.toArray(),
      grip,
      indexed: snapshot(arm),
      pads,
      thumb,
    };
  }
}
const magazine: GripFrame = { pos: [-0.04, -0.135, -0.005], finger: [0, 0, -1], back: [-1, 0, 0] };
const left = new Arm(-1, { scale: 0.97 });
left.hand.position.fromArray(magazine.pos);
left.hand.quaternion.copy(basis(magazine.finger, magazine.back));
left.setPose('wrap');
// Side-face patches at the frozen photo-registered curve stations. Every
// finger stays on the body below the well; none reaches up into the guard.
const pads: THREE.Vector3Tuple[] = [
  [0.0145, -0.106, -0.0905],
  [0.0145, -0.125, -0.0955],
  [0.0145, -0.145, -0.1035],
  [0.0145, -0.164, -0.111],
];
for (let i = 0; i < 4; i++) fitFinger(left, i, pads[i], 'MPX');
const thumb: THREE.Vector3Tuple = [0.021, -0.11, -0.092];
const magazineContact = {
  pos: magazine.pos,
  quaternion: left.hand.quaternion.toArray(),
  pose: thumbPose(left, 'magazine', thumb),
  pads,
  thumb,
};
const catchThumb: THREE.Vector3Tuple = [-0.0325, -0.043, -0.034];
const magazineRelease = {
  pos: magazine.pos,
  quaternion: left.hand.quaternion.toArray(),
  pose: thumbPose(left, 'magazineRelease', catchThumb, [-1, 0, 0]),
  thumb: catchThumb,
};
const bolt: GripFrame = {
  pos: [-0.075, -0.11, 0.016],
  finger: [0, -0.35, -0.937],
  back: [-1, 0, 0],
};
left.hand.position.fromArray(bolt.pos);
left.hand.quaternion.copy(basis(bolt.finger, bolt.back));
left.setPose('wrap');
const boltThumb: THREE.Vector3Tuple = [-0.036, -0.035, -0.033];
const boltRelease = {
  pos: bolt.pos,
  quaternion: left.hand.quaternion.toArray(),
  pose: thumbPose(left, 'boltRelease', boltThumb),
  thumb: boltThumb,
};
left.setPose('open');
const rest = snapshot(left);
rest.fingers = [
  [0.15, 0.25, 0.18],
  [0.2, 0.3, 0.2],
  [0.25, 0.32, 0.24],
  [0.32, 0.36, 0.27],
];
// Released-hand direction must remain viable while native draw composes with
// shared aim-in. Contact wrist/pose at the end of draw is still the grip above.
const restLeft = {
  pos: [-0.21, -0.13, 0.02],
  quaternion: basis([-0.05, 0.0242, -0.9985], [-0.9, 0.4153, 0.0557]).toArray(),
  pose: rest,
};
writeFileSync(
  new URL('../../../src/weapons/authored/sig-mpx/hand-reference.json', import.meta.url),
  JSON.stringify(
    { ...result, magazine: magazineContact, magazineRelease, boltRelease, restLeft },
    null,
    2
  ) + '\n'
);
console.log('MPX shared-hand pads/thumbs fitted; regenerate Blender actions after edits.');
