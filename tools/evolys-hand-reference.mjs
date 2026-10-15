#!/usr/bin/env node
// Offline input for Blender controls. Runtime uses these exact fitted poses.
import { mkdirSync, writeFileSync } from 'node:fs';

import * as THREE from 'three';

import { Arm } from '../src/weapons/hands.ts';
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
  right: { pos: [0.035, -0.035, 0.099], finger: [0.15, 0.35, -0.92], back: [1, 0.03, 0.04] },
  left: { pos: [-0.089, 0.022, -0.292], finger: [0.9, -0.1, -0.436], back: [-0.14, -0.985, 0.001] },
};
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? 0.97 : 1 });
  arm.hand.position.fromArray(g.pos);
  arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripLmg' : 'clamp');
  if (side === 'left')
    arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, 0.075, 0], [0, 0, 1], 0.027, {
      clearance: 0.0015,
      poseName: 'evolys',
    });
  arm.fitGrip(
    'evolys',
    side === 'right'
      ? {
          thumb: [-0.027, 0.02, 0.039],
          index: [0, -0.001, -0.019],
          fingers: [
            [0.2, 0.6, 0.8],
            [0.8, 1.3, 1.1],
            [1, 1.4, 1.1],
            [1.4, 1.4, 1.1],
          ],
          spread: [0, 0.6, 0.62, 0.64],
        }
      : { thumb: [-0.028, 0.089, -0.318], thumbPole: [0, 0, -1] }
  );
  result.sides[side] = {
    quaternion: arm.hand.quaternion.toArray(),
    grip: structuredClone(arm.poses.evolys),
  };
}
for (const [name, g, pose, contacts] of [
  [
    'pouch',
    { pos: [-0.094, -0.195, -0.1], finger: [0.1, 0.98, -0.15], back: [-1, 0, 0] },
    'wrap',
    { thumb: [-0.075, -0.099, -0.115], thumbPole: [0, 0, 1] },
  ],
  [
    'feed',
    { pos: [-0.132, 0.086, -0.13], finger: [0.9, 0, -0.436], back: [0, 1, 0] },
    'pinch',
    { index: [-0.043, 0.058, -0.175], thumb: [-0.047, 0.046, -0.18], thumbPole: [-1, 0, 0] },
  ],
  [
    'charging',
    { pos: [0.123, 0.135, -0.068], finger: [-0.9, 0, -0.436], back: [0, 1, 0] },
    'pinch',
    { index: [0.045, 0.073, -0.075], thumb: [0.049, 0.064, -0.081], thumbPole: [1, 0, 0] },
  ],
]) {
  const arm = new Arm(-1, { scale: 0.97 });
  arm.hand.position.fromArray(g.pos);
  arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(pose);
  arm.fitGrip(name, contacts);
  result[name] = { pos: g.pos, quaternion: arm.hand.quaternion.toArray(), pose: arm.poses[name] };
}
mkdirSync(new URL('../assets/weapons/fn-evolys-762/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../assets/weapons/fn-evolys-762/hand-reference.json', import.meta.url),
  JSON.stringify(result, null, 2) + '\n'
);
console.log('EVOLYS hand reference written; rebuild Blender actions after edits.');
