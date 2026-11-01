#!/usr/bin/env node
// Offline seed for Blender wrist/finger authoring; never runs in the game.
import { writeFileSync } from 'node:fs';

import * as THREE from 'three';

import { Arm } from '../../../src/weapons/hands.ts';
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back)
    .addScaledVector(z, -new THREE.Vector3(...back).dot(z))
    .normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z)
  );
};
const grips = {
  right: { pos: [0.0351, -0.012, 0.1228], finger: [0.15, 0.35, -0.92], back: [1, 0.03, 0.04] },
  left: {
    pos: [-0.067358, 0.048661, -0.193517],
    finger: [0.7, -0.1, -0.71],
    back: [-0.14, -0.985, 0.001],
  },
};
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? 0.97 : 1 });
  arm.hand.position.fromArray(g.pos);
  arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left')
    arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, 0.075, 0], [0, 0, 1], 0.0285, {
      clearance: 0.0015,
      poseName: 'm4',
    });
  arm.fitGrip(
    'm4',
    side === 'right'
      ? { thumb: [-0.025, 0.048, 0.046], index: [0, 0.0235, 0.004], spread: [0, 0.6, 0.62, 0.64] }
      : { thumb: [-0.0134, 0.1065, -0.252], thumbPole: [0, 0, -1] }
  );
  result.sides[side] = {
    quaternion: arm.hand.quaternion.toArray(),
    grip: structuredClone(arm.poses.m4),
  };
  if (side === 'right') {
    arm.setPose('m4');
    arm.fitGrip('release', { index: [0.025, 0.0505, -0.0295] });
    result.sides.right.release = structuredClone(arm.poses.release);
  }
}
const arm = new Arm(-1, { scale: 0.97 });
const magGrip = { pos: [-0.038, -0.121, -0.016], finger: [0.1, 0.98, -0.15], back: [-1, 0, 0] };
arm.hand.position.fromArray(magGrip.pos);
arm.hand.quaternion.copy(basis(magGrip.finger, magGrip.back));
arm.setPose('wrap');
arm.fitToCylinder(
  arm.hand.position,
  arm.hand.quaternion,
  [0, -0.035, -0.069],
  [0, 1, -0.11],
  0.02,
  { clearance: 0.0015, poseName: 'magazine' }
);
arm.fitGrip('magazine', { thumb: [0.017, -0.04, -0.061], thumbPole: [0, 0, 1] });
result.magazine = {
  pos: magGrip.pos,
  quaternion: arm.hand.quaternion.toArray(),
  pose: arm.poses.magazine,
};
// Overhand hook on the left latch; the palm stays above/outboard of the stock.
const charging = { pos: [-0.158, 0.13, 0.07], finger: [0.9, 0, -0.436], back: [0, 1, 0] };
arm.hand.position.fromArray(charging.pos);
arm.hand.quaternion.copy(basis(charging.finger, charging.back));
arm.setPose('pinch');
arm.fitGrip('charging', {
  index: [-0.027, 0.104, 0.062],
  thumb: [-0.035, 0.105, 0.079],
  thumbPole: [-1, 0, 0],
  fingers: [
    [0.5, 0.9, 0.8],
    [1.1, 1.2, 0.8],
    [1.1, 1.2, 0.8],
    [1.1, 1.2, 0.8],
  ],
  spread: [0, 0, 0, 0],
});
result.charging = {
  pos: charging.pos,
  quaternion: arm.hand.quaternion.toArray(),
  pose: arm.poses.charging,
};
writeFileSync(
  new URL('../../../assets/weapons/m4a1-block-ii/hand-reference.json', import.meta.url),
  JSON.stringify(result, null, 2) + '\n'
);
console.log('M4 hand control seed written; rebuild Blender actions after editing.');
