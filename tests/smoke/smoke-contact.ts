import assert from 'node:assert/strict';

import * as THREE from 'three';

/**
 * Node smoke test for contact-minimap rules — no browser.
 *
 *   node tests/smoke/smoke-contact.ts
 */
import type { Agent } from '../../src/ai/agent.ts';
import { FIRE_JITTER, LOS_RANGE, hudContact, fireJitter } from '../../src/ai/contact.ts';
import { AiSystem } from '../../src/ai/index.ts';
import type { EngineEventMap } from '../../src/core/events.ts';
import { UiSystem } from '../../src/ui/index.ts';
import { makeAgent } from '../lib/agent-fixture.ts';
import { BrainPlayer, brainPhysics } from '../lib/ai-brain-fixture.ts';
import { createTestContext } from '../lib/context.ts';

function agent(partial = {}): {
  lastSeen: number;
  lastFired: number;
  lastSeenX: number;
  lastSeenZ: number;
  fireX: number;
  fireZ: number;
} {
  return {
    lastSeen: -Infinity,
    lastFired: -Infinity,
    lastSeenX: 0,
    lastSeenZ: 10,
    fireX: 1,
    fireZ: 11,
    ...partial,
  };
}

assert.equal(LOS_RANGE, 30);
assert.equal(hudContact(10, agent()), null, 'never seen / never fired stays hidden');
assert.equal(hudContact(10, agent({ lastSeen: 7.9 })), null, 'LOS grace is 2 s');
assert.equal(hudContact(10, agent({ lastFired: 6.9 })), null, 'fire window is 3 s');

const live = hudContact(10, agent({ lastSeen: 10, lastSeenX: 4, lastSeenZ: -2 }));
assert.ok(live);
assert.equal(live.x, 4);
assert.equal(live.z, -2);
assert.ok(Math.abs(live.fade - 1) < 1e-9, 'exact while visible');

const fading = hudContact(11, agent({ lastSeen: 10, lastSeenX: 4, lastSeenZ: -2 }));
assert.ok(fading);
assert.ok(Math.abs(fading.fade - 0.5) < 1e-9, 'LOS fade is linear over 2 s');
assert.equal(hudContact(12, agent({ lastSeen: 10 })), null, 'gone after 2 s');

const shot = hudContact(10, agent({ lastFired: 10, fireX: 8.2, fireZ: 3.1 }));
assert.ok(shot);
assert.equal(shot.x, 8.2);
assert.equal(shot.z, 3.1);
assert.ok(Math.abs(shot.fade - 1) < 1e-9);

const held = hudContact(12.2, agent({ lastFired: 10, fireX: 1, fireZ: 1 }));
assert.ok(held);
assert.ok(Math.abs(held.fade - 1) < 1e-9, 'solid until the last 0.8 s');
const fireFade = hudContact(12.6, agent({ lastFired: 10, fireX: 1, fireZ: 1 }));
assert.ok(fireFade);
assert.ok(Math.abs(fireFade.fade - 0.5) < 1e-9, 'fire fades across the last 0.8 s');
assert.equal(hudContact(13, agent({ lastFired: 10 })), null, 'gone after 3 s');

const newerShot = hudContact(
  10,
  agent({
    lastSeen: 9.5,
    lastSeenX: 2,
    lastSeenZ: 3,
    lastFired: 10,
    fireX: 9,
    fireZ: 9,
  })
);
assert.ok(newerShot);
assert.equal(newerShot.x, 9, 'a newer shot replaces a stale sighting');
assert.equal(newerShot.z, 9);

const newerSight = hudContact(
  10.5,
  agent({
    lastSeen: 10,
    lastSeenX: 2,
    lastSeenZ: 3,
    lastFired: 9,
    fireX: 9,
    fireZ: 9,
  })
);
assert.ok(newerSight);
assert.equal(newerSight.x, 2, 'a newer sighting replaces an older shot');
assert.ok(Math.abs(newerSight.fade - 1) < 1e-9, 'either live signal keeps the contact');

const fireSurvives = hudContact(
  12,
  agent({
    lastSeen: 10,
    lastSeenX: 2,
    lastSeenZ: 3,
    lastFired: 9.9,
    fireX: 9,
    fireZ: 9,
  })
);
assert.ok(fireSurvives);
assert.equal(fireSurvives.x, 9, 'fire remains after the newer sighting expires');

const simultaneous = hudContact(
  10,
  agent({
    lastSeen: 10,
    lastSeenX: 2,
    lastSeenZ: 3,
    lastFired: 10,
    fireX: 9,
    fireZ: 9,
  })
);
assert.ok(simultaneous);
assert.equal(simultaneous.x, 2, 'exact sighting wins when visible while firing');

const j0 = fireJitter(7, { x: 0, z: 0 });
const j1 = fireJitter(7, { x: 0, z: 0 });
assert.equal(j0.x, j1.x);
assert.equal(j0.z, j1.z);
assert.ok(Math.abs(Math.hypot(j0.x, j0.z) - FIRE_JITTER) < 1e-9);
assert.notEqual(j0.x, fireJitter(8, { x: 0, z: 0 }).x);

// Unblocked enemies still need to be inside the player's view frustum.
const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 1200);
camera.position.set(0, 1.7, 0);
camera.updateMatrixWorld();
const frustum = new THREE.Frustum().setFromProjectionMatrix(
  new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
);
const hudAgent = (x: number, z: number, extra: Partial<Agent> = {}): Agent =>
  makeAgent({
    alive: true,
    team: 1,
    crouch: true,
    scale: 1,
    speed: 0,
    state: 'combat',
    position: new THREE.Vector3(x, 0, z),
    lastSeen: -Infinity,
    lastFired: -Infinity,
    lastSeenX: x,
    lastSeenZ: z,
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
const sampleY: number[] = [];
const heard: Array<{ type: 'hud:heard'; payload: EngineEventMap['hud:heard'] }> = [];
const player = new BrainPlayer();
const ctx = createTestContext({ camera, providers: { player } });
ctx.config.deterministic = false;
ctx.time.elapsed = 10;
ctx.events.on('hud:heard', (payload): number => heard.push({ type: 'hud:heard', payload }));
const ai = new AiSystem();
ai.ctx = ctx;
ai.agents = [front, behind, fartherBehind, farFront, idleFront, alertFront];
ai._phys = brainPhysics();
ai._phys.lineOfSight = (_from, to): boolean => {
  sampleY.push(to.y);
  return true;
};
ai._frustum = frustum;
ai._v = new THREE.Vector3();
ai._v2 = new THREE.Vector3();
ai._v3 = new THREE.Vector3();
ai._lastHeardPing = -Infinity;
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

// UI consumes the AI-filtered snapshot, rather than repeating its visibility rules.
ai._hudList = [];
for (const flags of [
  { alive: false },
  { staged: { heading: new THREE.Vector3() } },
  { silentDeath: true },
  { team: 0 },
])
  ai.agents.push(hudAgent(0, -5, { lastSeen: 14, ...flags }));
const ui = new UiSystem();
ui.ctx = createTestContext({ providers: { ai } });
ui._blips = Array.from(
  { length: 48 },
  (): { x: number; z: number; kind: 'enemy'; heading: number } => ({
    x: 0,
    z: 0,
    kind: 'enemy',
    heading: 0,
  })
);
ui._collectBlips();
assert.equal(ui._blipCount, 1, 'only the live, visible enemy reaches the UI');
assert.deepEqual(ui._blips[0], { x: 3, z: -12, kind: 'enemy', heading: 0, fade: 1 });
ctx.time.elapsed = 17;
ui._collectBlips();
assert.equal(ui._blipCount, 0, 'expired contacts clear the UI snapshot');

console.log('  ok  contact minimap rules');
