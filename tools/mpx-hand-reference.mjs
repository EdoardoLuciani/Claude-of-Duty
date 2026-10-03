#!/usr/bin/env node
// Offline shared-hand contact seed. Blender owns all subsequent wrist/finger curves.
import * as THREE from 'three';
import { Arm } from '../src/weapons/hands.js';
import { writeFileSync } from 'node:fs';
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
};
const grips = {
  right: { pos: [.035, -.065, .127], finger: [.15, .35, -.92], back: [1, .03, .04] },
  left: { pos: [-.067, -.022, -.180], finger: [.70, -.10, -.71], back: [-.14, -.985, .001] },
};
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? .97 : 1 });
  arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left') arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, .005, 0], [0, 0, 1], .025, { clearance: .0015, poseName: 'mpx' });
  arm.fitGrip('mpx', side === 'right'
    ? { thumb: [-.022, -.050, .052], index: [0, -.058, .008], spread: [0, .60, .62, .64] }
    : { thumb: [-.024, .038, -.221], thumbPole: [0, 0, -1] });
  result.sides[side] = { quaternion: arm.hand.quaternion.toArray(), grip: structuredClone(arm.poses.mpx) };
  if (side === 'right') {
    arm.setPose('mpx'); arm.fitGrip('release', { index: [.027, -.043, -.034] });
    result.sides.right.release = structuredClone(arm.poses.release);
  }
}
for (const [name, g, contacts] of [
  ['magazine', { pos: [-.042, -.182, -.040], finger: [.10, .98, -.15], back: [-1, 0, 0] }, { thumb: [.017, -.113, -.101], thumbPole: [0, 0, 1] }],
  ['boltRelease', { pos: [-.133, -.003, -.028], finger: [.92, -.1, -.38], back: [0, 1, 0] }, { index: [-.031, -.037, -.033], thumb: [-.030, -.055, -.034], thumbPole: [-1, 0, 0] }],
]) {
  const arm = new Arm(-1, { scale: .97 });
  arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger, g.back)); arm.setPose(name === 'magazine' ? 'wrap' : 'pinch');
  if (name === 'magazine') arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, -.13, -.095], [0, 1, .35], .019, { clearance: .0015, poseName: name });
  arm.fitGrip(name, contacts);
  result[name] = { pos: g.pos, quaternion: arm.hand.quaternion.toArray(), pose: arm.poses[name] };
}
writeFileSync(new URL('../assets/weapons/sig-mpx/hand-reference.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log('MPX shared-hand contacts written; regenerate Blender actions after edits.');
