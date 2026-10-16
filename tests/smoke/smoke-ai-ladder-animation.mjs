import assert from 'node:assert/strict';

import * as THREE from 'three';

import { Animator } from '../../src/ai/animator.ts';
import { RIG } from '../../src/ai/rig.ts';

let probes = 0;
function actor() {
  const { bones } = RIG.createSkeleton();
  const root = new THREE.Group();
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const a = new Animator(RIG, bones, {
    probe() {
      probes++;
      return false;
    },
  });
  return a;
}
const pose = (a) => a.bones.flatMap((b) => [...b.position.toArray(), ...b.quaternion.toArray()]);
const near = (a, b) =>
  a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < 1e-7, `${i}: ${n} != ${b[i]}`));
const at = (a, travel, direction = 'up', phase = 'shaft', dt = 1 / 60) => {
  a.setClimb(true, travel, direction, phase);
  a.update(dt, 999);
  return pose(a);
};
const a = actor(),
  control = actor();
a.setState({ clip: 'run', speed: 4.3 });
control.setState({ clip: 'run', speed: 4.3 });
a.update(0.2, 1);
control.update(0.2, 1);
near(pose(a), pose(control));
const gaitPhase = a.phase,
  gaitClock = a._stepClock;
a.fire();
a.reload();
a.turn(1);
a.vault();
a.hit();
at(a, 0);
assert.equal(a.reloading, false);
assert.equal(a.vaulting, false);
for (const timer of ['recoilT', 'reloadT', 'turnT', 'vaultT', 'hitT']) assert.equal(a[timer], -1);
const rest = at(a, 0),
  raised = at(a, 0.15);
assert.notDeepEqual(rest, raised, 'actual bones follow travelled metres');
const rightHigh = a.bonePos('FootR', new THREE.Vector3()).y;
const leftLow = a.bonePos('FootL', new THREE.Vector3()).y;
assert.ok(rightHigh > leftLow + 0.15, 'boots alternate rung-reaching height');
assert.ok(a.bonePos('HandL', new THREE.Vector3()).y > 1.6, 'left hand reaches above shoulder');
const carry = a.bonePos('HandR', new THREE.Vector3());
assert.ok(
  carry.x < -0.28 && carry.y < 1.1 && a.muzzleDir.y < -0.95,
  'rifle carried low beside body, muzzle down'
);
near(rest, at(a, 0.6));
near(raised, at(a, 0.45, 'down'));
at(a, 0.15, 'down');
assert.ok(
  a.bonePos('FootL', new THREE.Vector3()).y > a.bonePos('FootR', new THREE.Vector3()).y + 0.15
);
for (const phase of ['align', 'shaft', 'dismount'])
  for (const direction of ['up', 'down']) {
    const held = at(a, 0.15, direction, phase);
    const beforeProbe = probes;
    a.setState({
      clip: 'crouchWalk',
      speed: 8,
      aimWeight: 1,
      suppress: 1,
      aimTarget: new THREE.Vector3(10, 4, -5),
      lookTarget: new THREE.Vector3(-10, 0, -5),
    });
    for (const dt of [0, 1 / 120, 0.1, 2]) {
      a.fire();
      a.reload();
      a.turn(-1);
      a.vault();
      a.hit();
      a.update(dt, 2000 + dt);
      near(pose(a), held);
      assert.equal(a.footfall, false, 'paused/blocked climb never emits steps');
    }
    assert.equal(probes, beforeProbe, 'no ground-foot IK during climb');
    assert.equal(a.phase, gaitPhase);
    assert.equal(a._stepClock, gaitClock);
  }
a.enabled = false;
const culled = pose(a);
a.setClimb(true, 0.42, 'up', 'shaft');
a.update(10, 10000);
near(pose(a), culled);
control.setState(a.state); // match normal state changes retained while climbing
// The control has not evaluated any of the time spent climbing.
a.enabled = true;
a.update(0, 10000);
near(pose(a), at(control, 0.42));
control.setClimb(false, 0, 'up', 'align');
a.setClimb(false, 0, 'up', 'align');
assert.equal(a.climbing, false);
assert.equal(a.climbTravel, 0);
assert.equal(a.climbDirection, 'up');
assert.equal(a.climbPhase, 'align');
// Same retained normal state and clock: exit/reset restores the existing path,
// including aim/look, foot probes, support IK, muzzle outputs and step cadence.
const normal = {
  clip: 'walk',
  speed: 1.42,
  aimTarget: new THREE.Vector3(0, 1.5, 10),
  lookTarget: new THREE.Vector3(1, 2, 10),
  aimWeight: 0.8,
  suppress: 0,
};
a.setState(normal);
control.setState(normal);
for (let i = 0; i < 30; i++) {
  a.update(1 / 60, i);
  control.update(1 / 60, i);
  near(pose(a), pose(control));
  near(a.muzzleWorld.toArray(), control.muzzleWorld.toArray());
  near(a.ejectWorld.toArray(), control.ejectWorld.toArray());
  near(a.muzzleDir.toArray(), control.muzzleDir.toArray());
  assert.equal(a.footfall, control.footfall);
}
a.reload();
assert.equal(a.reloading, true, 'normal triggers work again');
for (const bad of [NaN, Infinity, -1])
  assert.throws(() => a.setClimb(true, bad, 'up', 'shaft'), /climb travel/);
console.log(
  '  ok  travel-driven ladder bones, frozen pause, exclusive climb, reset and normal animation'
);
