/**
 * Node smoke test for contact-minimap rules — no browser.
 *
 *   npx vitest run tools/smoke-contact.test.mjs
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AiSystem } from '../src/ai/index.js';
import {
  FIRE_JITTER, LOS_RANGE, hudContact, fireJitter,
} from '../src/ai/contact.js';

function agent(partial = {}) {
  return {
    lastSeen: -Infinity, lastFired: -Infinity,
    lastSeenX: 0, lastSeenZ: 10, fireX: 1, fireZ: 11,
    ...partial,
  };
}

describe('contact minimap', () => {
it('enforces range, snapshot, and fire-contact rules', () => {

assert.equal(LOS_RANGE, 30);
assert.equal(hudContact(10, agent()), null, 'never seen / never fired stays hidden');
assert.equal(hudContact(10, agent({ lastSeen: 7.9 })), null, 'LOS grace is 2 s');
assert.equal(hudContact(10, agent({ lastFired: 6.9 })), null, 'fire window is 3 s');

const live = hudContact(10, agent({ lastSeen: 10, lastSeenX: 4, lastSeenZ: -2 }));
assert.equal(live.x, 4);
assert.equal(live.z, -2);
assert.ok(Math.abs(live.fade - 1) < 1e-9, 'exact while visible');

const fading = hudContact(11, agent({ lastSeen: 10, lastSeenX: 4, lastSeenZ: -2 }));
assert.ok(Math.abs(fading.fade - 0.5) < 1e-9, 'LOS fade is linear over 2 s');
assert.equal(hudContact(12, agent({ lastSeen: 10 })), null, 'gone after 2 s');

const shot = hudContact(10, agent({ lastFired: 10, fireX: 8.2, fireZ: 3.1 }));
assert.equal(shot.x, 8.2);
assert.equal(shot.z, 3.1);
assert.ok(Math.abs(shot.fade - 1) < 1e-9);

const held = hudContact(12.2, agent({ lastFired: 10, fireX: 1, fireZ: 1 }));
assert.ok(Math.abs(held.fade - 1) < 1e-9, 'solid until the last 0.8 s');
const fireFade = hudContact(12.6, agent({ lastFired: 10, fireX: 1, fireZ: 1 }));
assert.ok(Math.abs(fireFade.fade - 0.5) < 1e-9, 'fire fades across the last 0.8 s');
assert.equal(hudContact(13, agent({ lastFired: 10 })), null, 'gone after 3 s');

const newerShot = hudContact(10, agent({
  lastSeen: 9.5, lastSeenX: 2, lastSeenZ: 3,
  lastFired: 10, fireX: 9, fireZ: 9,
}));
assert.equal(newerShot.x, 9, 'a newer shot replaces a stale sighting');
assert.equal(newerShot.z, 9);

const newerSight = hudContact(10.5, agent({
  lastSeen: 10, lastSeenX: 2, lastSeenZ: 3,
  lastFired: 9, fireX: 9, fireZ: 9,
}));
assert.equal(newerSight.x, 2, 'a newer sighting replaces an older shot');
assert.ok(Math.abs(newerSight.fade - 1) < 1e-9, 'either live signal keeps the contact');

const fireSurvives = hudContact(12, agent({
  lastSeen: 10, lastSeenX: 2, lastSeenZ: 3,
  lastFired: 9.9, fireX: 9, fireZ: 9,
}));
assert.equal(fireSurvives.x, 9, 'fire remains after the newer sighting expires');

const simultaneous = hudContact(10, agent({
  lastSeen: 10, lastSeenX: 2, lastSeenZ: 3,
  lastFired: 10, fireX: 9, fireZ: 9,
}));
assert.equal(simultaneous.x, 2, 'exact sighting wins when visible while firing');

const j0 = fireJitter(7, {});
const j1 = fireJitter(7, {});
assert.equal(j0.x, j1.x);
assert.equal(j0.z, j1.z);
assert.ok(Math.abs(Math.hypot(j0.x, j0.z) - FIRE_JITTER) < 1e-9);
assert.notEqual(j0.x, fireJitter(8, {}).x);

// Unblocked enemies still need to be inside the player's view frustum.
const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 1200);
camera.position.set(0, 1.7, 0);
camera.updateMatrixWorld();
const frustum = new THREE.Frustum().setFromProjectionMatrix(
  new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
);
const hudAgent = (x, z, extra = {}) => ({
  alive: true, team: 1, crouch: true, scale: 1, speed: 0, state: 'combat',
  position: new THREE.Vector3(x, 0, z),
  lastSeen: -Infinity, lastFired: -Infinity,
  lastSeenX: x, lastSeenZ: z,
  ...extra,
});
const front = hudAgent(0, -10);
const behind = hudAgent(0, 10);
const fartherBehind = hudAgent(5, 15);
const farFront = hudAgent(0, -80);
const idleFront = hudAgent(4, -8, { state: 'idle' });
const alertFront = hudAgent(-4, -8, { state: 'alert' });
behind.speed = 5;
fartherBehind.speed = 5;
const sampleY = [];
const heard = [];
const ctx = {
  camera,
  config: { deterministic: false },
  time: { elapsed: 10 },
  peek: (id) => id === 'player' ? { position: new THREE.Vector3() } : null,
  events: { emit: (type, payload) => heard.push({ type, payload }) },
};
const ai = Object.assign(Object.create(AiSystem.prototype), {
  ctx,
  agents: [front, behind, fartherBehind, farFront, idleFront, alertFront],
  _phys: { lineOfSight: (_from, to) => { sampleY.push(to.y); return true; } },
  _frustum: frustum,
  _v: new THREE.Vector3(),
  _v2: new THREE.Vector3(),
  _v3: new THREE.Vector3(),
  _lastHeardPing: -Infinity,
});
ai._updateContacts(ctx);
assert.equal(front.lastSeen, 10, 'unblocked enemy in front is visible');
assert.equal(front.lastSeenX, 0);
assert.equal(front.lastSeenZ, -10);
assert.equal(behind.lastSeen, -Infinity, 'unblocked enemy behind the camera stays hidden');
assert.equal(farFront.lastSeen, -Infinity, 'combat LOS past 30 m stays hidden');
assert.equal(idleFront.lastSeen, -Infinity, 'idle in front stays hidden');
assert.equal(alertFront.lastSeen, -Infinity, 'alert in front stays hidden');
assert.ok(Math.abs(sampleY[0] - 0.94) < 1e-9, 'crouch lowers the visibility sample');
assert.equal(heard.length, 1, 'nearby sprinters produce one compass ping');
assert.equal(heard[0].type, 'hud:heard');
assert.ok(Math.abs(heard[0].payload.bearing - 180) < 1e-9, 'nearest sprinter owns the ping');
ctx.time.elapsed = 10.2;
ai._updateContacts(ctx);
assert.equal(heard.length, 1, 'global cadence suppresses squad ping spam');

front.position.set(3, 0, -12);
ctx.time.elapsed = 11;
ai._updateContacts(ctx);
assert.equal(front.lastSeen, 11, 'still visible keeps the contact');
assert.equal(front.lastSeenX, 0, 'pose is snapshotted on acquire');
assert.equal(front.lastSeenZ, -10);

ctx.time.elapsed = 14;
ai._updateContacts(ctx);
assert.equal(front.lastSeen, 14, 're-acquire after grace');
assert.equal(front.lastSeenX, 3, 'new snapshot after the previous contact dies');
assert.equal(front.lastSeenZ, -12);

});
});
