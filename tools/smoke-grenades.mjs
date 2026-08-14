/**
 * Node smoke test for the grenade launch flow — no browser.
 *
 * Issue #83: G no longer throws. G equips the grenade (weapon stowed, free to
 * stow back); LMB held + release cooks and LONG-throws; RMB held + release
 * cooks and SHORT-throws; each throw type has its own viewmodel animation and
 * its own launch velocity. Overcooking detonates in the hand.
 *
 *   node tools/smoke-grenades.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WeaponSystem } from '../src/weapons/index.js';
import { WEAPON_IDS, WEAPON_DEFS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';

// ---- fakes ---------------------------------------------------------------

const calls = []; // viewmodel grenade calls, in order
const bodies = []; // physics addRigidBody captures
const events = []; // ctx.events emits

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
  holdGrenade() { calls.push('hold'); },
  throwGrenade(type) { calls.push(`throw:${type}`); },
  endGrenade() { calls.push('end'); },
  grenadeReleaseWorld(out) { out.set(0, 1.6, 0); return out; },
  muzzleWorld() { return { x: 0, y: 0, z: 0 }; },
  addRecoil() {},
};

const input = {
  fire: false,
  firePressed: false,
  wheel: 0,
  frozen: false,
  enabled: true,
  down: new Set(),
  _gPressed: false,
  _rmbPressed: false,
  ads: false,
  actionPressed(name) { return name === 'grenade' && this._gPressed; },
  pressed(code) { return this._rmbPressed && code === 'Mouse2'; },
  held(code) { return this.down.has(code); },
};

const player = {
  dead: false,
  controlEnabled: true,
  sprinting: false,
  stance: 'stand',
  airborne: false,
  state: 'idle',
  horizontalSpeed: 0,
  speed: 0,
  eyePosition: new THREE.Vector3(0, 1.6, 0),
  forward: new THREE.Vector3(0, 0, -1),
  velocity: new THREE.Vector3(),
  addTrauma() {},
  setAdsProgress() {},
};

const physics = {
  addRigidBody(opts) {
    bodies.push({
      velocity: new THREE.Vector3(opts.velocity.x, opts.velocity.y, opts.velocity.z),
      fuse: 0,
    });
    return { position: new THREE.Vector3(0, 1.6, 0) };
  },
  removeRigidBody() {},
};

const wp = new WeaponSystem();
wp.ctx = {
  time: { elapsed: 0, scale: 1 },
  camera: {
    position: new THREE.Vector3(0, 1.6, 0),
    quaternion: new THREE.Quaternion(),
    updateMatrixWorld() {},
  },
  scene: { add() {} },
  events: { emit(type, payload) { events.push({ type, payload }); } },
  peek(id) { return id === 'player' ? player : undefined; },
};
wp.ctx.input = input;
wp.rng = new Rng(0x1234abcd);
wp.sim = { spawn() {}, clear() {}, stats: { live: 0, fired: 0 } };
wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
wp.viewmodel = vm;
wp.physics = physics;
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

const step = (dt = 1 / 60) => wp.update(dt, wp.ctx);
const pressG = () => { input._gPressed = true; step(); input._gPressed = false; };
const resetLive = () => {
  wp._grenades.length = 0;
  bodies.length = 0;
  events.length = 0;
};

// ---- G equips, never throws; stowing is free ------------------------------
pressG();
assert.equal(wp.grenadeEquipped, true, 'G equips the grenade');
assert.equal(wp.grenades, 2, 'equipping spends nothing');
assert(calls.includes('hold'), 'viewmodel holds the grenade');
assert(!calls.includes('throw:'), 'G does not throw');

pressG();
assert.equal(wp.grenadeEquipped, false, 'G again stows the equipped grenade');
assert.equal(wp.grenades, 2, 'stowing spends nothing');
assert(calls.at(-1) === 'end', 'viewmodel stows the grenade');

// ---- switching weapons while equipped stows the grenade --------------------
pressG();
assert.equal(wp.grenadeEquipped, true);
calls.length = 0;
assert.equal(wp.setWeapon('smg'), true, 'weapon switch is allowed while equipped');
assert.equal(wp.grenadeEquipped, false, 'the switch stows the grenade');
assert(calls.includes('end'));
wp._switchTo = null; // the harness has no holster clip to complete

// ---- LMB: cook while held, LONG throw on release ---------------------------
pressG();
assert.equal(wp.grenadeEquipped, true);
assert.equal(wp.canFire(), false, 'firing is blocked while the grenade is equipped');
assert.equal(wp.tryFire(), false, 'tryFire is blocked while the grenade is equipped');
assert.equal(wp.reload(), false, 'reload is blocked while the grenade is equipped');

input.firePressed = true;
step(); // cook starts
assert.equal(wp.cooking, true, 'LMB starts the cook');
assert.equal(wp.grenades, 1, 'the pin is pulled — the grenade is spent');
input.firePressed = false;
input.down.add('Mouse0');
input.fire = true;
for (let i = 0; i < 10; i++) step(); // hold: the fuse burns
assert.equal(wp.cooking, true, 'still cooking while the button is held');
assert(wp._cookTime > 0, 'the fuse burns while held');
assert.equal(wp._throwing, false, 'not thrown while held');
input.down.delete('Mouse0');
input.fire = false;
step(); // release commits the throw
assert.equal(wp.cooking, false, 'release ends the cook');
assert.equal(wp._throwing, true, 'release commits the throw');
assert.equal(calls.at(-1), 'throw:long', 'LMB throws LONG');

// The release beat spawns the live grenade with the long-launch velocity.
wp._onClipEvent('grenade:release', 'grenadeThrow');
assert.equal(wp._grenades.length, 1, 'one live grenade in the world');
assert.equal(bodies.length, 1);
const longVel = bodies[0].velocity;
assert.equal(longVel.y, 2.6, 'long throw has the lofted arc (+2.6 m/s up)');
assert(Math.hypot(longVel.x, longVel.z) > 25, 'long throw leaves much faster than today (30 m/s)');
wp._onClipEvent('grenade:done', 'grenadeThrow');
assert.equal(wp.grenadeEquipped, false, 'the rifle is back after the throw');
assert.equal(wp._throwing, false);
resetLive();

// ---- RMB: cook while held, SHORT throw on release --------------------------
pressG();
assert.equal(wp.grenadeEquipped, true);
input._rmbPressed = true;
step(); // cook starts
assert.equal(wp.cooking, true, 'RMB starts the cook');
assert.equal(wp._throwType, 'short', 'RMB cooks a SHORT throw');
assert.equal(wp.grenades, 0, 'second grenade spent');
input._rmbPressed = false;
input.down.add('Mouse2');
for (let i = 0; i < 5; i++) step();
assert.equal(wp.cooking, true, 'still cooking while RMB is held');
input.down.delete('Mouse2');
step(); // release
assert.equal(calls.at(-1), 'throw:short', 'RMB throws SHORT');

wp._onClipEvent('grenade:release', 'grenadeThrow');
assert.equal(bodies.length, 1);
const shortVel = bodies[0].velocity;
assert.equal(shortVel.y, 1.2, 'short throw has the low arc (+1.2 m/s up)');
const shortSpeed = Math.hypot(shortVel.x, shortVel.z);
assert(shortSpeed > 10 && shortSpeed < 20, `short throw keeps roughly today reach (15 m/s, got ${shortSpeed})`);
wp._onClipEvent('grenade:done', 'grenadeThrow');
assert.equal(wp.grenadeEquipped, false);
resetLive();

// ---- no grenades left: G cannot equip --------------------------------------
pressG();
assert.equal(wp.grenadeEquipped, false, 'with zero grenades G does not equip');

// ---- overcook detonates in the hand ----------------------------------------
wp.grenades = 2; // a market pack — the harness skipped init()
pressG();
input.firePressed = true;
step(); // cook starts
input.firePressed = false;
input.down.add('Mouse0');
input.fire = true;
const fuseFrames = Math.ceil(2.35 / (1 / 60));
for (let i = 0; i < fuseFrames + 5; i++) step();
assert.equal(wp.cooking, false, 'overcook ends the cook');
assert.equal(wp.grenadeEquipped, false, 'overcook drops the grenade in the hand');
const booms = events.filter((e) => e.type === 'explosion');
assert.equal(booms.length, 1, 'overcook emits exactly one explosion');
assert.equal(wp.grenades, 1, 'the overcooked grenade stays spent');
input.down.delete('Mouse0');
input.fire = false;

console.log('Grenade smoke checks passed');
