#!/usr/bin/env node
// Offline shared Arm fitting, in game metres. Blender authors the actual paths.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Arm } from '../src/weapons/hands.ts';
import { writeFileSync } from 'node:fs';
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
};
const grips = {
  right: { pos: [.037, -.020, .130], finger: [.08, .35, -.933], back: [1, 0, 0] },
  left: { pos: [-.0394, .0377, -.220], finger: [.326, -.30, -.897], back: [-.473, -.873, .120] },
};
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
  assert(point.distanceTo(goal) < .002, `M590 finger ${i}: unreachable patch ${point.distanceTo(goal)}`);
}

function measure(arm) {
  arm.root.updateMatrixWorld(true);
  const pads = arm.fingers.map((f, i) => new THREE.Vector3(0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * .5).applyMatrix4(f.joints[2].matrixWorld).toArray());
  // Common runtime contact test uses this same trigger patch and thumb centre.
  if (arm.side === 1) pads[0] = new THREE.Vector3(0, -.006, -.013).applyMatrix4(arm.fingers[0].joints[2].matrixWorld).toArray();
  const thumb = new THREE.Vector3(0, 0, -.026 * arm.scale).applyMatrix4(arm.thumb.joints[1].matrixWorld).toArray();
  const thumbPad = new THREE.Vector3(0, -.0078 * arm.scale, -.026 * arm.scale).applyMatrix4(arm.thumb.joints[1].matrixWorld).toArray();
  return { pads, thumb, thumbPad };
}
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? .97 : 1 });
  arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'left' ? 'clamp' : 'gripShotgun');
  if (side === 'left') arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, .0446, 0], [0, 0, 1], .019, { clearance: .001, poseName: 'm590' });
  if (side === 'left') {
    arm.setPose('m590');
    for (const [i, p] of measure(arm).pads.entries()) {
      if (i === 0) { fitFinger(arm, i, [.0138, .0315, -.378]); continue; }
      if (i !== 1) continue;
      const r = Math.hypot(p[0], p[1] - .0446);
      fitFinger(arm, i, [p[0] * .019 / r, .0446 + (p[1] - .0446) * .019 / r, p[2]]);
    }
    arm.poses.m590.fingers = arm.fingers.map(f => f.joints.map(j => -j.rotation.x));
    arm.poses.m590.fingerSpread = arm.fingers.map(f => f.root.rotation.y);
  }
  arm.fitGrip('m590', side === 'left'
    ? { thumb: [-.022, .054, -.315], thumbPole: [-1, 0, 0] }
    : { thumb: [-.024, .032, .062], index: [0, .024, .0025], spread: [0, .60, .62, .64] });
  arm.setPose('m590');
  result.sides[side] = { quaternion: arm.hand.quaternion.toArray(), grip: structuredClone(arm.poses.m590), ...measure(arm) };
}
const arm = new Arm(-1, { scale: .97 });
const g = { pos: [-.035, -.137, -.050], finger: [0, 1, 0], back: [-1, 0, 0] };
arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger, g.back)); arm.setPose('clamp');
arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, -.0281, 0], [0, 0, 1], .00906, { clearance: .001, poseName: 'shell' });
for (const [i, z] of [-.025, -.042, -.058, -.073].entries()) fitFinger(arm, i, [.0096, -.0281, z]);
arm.poses.shell.fingers = arm.fingers.map(f => f.joints.map(j => -j.rotation.x));
arm.poses.shell.fingerSpread = arm.fingers.map(f => f.root.rotation.y);
arm.fitGrip('shell', { thumb: [-.0064, -.034, -.040], thumbPole: [-1, 0, 0] }); arm.setPose('shell');
result.shell = { pos: g.pos, quaternion: arm.hand.quaternion.toArray(), pose: structuredClone(arm.poses.shell), ...measure(arm),
  hullPosition: [0, -.0281, -.015], hullQuaternion: [0, 0, 0, 1], length: .07, rimRadius: .01105 };
for (const p of [...result.shell.pads, result.shell.thumbPad]) {
  assert(p[2] <= -.015 && p[2] >= -.085, `shell pad outside 70mm hull: ${p}`);
  assert(Math.abs(Math.hypot(p[0], p[1] + .0281) - .00906) < .002, `shell pad misses hull: ${p}`);
}
// Release the wrap before insertion; the thumb pushes the rim from below while
// the curled finger chain remains outside the receiver, not inside the hull.
arm.hand.position.set(-.0113, -.146, -.024); arm.hand.quaternion.copy(basis(g.finger, g.back));
arm.poses.insertion = { ...structuredClone(result.shell.pose), fingers: Array.from({ length: 4 }, (_, i) => [i === 3 ? 1.70 : 1.48, 1.45, 1.15]), fingerSpread: [0, 0, 0, 0] };
arm.setPose('insertion');
const rimPad = new THREE.Vector3(0, -.0386, -.01475), centre = rimPad.clone().add(new THREE.Vector3(0, -.007, .006));
for (let pass = 0; pass < 18; pass++) {
  arm.fitGrip('insertion', { thumb: centre.toArray(), thumbPole: [0, 0, 1] });
  const pad = new THREE.Vector3(...measure(arm).thumbPad);
  centre.add(rimPad.clone().sub(pad));
  if (pad.distanceTo(rimPad) < .0001) break;
}
assert(new THREE.Vector3(...measure(arm).thumbPad).distanceTo(rimPad) < .001, `insertion thumb must reach real rim: ${JSON.stringify(measure(arm).thumbPad)}, error ${new THREE.Vector3(...measure(arm).thumbPad).distanceTo(rimPad)}`);
result.insertion = { pos: arm.hand.position.toArray(), quaternion: arm.hand.quaternion.toArray(), pose: structuredClone(arm.poses.insertion), ...measure(arm), rimPad: rimPad.toArray() };
result.contactWindows = { Pump: { forend: [0, .45] }, Reload_Tactical: { shell: [.34 * .55, .58 * .55], release: [.58 * .55, .70 * .55], thumb: [.70 * .55, .82 * .55], insertionClearance: [.58 * .55, .55] },
  Reload_Empty: { shell: [.44 * .95, .50 * .95], release: [.50 * .95, .58 * .95], thumb: [.58 * .95, .68 * .95], insertionClearance: [.50 * .95, .95], forend: [[0, .22 * .95], [.78 * .95, .95]] } };
result.pump = { stroke: [0, 0, .038], restPads: result.sides.left.pads, strokePads: result.sides.left.pads.map(p => [p[0], p[1], p[2] + .038]) };
writeFileSync(new URL('../assets/weapons/m590/hand-reference.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log('M590 shared wrist/finger, shell contact and pump seed written. Rebuild Blender source/export.');
