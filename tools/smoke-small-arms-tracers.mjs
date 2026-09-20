/**
 * Headless regressions for issue 278: ordinary small-arms fire must not emit
 * tracers, while shots, impacts, damage and HUD fire contacts still resolve.
 *
 *   node tools/smoke-small-arms-tracers.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../src/core/registry.js';
import { Rng } from '../src/core/rng.js';
import { AiSystem } from '../src/ai/index.js';
import { hudContact } from '../src/ai/contact.js';
import { PhysicsSystem } from '../src/physics/index.js';
import { LAYER } from '../src/physics/surfaces.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { ProjectileSim } from '../src/weapons/ballistics.js';

for (const id of WEAPON_IDS) {
  assert.equal(WEAPON_DEFS[id].tracerEvery, 0, `${id} must not fire visible tracers`);
}

const vm = {
  anchor: { visible: true },
  clip: null,
  clipName: null,
  clipT: 0,
  boltHold: 0,
  adsT: 0,
  adsTarget: 0,
  active: 'rifle',
  setActive(id) { this.active = id; return id; },
  play(name) { this.clip = { name, duration: 1 }; this.clipName = name; this.clipT = 0; return 1; },
  stopClip() { this.clip = null; this.clipName = null; this.clipT = 0; },
  endGrenade() {},
  endRadio() {},
  muzzleWorld() { return { x: 0, y: 0, z: 0 }; },
  addRecoil() {},
};

function makeWeapons(seed) {
  const wp = new WeaponSystem();
  wp.ctx = {
    time: { elapsed: 0, scale: 1 },
    camera: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), updateMatrixWorld() {} },
  };
  wp.rng = new Rng(seed);
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  wp.viewmodel = vm;
  for (const id of WEAPON_IDS) {
    const def = { ...WEAPON_DEFS[id] };
    def.cycleTime = 60 / def.rpm;
    wp.states.set(id, {
      def,
      pattern: buildRecoilPattern(def, Rng),
      mag: def.magSize,
      chambered: true,
      reserve: def.reserve,
      mode: def.modes[0],
      modeIndex: 0,
    });
  }
  return wp;
}

function fireBurst(wp, id, n) {
  wp.activeId = id;
  wp._fireTimer = 0;
  wp._spread = 1.2;
  wp._shotIndex = 0;
  wp.stats.fired = 0;
  wp.viewmodel.stopClip();
  const spawned = [];
  wp.sim = { spawn(o) { spawned.push({ tracer: o.tracer, dir: o.dir.clone(), pellet: o.pellet }); } };
  for (let i = 0; i < n; i++) {
    wp.state.chambered = true;
    wp.state.mag = Math.max(1, wp.state.mag);
    wp._fireTimer = 0;
    wp.viewmodel.stopClip();
    assert.equal(wp.tryFire(), true, `${id} shot ${i} must leave the barrel`);
  }
  return spawned;
}

for (const id of WEAPON_IDS) {
  const wp = makeWeapons(0x278a0000 + id.length);
  const spawned = fireBurst(wp, id, 9);
  const pellets = Math.max(1, WEAPON_DEFS[id].pellets ?? 1);
  assert.equal(spawned.length, 9 * pellets, `${id} resolves every pellet`);
  assert(spawned.every((p) => p.tracer === false), `${id} must not flag a tracer`);
}

{
  const seed = 0x278b00;
  const live = makeWeapons(seed);
  const old = makeWeapons(seed);
  old.states.get('rifle').def.tracerEvery = 3;
  const a = fireBurst(live, 'rifle', 9);
  const b = fireBurst(old, 'rifle', 9);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].tracer, false);
    assert.equal(b[i].tracer, i % 3 === 0);
    assert.ok(a[i].dir.equals(b[i].dir), `rifle pellet ${i} direction drifted`);
  }
  assert.equal(live.rng.s0, old.rng.s0);
  assert.equal(live.rng.s1, old.rng.s1);
  assert.equal(live.rng.s2, old.rng.s2);
  assert.equal(live.rng.s3, old.rng.s3);
}

const events = new EventBus();
const rng = new Rng(0x278c00);
const phys = new PhysicsSystem();
phys.ctx = { events, scene: null, camera: null, time: { alpha: 0, elapsed: 0, dt: 1 / 60 }, rng };
phys.rng = rng.fork();
phys.ballistics.rng = phys.rng;

const actor = { id: 'enemy' };
phys.addCollider({
  shape: 'capsule', layer: LAYER.ACTOR, surface: 'flesh',
  owner: actor, part: 'torso', radius: 0.185, damageScale: 1,
}).setSegment(0, 1.18, 0, 0, 1.55, 0);

const sim = new ProjectileSim({
  events,
  peek: (id) => (id === 'physics' ? phys : null),
  has: () => false,
  rng,
});

function listen(type) {
  const got = [];
  const off = events.on(type, (e) => got.push(e));
  return { got, off };
}

{
  const tracers = listen('bullet:tracer');
  const impacts = listen('bullet:impact');
  const damage = listen('damage:dealt');
  sim.spawn({
    origin: new THREE.Vector3(0, 1.36, 4),
    dir: new THREE.Vector3(0, 0, -1),
    speed: 880, damage: 33, penetration: 1.0, dragK: 0.28,
    dropoff: 0.62, maxRange: 420, weapon: WEAPON_DEFS.rifle, tracer: false,
  });
  for (let i = 0; i < 8; i++) sim.fixedUpdate(1 / 120);
  tracers.off(); impacts.off(); damage.off();
  assert.equal(sim.live.length, 0, 'round has impacted');
  assert.equal(tracers.got.length, 0, 'ordinary spawn must not emit bullet:tracer');
  assert.ok(impacts.got.length >= 1, 'impact still resolves');
  assert.equal(damage.got.length, 1, 'damage still resolves');
}

{
  const tracers = listen('bullet:tracer');
  sim.spawn({
    origin: new THREE.Vector3(0, 1.36, 8),
    dir: new THREE.Vector3(0, 0, -1),
    speed: 880, damage: 33, penetration: 1.0, dragK: 0.28,
    dropoff: 0.62, maxRange: 420, weapon: WEAPON_DEFS.rifle, tracer: true,
  });
  tracers.off();
  assert.equal(tracers.got.length, 1, 'explicit tracer requests still reach the shared event');
}

const player = {
  isPlayer: true,
  position: new THREE.Vector3(),
  height: 1.78,
  stance: 'stand',
  hitbox: phys.addCollider({
    shape: 'capsule', layer: phys.LAYER.PLAYER, surface: 'flesh',
    owner: null, part: 'torso', radius: 0.3,
  }),
};
player.hitbox.owner = player;
player.hitbox.setSegment(0, 0.3, 0, 0, 1.48, 0, 0.3);

const ai = Object.create(AiSystem.prototype);
ai.ctx = {
  peek: (id) => (id === 'player' ? player : id === 'physics' ? phys : null),
  events,
  camera: { matrixWorld: new THREE.Matrix4() },
  has: () => false,
  config: { deterministic: false },
  time: { elapsed: 12, frame: 40 },
};
ai._phys = phys;
ai._v = new THREE.Vector3();
ai._v2 = new THREE.Vector3();
ai._v3 = new THREE.Vector3();
ai._fireEvent = {
  actor: null, weapon: 'ai_rifle',
  origin: new THREE.Vector3(), dir: new THREE.Vector3(),
  seed: 0, intensity: 0.12, light: 0.006, flashScale: 0.8,
};
ai._shellEvent = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };

const agent = {
  id: 0,
  ammo: 0,
  team: 1,
  staged: null,
  silentDeath: false,
  weaponDamage: 17,
  position: new THREE.Vector3(0, 0, 8),
  lastFired: -Infinity,
  fireX: 0,
  fireZ: 0,
  animator: { ejectWorld: new THREE.Vector3(0.2, 1.2, 8) },
};

{
  const tracers = listen('bullet:tracer');
  const fires = listen('weapon:fire');
  const shells = listen('weapon:shell');
  const damage = listen('damage:dealt');
  const impacts = listen('bullet:impact');
  for (let i = 0; i < 6; i++) {
    agent.ammo = i;
    ai.onAgentFire(agent, new THREE.Vector3(0, 1.36, 8), new THREE.Vector3(0, 0, -1));
  }
  tracers.off(); fires.off(); shells.off(); damage.off(); impacts.off();
  assert.equal(tracers.got.length, 0, 'enemy small-arms must not emit bullet:tracer');
  assert.equal(fires.got.length, 6, 'muzzle flash event still fires');
  assert.equal(shells.got.length, 6, 'shell ejection still fires');
  assert.ok(impacts.got.length >= 1, 'enemy round still impacts');
  assert.ok(damage.got.length >= 1, 'enemy round still damages');
  assert.equal(agent.lastFired, 12, 'shot still writes a HUD fire contact');
  const contact = hudContact(12, {
    lastSeen: -Infinity, lastFired: agent.lastFired,
    lastSeenX: 0, lastSeenZ: 0, fireX: agent.fireX, fireZ: agent.fireZ,
  });
  assert.ok(contact, 'fire contact remains after tracers are removed');
}

console.log('smoke-small-arms-tracers: ok');
