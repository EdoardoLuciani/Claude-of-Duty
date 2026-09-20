/**
 * Issue 278: ordinary small-arms fire must not emit tracers.
 *   node tools/smoke-small-arms-tracers.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../src/core/registry.js';
import { Rng } from '../src/core/rng.js';
import { AudioSystem } from '../src/audio/index.js';
import { AiSystem } from '../src/ai/index.js';
import { PhysicsSystem } from '../src/physics/index.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { ProjectileSim } from '../src/weapons/ballistics.js';

for (const id of WEAPON_IDS) {
  assert.equal(WEAPON_DEFS[id].tracerEvery, 0, `${id} must not fire visible tracers`);
}

const vm = {
  clipName: null,
  play(name) { this.clipName = name; },
  stopClip() { this.clipName = null; },
  muzzleWorld() {},
  addRecoil() {},
};

function makeRifle(seed, tracerEvery) {
  const wp = new WeaponSystem();
  wp.ctx = {
    time: { elapsed: 0, scale: 1 },
    camera: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), updateMatrixWorld() {} },
  };
  wp.rng = new Rng(seed);
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  wp.viewmodel = vm;
  const def = { ...WEAPON_DEFS.rifle, tracerEvery };
  wp.states.set('rifle', {
    def,
    pattern: buildRecoilPattern(def, Rng),
    mag: def.magSize,
    chambered: true,
    reserve: def.reserve,
    mode: def.modes[0],
    modeIndex: 0,
  });
  return wp;
}

function fireRifle(wp) {
  const spawned = [];
  wp.sim = { spawn(o) { spawned.push({ tracer: o.tracer, dir: o.dir.clone() }); } };
  wp._spread = 1.2;
  for (let i = 0; i < 9; i++) {
    wp.state.chambered = true;
    wp._fireTimer = 0;
    wp.viewmodel.stopClip();
    assert.equal(wp.tryFire(), true);
  }
  return spawned;
}

{
  const live = makeRifle(0x278b00, 0);
  const old = makeRifle(0x278b00, 3);
  const a = fireRifle(live);
  const b = fireRifle(old);
  assert.equal(a.length, 9);
  for (let i = 0; i < 9; i++) {
    assert.equal(a[i].tracer, false);
    assert.equal(b[i].tracer, i % 3 === 0);
    assert.ok(a[i].dir.equals(b[i].dir));
  }
  assert.deepEqual(
    [live.rng.s0, live.rng.s1, live.rng.s2, live.rng.s3],
    [old.rng.s0, old.rng.s1, old.rng.s2, old.rng.s3],
  );
}

const events = new EventBus();
const rng = new Rng(0x278c00);
const phys = new PhysicsSystem();
phys.ctx = { events, scene: null, camera: null, time: { alpha: 0, elapsed: 0, dt: 1 / 60 }, rng };
phys.rng = rng.fork();
phys.ballistics.rng = phys.rng;
phys.addCollider({
  shape: 'capsule', layer: phys.LAYER.ACTOR, surface: 'flesh',
  owner: { id: 'enemy' }, part: 'torso', radius: 0.185,
}).setSegment(0, 1.18, 0, 0, 1.55, 0);

function take(type) {
  const got = [];
  return { got, off: events.on(type, (e) => got.push(e)) };
}

{
  const tracers = take('bullet:tracer');
  const impacts = take('bullet:impact');
  const damage = take('damage:dealt');
  const sim = new ProjectileSim({
    events,
    peek: (id) => (id === 'physics' ? phys : null),
    has: () => false,
    rng,
  });
  sim.spawn({
    origin: new THREE.Vector3(0, 1.36, 4),
    dir: new THREE.Vector3(0, 0, -1),
    speed: 880, damage: 33, penetration: 1.0, dragK: 0.28,
    dropoff: 0.62, maxRange: 420, weapon: WEAPON_DEFS.rifle, tracer: false,
  });
  for (let i = 0; i < 8; i++) sim.fixedUpdate(1 / 120);
  tracers.off(); impacts.off(); damage.off();
  assert.equal(sim.live.length, 0);
  assert.equal(tracers.got.length, 0);
  assert.ok(impacts.got.length >= 1);
  assert.equal(damage.got.length, 1);
}

const ai = Object.create(AiSystem.prototype);
ai.ctx = {
  peek: (id) => (id === 'physics' ? phys : null),
  events,
  camera: { matrixWorld: new THREE.Matrix4() },
  has: () => false,
  config: { deterministic: false },
  time: { elapsed: 12, frame: 40 },
};
ai._phys = phys;
ai._v = new THREE.Vector3();
ai._v2 = new THREE.Vector3();
ai._fireEvent = {
  actor: null, weapon: 'ai_rifle',
  origin: new THREE.Vector3(), dir: new THREE.Vector3(),
  seed: 0, intensity: 0.12, light: 0.006, flashScale: 0.8,
};
ai._shellEvent = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
const agent = {
  id: 0, ammo: 0, team: 1, weaponDamage: 17,
  position: new THREE.Vector3(0, 0, 8),
  lastFired: -Infinity, fireX: 0, fireZ: 0,
  animator: { ejectWorld: new THREE.Vector3(0.2, 1.2, 8) },
};

{
  const tracers = take('bullet:tracer');
  const fires = take('weapon:fire');
  const shells = take('weapon:shell');
  const damage = take('damage:dealt');
  ai.onAgentFire(agent, new THREE.Vector3(0, 1.36, 8), new THREE.Vector3(0, 0, -1));
  tracers.off(); fires.off(); shells.off(); damage.off();
  assert.equal(tracers.got.length, 0);
  assert.equal(fires.got.length, 1);
  assert.equal(shells.got.length, 1);
  assert.ok(damage.got.length >= 1);
  assert.equal(agent.lastFired, 12);
}

{
  const plays = [];
  const audio = Object.create(AudioSystem.prototype);
  audio.running = true;
  audio.ctx = { peek: () => null };
  audio.rng = { float: () => 0 };
  audio.field = {
    listenerPos: { x: 0, y: 1.36, z: 0 },
    distanceTo(x, y, z) { return Math.hypot(x, y - 1.36, z); },
  };
  audio._budget = { whizz: 0 };
  audio._whizzTo = { x: 0, y: 0, z: 0 };
  audio._whizzEvent = { from: null, to: audio._whizzTo, speed: 800 };
  audio._space = { tight: 0, room: 0, street: 0, tunnel: 0 };
  audio._lastEnemyFire = 0;
  audio.actx = { currentTime: 0 };
  audio.mixer = { duck() {} };
  audio._playAt = (kind) => plays.push(kind);
  audio._playDry = () => {};
  const fire = {
    weapon: 'ai_rifle',
    origin: { x: 1, y: 1.36, z: 20 },
    dir: { x: 0, y: 0, z: -1 },
  };
  for (let i = 0; i < 6; i++) {
    audio._budget.whizz = 0;
    audio._onFire(fire);
  }
  assert.equal(plays.filter((k) => k === 'whizz').length, 6);
  plays.length = 0;
  audio._budget.whizz = 0;
  audio._onFire({ ...fire, origin: { x: 0, y: 1.36, z: 0 } });
  assert.equal(plays.filter((k) => k === 'whizz').length, 0, 'own muzzle does not whizz');
}

console.log('smoke-small-arms-tracers: ok');
