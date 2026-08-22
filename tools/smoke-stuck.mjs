/**
 * Node smoke test for AI stuck recovery — no browser.
 *
 *   node tools/smoke-stuck.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Agent } from '../src/ai/agent.js';

function makeAgent() {
  const position = new THREE.Vector3(-10.4, 0.2, -2.4);
  const dests = [];
  const ctrl = {
    position,
    grounded: true,
    lastMoveBlocked: true,
    setHeight() {},
    move() {},
  };
  const a = Object.assign(Object.create(Agent.prototype), {
    id: 7,
    ai: { agents: [], grid: null },
    phys: { gravity: -20 },
    animator: { turn() {} },
    controller: ctrl,
    position,
    velocity: new THREE.Vector3(),
    yaw: 0,
    targetYaw: 0,
    state: 'alert',
    hasTarget: false,
    lastKnownAge: 10,
    lastKnown: new THREE.Vector3(),
    radius: 0.34,
    height: 1.78,
    scale: 1,
    crouch: false,
    suppression: 0,
    desiredSpeed: 1.5,
    speed: 1.5,
    grounded: true,
    vaultCooldown: 99,
    stuckTimer: 0,
    stuckHits: 0,
    repathTimer: 0,
    hasMoveTarget: true,
    moveTarget: new THREE.Vector3(6.8, 0, 2.9),
    path: [new THREE.Vector3(6.8, 0, 2.9)],
    pathLen: 1,
    pathIndex: 0,
    pathPending: false,
    _steer: new THREE.Vector3(),
    _v: new THREE.Vector3(),
    _v2: new THREE.Vector3(),
    _v3: new THREE.Vector3(),
    _goTo(dest) {
      dests.push(dest.clone());
      this.moveTarget.copy(dest);
      this.hasMoveTarget = true;
      return true;
    },
  });
  a.ai.agents = [a];
  return { a, dests, ctrl };
}

const { a, dests, ctrl } = makeAgent();
const origin = a.moveTarget.clone();

a._move(1.2);
assert.equal(a.stuckHits, 1, 'first trip repaths');
assert.equal(dests.length, 1);
assert.ok(dests[0].distanceTo(origin) < 1e-6, 'first trip keeps the original dest');
assert.ok(a.position.distanceTo(new THREE.Vector3(-10.4, 0.2, -2.4)) < 1e-6);

a._move(1.2);
assert.equal(a.stuckHits, 2, 'second trip sidesteps');
assert.equal(dests.length, 2);
assert.ok(dests[1].distanceTo(origin) > 2, 'sidestep is not the original dest');
assert.ok(
  Math.abs(dests[1].distanceTo(a.position) - 2.5) < 0.05,
  'sidestep is 2.5 m off the blocked heading',
);

const side = dests[1].clone();
a._move(1.2);
assert.equal(a.stuckHits, 0, 'snap clears the trip count');
assert.equal(dests.length, 2, 'snap does not repath');
assert.ok(a.position.distanceTo(side) < 1e-6, 'snap lands on the sidestep cell');
assert.equal(a.hasMoveTarget, false);
assert.equal(a.pathLen, 0);
assert.equal(a.speed, 0);

ctrl.lastMoveBlocked = true;
a.speed = 1.5;
a.hasMoveTarget = true;
a.moveTarget.copy(origin);
a.pathLen = 1;
a.pathIndex = 0;
a._move(1.2);
assert.equal(a.stuckHits, 1);
ctrl.lastMoveBlocked = false;
a._move(0.2);
assert.equal(a.stuckHits, 0, 'free movement resets the trip count');
assert.equal(a.stuckTimer, 0);

console.log('  ok  stuck recovery');
