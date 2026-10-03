#!/usr/bin/env node
// Offline fitting inputs. Blender owns the resulting wrist/finger curves.
import * as THREE from 'three';
import { Arm } from '../src/weapons/hands.js';
import { mkdirSync, writeFileSync } from 'node:fs';
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
};
const grips = {
  right: { pos: [.038, .019, .139], finger: [.12, .32, -.94], back: [1, .03, .04] },
  left: { pos: [-.074, .044, -.205], finger: [.76, -.10, -.64], back: [-.13, -.985, .001] },
};
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? .97 : 1 });
  arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left') arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, .075, 0], [0, 0, 1], .027, { clearance: .0015, poseName: 'ax338' });
  arm.fitGrip('ax338', side === 'right'
    ? { thumb: [-.025, .072, .066], index: [0, .053, .016], spread: [0, .6, .62, .64] }
    : { thumb: [-.017, .101, -.263], thumbPole: [0, 0, -1] });
  result.sides[side] = { quaternion: arm.hand.quaternion.toArray(), grip: structuredClone(arm.poses.ax338) };
}
function contact(side, pos, finger, back, target, name) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? .97 : 1 });
  arm.hand.position.fromArray(pos); arm.hand.quaternion.copy(basis(finger, back)); arm.setPose('wrap');
  arm.fitGrip(name, target);
  return { pos, quaternion: arm.hand.quaternion.toArray(), pose: structuredClone(arm.poses[name]) };
}
result.magazine = contact('left', [-.047, -.08, .005], [.12, .97, -.20], [-1, 0, 0],
  { thumb: [.02, .008, -.070], thumbPole: [0, 0, 1] }, 'magazine');
result.bolt = contact('right', [.135, .02, .085], [-.30, .50, -.81], [.90, .25, -.18],
  { index: [.069, .049, .057], thumb: [.055, .060, .056], thumbPole: [1, 0, 0] }, 'bolt');
const out = new URL('../assets/weapons/ax338/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('hand-reference.json', out), JSON.stringify(result, null, 2) + '\n');
console.log('AX338 hand reference written; regenerate Blender actions after changes.');
