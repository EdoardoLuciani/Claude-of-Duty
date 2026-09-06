/**
 * One round damages an actor once. Capsule hitboxes used to re-enter as 18 mm
 * sheets, so a 33-damage rifle body shot applied ~4× and one-shot 100 HP.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../src/core/registry.js';
import { Rng } from '../src/core/rng.js';
import { PhysicsSystem } from '../src/physics/index.js';
import { LAYER } from '../src/physics/surfaces.js';
import { ProjectileSim } from '../src/weapons/ballistics.js';

const HITBOXES = [
  ['head', 0, 1.62, 0, 0, 1.78, 0, 0.098, 4.0],
  ['torso', 0, 1.18, 0, 0, 1.55, 0, 0.185, 1.0],
  ['torso', 0, 0.92, 0, 0, 1.18, 0, 0.175, 0.9],
  ['arm', 0.22, 1.35, 0.05, 0.45, 1.05, 0.25, 0.072, 0.65],
  ['arm', -0.22, 1.35, 0.05, -0.45, 1.05, 0.25, 0.072, 0.65],
  ['leg', 0.1, 0.92, 0, 0.12, 0.08, 0.04, 0.105, 0.7],
  ['leg', -0.1, 0.92, 0, -0.12, 0.08, 0.04, 0.105, 0.7],
];

const events = new EventBus();
const rng = new Rng(0x5eed1234);
const phys = new PhysicsSystem();
phys.ctx = { events, scene: null, camera: null, time: { alpha: 0, elapsed: 0, dt: 1 / 60 }, rng };
phys.rng = rng.fork();
phys.ballistics.rng = phys.rng;

const actor = { id: 'enemy' };
for (const [part, ax, ay, az, bx, by, bz, r, dmg] of HITBOXES) {
  phys.addCollider({
    shape: 'capsule', layer: LAYER.ACTOR, surface: 'flesh',
    owner: actor, part, radius: r, damageScale: dmg,
  }).setSegment(ax, ay, az, bx, by, bz);
}

function fire(y) {
  const dealt = [];
  const off = events.on('damage:dealt', (e) => dealt.push(e));
  phys.fireBullet({
    origin: { x: 0, y, z: 4 }, dir: { x: 0, y: 0, z: -1 },
    damage: 33, penetration: 1.0, maxDist: 20,
  });
  off();
  return dealt;
}

const chest = fire(1.36);
assert.equal(chest.length, 1, `chest events=${chest.length}`);
assert.equal(chest[0].headshot, false);
assert.ok(chest[0].amount > 28 && chest[0].amount < 36, `chest amount=${chest[0].amount}`);

const head = fire(1.70);
assert.equal(head.length, 1, `head events=${head.length}`);
assert.equal(head[0].headshot, true);
assert.ok(head[0].amount > 110 && head[0].amount < 145, `head amount=${head[0].amount}`);

const sim = new ProjectileSim({
  events,
  peek: (id) => (id === 'physics' ? phys : null),
  has: () => false,
  rng,
});
const proj = [];
events.on('damage:dealt', (e) => proj.push(e.amount));
sim.spawn({
  origin: new THREE.Vector3(0, 1.36, 4),
  dir: new THREE.Vector3(0, 0, -1),
  speed: 880, damage: 33, penetration: 1.0, dragK: 0.28,
  dropoff: 0.62, maxRange: 420, weapon: { id: 'rifle' }, tracer: false,
});
for (let i = 0; i < 8; i++) sim.fixedUpdate(1 / 120);
assert.equal(sim.live.length, 0, 'round has impacted');
assert.equal(proj.length, 1, `projectile events=${proj.length}`);
assert.ok(proj[0] > 28 && proj[0] < 36, `projectile amount=${proj[0]}`);

console.log('smoke-hit-damage: ok');
