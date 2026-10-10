#!/usr/bin/env node
// Offline input for Blender controls. Runtime uses these exact fitted poses.
import * as THREE from 'three';
import { Arm } from '../src/weapons/hands.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
};
const grips = {
  right: { pos: [.035, -.035, .099], finger: [.15, .35, -.92], back: [1, .03, .04] },
  left: { pos: [-.089, .022, -.292], finger: [.90, -.10, -.436], back: [-.14, -.985, .001] },
};
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? .97 : 1 });
  arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripLmg' : 'clamp');
  if (side === 'left') arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, .075, 0], [0, 0, 1], .027, { clearance: .0015, poseName: 'evolys' });
  arm.fitGrip('evolys', side === 'right'
    ? { thumb: [-.027, .020, .039], index: [0, -.001, -.019], fingers: [[.2, .6, .8], [.8, 1.3, 1.1], [1, 1.4, 1.1], [1.4, 1.4, 1.1]], spread: [0, .60, .62, .64] }
    : { thumb: [-.028, .089, -.318], thumbPole: [0, 0, -1] });
  result.sides[side] = { quaternion: arm.hand.quaternion.toArray(), grip: structuredClone(arm.poses.evolys) };
}
for (const [name, g, pose, contacts] of [
  ['pouch', { pos: [-.094, -.195, -.10], finger: [.10, .98, -.15], back: [-1, 0, 0] }, 'wrap', { thumb: [-.075, -.099, -.115], thumbPole: [0, 0, 1] }],
  ['feed', { pos: [-.132, .086, -.13], finger: [.9, 0, -.436], back: [0, 1, 0] }, 'pinch', { index: [-.043, .058, -.175], thumb: [-.047, .046, -.180], thumbPole: [-1, 0, 0] }],
  ['charging', { pos: [.123, .135, -.068], finger: [-.90, 0, -.436], back: [0, 1, 0] }, 'pinch', { index: [.045, .073, -.075], thumb: [.049, .064, -.081], thumbPole: [1, 0, 0] }],
]) {
  const arm = new Arm(-1, { scale: .97 });
  arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger, g.back)); arm.setPose(pose);
  arm.fitGrip(name, contacts);
  result[name] = { pos: g.pos, quaternion: arm.hand.quaternion.toArray(), pose: arm.poses[name] };
}
mkdirSync(new URL('../assets/weapons/fn-evolys-762/', import.meta.url), { recursive: true });
writeFileSync(new URL('../assets/weapons/fn-evolys-762/hand-reference.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log('EVOLYS hand reference written; rebuild Blender actions after edits.');
