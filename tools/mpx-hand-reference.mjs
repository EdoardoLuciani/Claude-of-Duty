#!/usr/bin/env node
// Offline shared-hand contact fitting. Blender owns the subsequent curves.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Arm } from '../src/weapons/hands.js';
import { writeFileSync } from 'node:fs';
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
};
const snapshot = arm => ({
  fingers: arm.fingers.map(f => f.joints.map(j => -j.rotation.x)),
  fingerSpread: arm.fingers.map(f => f.root.rotation.y),
  thumb: arm.thumb.joints.map(j => -j.rotation.x),
  thumbBase: arm.thumb.root.rotation.toArray().slice(0, 3),
});
// Fit a palmar patch, not just a wrist or an infinite cylinder. Joint bounds
// keep the solution out of hyper-flexed DIP and folded-back MCP configurations.
function fitFinger(arm, i, target, index = false) {
  const f = arm.fingers[i], point = new THREE.Vector3(), goal = new THREE.Vector3(...target);
  const patch = index ? [0, -.006 * arm.scale, -.013 * arm.scale]
    : [0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * .5];
  const limits = [[-1.5, .2], [-1.65, .1], [-1.35, .1], [-.6, .6]];
  arm.root.updateMatrixWorld(true);
  for (let pass = 0; pass < 12; pass++) for (let j = 0; j < 4; j++) {
    const rotation = j < 3 ? f.joints[j].rotation : f.root.rotation, axis = j < 3 ? 'x' : 'y';
    const [lo, hi] = limits[j], centre = rotation[axis], radius = .1 * 2 ** (7 - pass);
    let best = centre, cost = Infinity;
    for (let n = 0; n <= 48; n++) {
      const angle = pass < 7 ? lo + (hi - lo) * n / 48 : THREE.MathUtils.clamp(centre + radius * (2 * n / 48 - 1), lo, hi);
      rotation[axis] = angle; f.joints[2].updateWorldMatrix(true, false);
      point.fromArray(patch).applyMatrix4(f.joints[2].matrixWorld);
      const c = point.distanceToSquared(goal);
      if (c < cost) { cost = c; best = angle; }
    }
    rotation[axis] = best;
  }
  f.joints[2].updateWorldMatrix(true, false); point.fromArray(patch).applyMatrix4(f.joints[2].matrixWorld);
  assert(point.distanceTo(goal) < .002, `MPX finger ${i}: unreachable patch ${point.distanceTo(goal)}`);
}
function thumbPose(arm, name, target, pole = [0, 0, 1]) {
  arm.poses[name] = snapshot(arm); arm.setPose(name);
  arm.fitGrip(name, { thumb: target, thumbPole: pole });
  arm.root.updateMatrixWorld(true);
  const p = new THREE.Vector3(0, 0, -.026 * arm.scale).applyMatrix4(arm.thumb.joints[1].matrixWorld);
  assert(p.distanceTo(new THREE.Vector3(...target)) < .002, `${name}: unreachable thumb`);
  assert(arm.poses[name].thumb[1] < 1.6, `${name}: over-flexed thumb`);
  return structuredClone(arm.poses[name]);
}
const grips = {
  right: { pos: [.030, -.080, .164], finger: [0, -.15, -.9887], back: [1, 0, 0] },
  left: { pos: [-.067, -.022, -.125], finger: [.70, -.10, -.71], back: [-.14, -.985, .001] },
};
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? .97 : 1 });
  arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left') {
    arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, .005, 0], [0, 0, 1], .025, { clearance: .0015, poseName: 'mpx' });
    arm.fitGrip('mpx', { thumb: [-.024, .038, -.166], thumbPole: [0, 0, -1] });
    result.sides.left = { quaternion: arm.hand.quaternion.toArray(), grip: structuredClone(arm.poses.mpx) };
  } else {
    const pads = [[0, -.058, .008], [-.017, -.087, .058], [-.018, -.105, .070], [-.017, -.127, .084]];
    for (let i = 0; i < 4; i++) fitFinger(arm, i, pads[i], i === 0);
    const thumb = [-.022, -.067, .067], grip = thumbPose(arm, 'mpx', thumb);
    for (const joint of arm.fingers[0].joints) joint.rotation.x = -.05;
    fitFinger(arm, 0, [.029, -.039, -.014], true);
    result.sides.right = { quaternion: arm.hand.quaternion.toArray(), grip, indexed: snapshot(arm), pads, thumb };
  }
}
const magazine = { pos: [-.040, -.135, -.005], finger: [0, 0, -1], back: [-1, 0, 0] };
const left = new Arm(-1, { scale: .97 });
left.hand.position.fromArray(magazine.pos); left.hand.quaternion.copy(basis(magazine.finger, magazine.back)); left.setPose('wrap');
// Side-face patches at the frozen photo-registered curve stations. Every
// finger stays on the body below the well; none reaches up into the guard.
const pads = [[.0145, -.106, -.0905], [.0145, -.125, -.0955], [.0145, -.145, -.1035], [.0145, -.164, -.111]];
for (let i = 0; i < 4; i++) fitFinger(left, i, pads[i]);
const thumb = [.021, -.110, -.092];
result.magazine = { pos: magazine.pos, quaternion: left.hand.quaternion.toArray(), pose: thumbPose(left, 'magazine', thumb), pads, thumb };
const catchThumb = [-.0325, -.043, -.034];
result.magazineRelease = { pos: magazine.pos, quaternion: left.hand.quaternion.toArray(), pose: thumbPose(left, 'magazineRelease', catchThumb, [-1, 0, 0]), thumb: catchThumb };
const bolt = { pos: [-.075, -.110, .016], finger: [0, -.35, -.937], back: [-1, 0, 0] };
left.hand.position.fromArray(bolt.pos); left.hand.quaternion.copy(basis(bolt.finger, bolt.back)); left.setPose('wrap');
const boltThumb = [-.036, -.035, -.033];
result.boltRelease = { pos: bolt.pos, quaternion: left.hand.quaternion.toArray(), pose: thumbPose(left, 'boltRelease', boltThumb), thumb: boltThumb };
left.setPose('open');
const rest = snapshot(left); rest.fingers = [[.15, .25, .18], [.20, .30, .20], [.25, .32, .24], [.32, .36, .27]];
result.restLeft = { pos: [-.21, -.13, .02], quaternion: basis([-.05, -.4, -.915], [-.90, .4, -.125]).toArray(), pose: rest };
writeFileSync(new URL('../assets/weapons/sig-mpx/hand-reference.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log('MPX shared-hand pads/thumbs fitted; regenerate Blender actions after edits.');
