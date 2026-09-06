/**
 * A round that hits an enemy must damage that actor once. Capsule hitboxes
 * used to be measured as 18 mm sheets, so one body shot applied ~4× and a
 * 33-damage rifle killed 100 HP in a single chest hit.
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

function makePhys() {
  const events = new EventBus();
  const rng = new Rng(0x5eed1234);
  const phys = new PhysicsSystem();
  phys.ctx = { events, scene: null, camera: null, time: { alpha: 0, elapsed: 0, dt: 1 / 60 }, rng };
  phys.rng = rng.fork();
  phys.ballistics.rng = phys.rng;
  return { phys, events, rng };
}

function addSoldier(phys, actor) {
  for (const [part, ax, ay, az, bx, by, bz, r, dmg] of HITBOXES) {
    const c = phys.addCollider({
      shape: 'capsule',
      layer: LAYER.ACTOR,
      surface: 'flesh',
      owner: actor,
      part,
      radius: r,
      damageScale: dmg,
    });
    c.setSegment(ax, ay, az, bx, by, bz);
  }
}

function collectDamage(events, fn) {
  const dealt = [];
  const off = events.on('damage:dealt', (e) => dealt.push({
    target: e.target, amount: e.amount, headshot: e.headshot,
  }));
  fn();
  off();
  return dealt;
}

{
  const { phys, events } = makePhys();
  const actor = { id: 'chest' };
  addSoldier(phys, actor);
  const dealt = collectDamage(events, () => {
    phys.fireBullet({
      origin: { x: 0, y: 1.36, z: 4 }, dir: { x: 0, y: 0, z: -1 },
      damage: 33, penetration: 1.0, maxDist: 20,
    });
  });
  assert.equal(dealt.length, 1, `chest shot events=${dealt.length}`);
  assert.equal(dealt[0].headshot, false);
  assert.ok(dealt[0].amount > 28 && dealt[0].amount < 36, `chest amount=${dealt[0].amount}`);
}

{
  const { phys, events } = makePhys();
  const actor = { id: 'head' };
  addSoldier(phys, actor);
  const dealt = collectDamage(events, () => {
    phys.fireBullet({
      origin: { x: 0, y: 1.70, z: 4 }, dir: { x: 0, y: 0, z: -1 },
      damage: 33, penetration: 1.0, maxDist: 20,
    });
  });
  assert.equal(dealt.length, 1, `head shot events=${dealt.length}`);
  assert.equal(dealt[0].headshot, true);
  assert.ok(dealt[0].amount > 110 && dealt[0].amount < 145, `head amount=${dealt[0].amount}`);
}

{
  const { phys, events, rng } = makePhys();
  const actor = { id: 'proj' };
  addSoldier(phys, actor);
  const ctx = {
    events,
    peek: (id) => (id === 'physics' ? phys : null),
    has: () => false,
    rng,
  };
  const sim = new ProjectileSim(ctx);
  const dealt = [];
  events.on('damage:dealt', (e) => dealt.push(e.amount));
  sim.spawn({
    origin: new THREE.Vector3(0, 1.36, 4),
    dir: new THREE.Vector3(0, 0, -1),
    speed: 880,
    damage: 33,
    penetration: 1.0,
    dragK: 0.28,
    dropoff: 0.62,
    maxRange: 420,
    weapon: { id: 'rifle' },
    tracer: false,
  });
  for (let i = 0; i < 8; i++) sim.fixedUpdate(1 / 120);
  assert.equal(sim.live.length, 0, 'round has impacted');
  assert.equal(dealt.length, 1, `projectile events=${dealt.length}`);
  assert.ok(dealt[0] > 28 && dealt[0] < 36, `projectile amount=${dealt[0]}`);
}

console.log('smoke-hit-damage: ok');
