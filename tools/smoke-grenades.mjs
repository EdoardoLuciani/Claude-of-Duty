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
import { WeaponSystem, GRENADE_RADIUS, GRENADE_DAMAGE } from '../src/weapons/index.js';
import { WEAPON_IDS, WEAPON_DEFS, buildRecoilPattern } from '../src/weapons/defs.js';
import { RadioSystem, CARPET } from '../src/radio/index.js';
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
  holdRadio() { calls.push('holdRadio'); },
  endRadio() { calls.push('endRadio'); },
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
  _hPressed: false,
  _digit: 0,
  ads: false,
  actionPressed(name) {
    if (name === 'grenade') return this._gPressed;
    if (name === 'radio') return this._hPressed;
    return false;
  },
  pressed(code) {
    if (this._rmbPressed && code === 'Mouse2') return true;
    if (code === 'Digit1' && this._digit === 1) return true;
    if (code === 'Digit2' && this._digit === 2) return true;
    if (code === 'Digit3' && this._digit === 3) return true;
    return false;
  },
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
assert.equal(booms[0].payload.damage, GRENADE_DAMAGE, 'blast carries the tuned damage');
assert.equal(booms[0].payload.radius, GRENADE_RADIUS, 'blast carries the tuned radius');
assert.equal(wp.grenades, 1, 'the overcooked grenade stays spent');
input.down.delete('Mouse0');
input.fire = false;

// ---- a live grenade detonates on fuse expiry with the same blast ----------
resetLive();
wp._spawnGrenade(new THREE.Vector3(0, 1.6, 0), { x: 0, y: 0, z: 0 }, 0.001);
step(); // fuse expires: the blast fires
const dets = events.filter((e) => e.type === 'explosion');
assert.equal(dets.length, 1, 'fuse expiry emits exactly one explosion');
assert.equal(dets[0].payload.damage, GRENADE_DAMAGE, 'detonation carries the tuned damage');
assert.equal(dets[0].payload.radius, GRENADE_RADIUS, 'detonation carries the tuned radius');
assert.equal(wp._grenades.length, 0, 'the spent grenade is cleared');
resetLive();

// ---- a follow-through click cannot recook a committed throw ----------------
wp.grenades = 2; // market pack — the harness skipped init()
pressG();
assert.equal(wp.grenadeEquipped, true);
input.firePressed = true;
step(); // cook starts
assert.equal(wp.cooking, true);
input.firePressed = false;
input.down.add('Mouse0');
input.fire = true;
for (let i = 0; i < 3; i++) step();
input.down.delete('Mouse0');
input.fire = false;
step(); // release commits the throw
assert.equal(wp._throwing, true, 'release commits the throw');
assert.equal(wp.grenades, 1, 'one grenade spent');
const spent = wp.grenades;
// The throw is in flight (release beat not reached yet): a follow-through
// click must not start a second cook — no softlock, no extra grenade spent.
input.firePressed = true;
step();
assert.equal(wp.cooking, false, 'follow-through click does not recook before the release beat');
assert.equal(wp.grenades, spent, 'follow-through spends nothing');
assert.equal(wp._throwing, true, 'the throw stays committed');
input.firePressed = false;
wp._onClipEvent('grenade:release', 'grenadeThrow');
input.firePressed = true;
step(); // same check after the release beat, before grenade:done
assert.equal(wp.cooking, false, 'follow-through click does not recook after the release beat');
assert.equal(wp.grenades, spent, 'still no second grenade spent');
assert.equal(wp._throwing, true, 'still committed until grenade:done');
input.firePressed = false;
wp._onClipEvent('grenade:done', 'grenadeThrow');
assert.equal(wp.cooking, false, 'grenade:done leaves cooking unset');
assert.equal(wp.grenadeEquipped, false, 'grenade:done stows the hand');
assert.equal(wp._throwing, false);
assert.equal(wp.canFire(), true, 'the rifle fires again after the throw');
resetLive();

// ---- a weapon switch cannot cancel a committed throw -----------------------
wp.grenades = 2; // market pack — the harness skipped init()
pressG();
input.firePressed = true;
step(); // cook starts
input.firePressed = false;
input.down.add('Mouse0');
input.fire = true;
for (let i = 0; i < 3; i++) step();
input.down.delete('Mouse0');
input.fire = false;
step(); // release commits
assert.equal(wp._throwing, true);
assert.equal(wp.setWeapon('smg'), false, 'weapon switch is refused while the throw is committed');
assert.equal(wp.grenadeEquipped, true, 'the committed grenade stays in hand');
assert.equal(wp.grenades, 1, 'the spent grenade is not restored');
wp._onClipEvent('grenade:release', 'grenadeThrow');
assert.equal(wp.setWeapon('smg'), false, 'still refused after the release beat, before done');
wp._onClipEvent('grenade:done', 'grenadeThrow');
assert.equal(wp.setWeapon('smg'), true, 'the switch works once the throw finished');
wp._switchTo = null; // the harness has no holster clip to complete
resetLive();

// ---- a market primary swap stows an equipped grenade ------------------------
pressG();
assert.equal(wp.grenadeEquipped, true);
calls.length = 0;
assert.equal(wp.setWeaponImmediate('smg'), true, 'market swap applies');
assert.equal(wp.grenadeEquipped, false, 'the swap stows the equipped grenade');
assert(calls.includes('end'), 'the stow calls endGrenade');
assert.equal(wp.canFire(), true, 'the bought gun fires right away');
resetLive();

// ---- a market primary swap mid-throw force-releases exactly one grenade -----
wp.grenades = 2; // market pack — the harness skipped init()
pressG();
assert.equal(wp.grenadeEquipped, true);
input.firePressed = true;
step(); // cook starts
input.firePressed = false;
input.down.add('Mouse0');
input.fire = true;
for (let i = 0; i < 3; i++) step();
input.down.delete('Mouse0');
input.fire = false;
step(); // release commits the throw; the release beat has not fired yet
assert.equal(wp._throwing, true, 'throw committed (windup)');
assert.equal(wp._throwReleased, false, 'release beat not reached yet');
calls.length = 0;
assert.equal(wp.setWeaponImmediate('smg'), true, 'market swap applies mid-throw');
assert.equal(wp._grenades.length, 1, 'exactly one grenade in the world');
assert.equal(bodies.length, 1, 'one rigid body — no double spawn');
assert.equal(wp._throwing, false, 'throw state unwound');
assert.equal(wp.grenadeEquipped, false, 'the grenade hand is cleared');
assert(calls.includes('end'), 'the viewmodel throw timeline is stopped');
assert.equal(wp.canFire(), true, 'the bought gun fires right away');
// The pre-fix bug: the viewmodel throw timeline kept running after the swap,
// so grenade:release fired again when time resumed — a second live grenade
// from the same spent throw. The release beat must be a no-op now.
wp._onClipEvent('grenade:release', 'grenadeThrow');
assert.equal(wp._grenades.length, 1, 'a late grenade:release does not respawn');
assert.equal(bodies.length, 1, 'still one rigid body');
wp._onClipEvent('grenade:done', 'grenadeThrow');
assert.equal(wp.canFire(), true, 'still firing after a late grenade:done');
assert.equal(wp.grenadeEquipped, false, 'no phantom grenade left behind');
resetLive();

// ---- death mid-throw releases the spent grenade instead of vanishing it -----
wp.grenades = 2; // market pack — the harness skipped init()
pressG();
input.firePressed = true;
step(); // cook starts
input.firePressed = false;
input.down.add('Mouse0');
input.fire = true;
for (let i = 0; i < 3; i++) step();
input.down.delete('Mouse0');
input.fire = false;
step(); // release commits the throw; windup, release beat not reached
assert.equal(wp._throwing, true, 'throw committed before death');
assert.equal(wp._throwReleased, false, 'release beat not reached before death');
wp._onPlayerDeath();
assert.equal(wp._grenades.length, 1, 'the spent grenade releases on death');
assert.equal(bodies.length, 1, 'one rigid body');
assert.equal(wp._throwing, false, 'throw state unwound on death');
assert.equal(wp.grenadeEquipped, false, 'the grenade hand is cleared on death');
assert.equal(wp.disabled, true, 'death disables the weapon system');
// The viewmodel timeline is stopped too: a late release beat must not respawn.
wp._onClipEvent('grenade:release', 'grenadeThrow');
assert.equal(wp._grenades.length, 1, 'a late grenade:release after death does not respawn');
assert.equal(bodies.length, 1);
// Bring the harness back to life for any remaining checks.
wp._setDeathDisabled(false);
resetLive();

// ==========================================================================
//  FIELD RADIO (accessory) — issue #99
// ==========================================================================
const pressH = () => { input._hPressed = true; step(); input._hPressed = false; };
const pressDigit = (n) => { input._digit = n; step(); input._digit = 0; };
let strikeCalls = 0;
wp.radioSys = { callStrike() { strikeCalls++; return true; } };

// ---- H equips the radio; stowing is free ----------------------------------
pressH();
assert.equal(wp.radioEquipped, true, 'H equips the radio');
assert.equal(wp.carpetBombs, 1, 'player spawns with 1 carpet-bomb charge');
assert(calls.includes('holdRadio'), 'viewmodel holds the radio');
assert.equal(wp.canFire(), false, 'firing is blocked while the radio is out');
assert.equal(wp.tryFire(), false, 'tryFire is blocked while the radio is out');
assert.equal(wp.reload(), false, 'reload is blocked while the radio is out');
assert.equal(wp.inspect(), false, 'inspect is blocked while the radio is out');

pressH();
assert.equal(wp.radioEquipped, false, 'H again stows the radio');
assert(calls.at(-1) === 'endRadio', 'viewmodel stows the radio');
assert.equal(wp.canFire(), true, 'the rifle fires again after stowing');

// ---- the two accessory holds are exclusive: H then G ---------------------
pressH();
assert.equal(wp.radioEquipped, true, 'radio is out');
assert.equal(wp.grenadeEquipped, false, 'grenade is not out');
pressG();
assert.equal(wp.grenadeEquipped, true, 'G equips the grenade while the radio is out');
assert.equal(wp.radioEquipped, false, 'equipping the grenade stows the radio');
pressG(); // stow again for the next case
assert.equal(wp.grenadeEquipped, false, 'G stows the grenade');

// ---- ...and G then H: H is refused while the grenade holds the hand -----
pressG();
assert.equal(wp.grenadeEquipped, true, 'grenade is out');
pressH();
assert.equal(wp.radioEquipped, false, 'H is refused while the grenade is out');
assert.equal(wp.grenadeEquipped, true, 'the grenade stays equipped');
pressG(); // stow
assert.equal(wp.grenadeEquipped, false, 'G stows the grenade');

// ---- switching weapons while the radio is out stows it --------------------
pressH();
assert.equal(wp.radioEquipped, true);
calls.length = 0;
assert.equal(wp.setWeapon('pistol'), true, 'weapon switch is allowed while the radio is out');
assert.equal(wp.radioEquipped, false, 'the switch stows the radio');
assert(calls.includes('endRadio'));
wp._switchTo = null; // the harness has no holster clip to complete

// ---- request 1: carpet bomb spends a charge and calls the strike -----------
pressH();
pressDigit(1);
assert.equal(wp.radioEquipped, false, 'calling a strike stows the radio');
assert.equal(wp.carpetBombs, 0, 'the charge is spent');
assert.equal(strikeCalls, 1, 'the strike system was invoked exactly once');

// ---- out of charges: request 1 is denied and spends nothing ---------------
pressH();
pressDigit(1);
assert.equal(wp.radioEquipped, true, 'a denied request keeps the radio out');
assert.equal(wp.carpetBombs, 0, 'a denied request spends nothing');
assert.equal(strikeCalls, 1, 'no strike without a charge');

// ---- requests 2/3 are top-secret: denied, never a strike -------------------
pressDigit(2);
assert.equal(wp.radioEquipped, true, 'request 2 keeps the radio out');
pressDigit(3);
assert.equal(wp.radioEquipped, true, 'request 3 keeps the radio out');
assert.equal(strikeCalls, 1, 'top-secret requests never call a strike');
assert.equal(wp.carpetBombs, 0, 'top-secret requests spend nothing');

// ---- market purchases cap at 3 --------------------------------------------
wp.addCarpetBombs(5);
assert.equal(wp.carpetBombs, 3, 'market purchases cap at 3 charges');
pressDigit(1);
assert.equal(wp.carpetBombs, 2, 'a strike spends a purchased charge');
assert.equal(strikeCalls, 2);
// The strike stowed the radio; it is not out right now.
assert.equal(wp.radioEquipped, false, 'the strike stowed the radio');

// ---- a refused strike (one already airborne) keeps the charge ---------------
wp.radioSys = { callStrike() { return false; } };
pressH();
assert.equal(wp.radioEquipped, true, 'radio is out again');
pressDigit(1);
assert.equal(wp.carpetBombs, 2, 'a refused strike keeps the charge');
assert.equal(wp.radioEquipped, true, 'the radio stays out for a retry');
assert.equal(strikeCalls, 2, 'no strike was attempted twice');
pressH(); // stow

// ---- the radio never leaves the weapon slot on a reset ---------------------
wp.radioEquipped = true;
wp.viewmodel = { ...wp.viewmodel, endRadio() { calls.push('endRadio'); } };
wp.resetForNewGame();
assert.equal(wp.radioEquipped, false, 'reset stows the radio');
assert.equal(wp.carpetBombs, 1, 'reset restores the spawn charge');

// ==========================================================================
//  THE STRIKE (RadioSystem) — the bomber carpets the whole map
// ==========================================================================
const strikeEvents = [];
const added = [];
const radioCtx = {
  scene: { add(o) { added.push(o); } },
  events: { emit(type, payload) { strikeEvents.push({ type, payload }); } },
  peek(id) {
    if (id === 'world') {
      return {
        bounds: new THREE.Box3(new THREE.Vector3(-85, -2, -85), new THREE.Vector3(87, 26, 87)),
        // The real spawn shape: { position, yaw, tag }. The north-street
        // forward (0.554, 0, 0.832) encodes to this yaw, and the strike must
        // derive its flight axis from it (never a synthetic `forward`).
        spawn: () => ({
          position: new THREE.Vector3(0, 0, 0),
          yaw: Math.atan2(-0.554, -0.832),
          tag: 'street',
        }),
      };
    }
    if (id === 'physics') return { groundHeight: () => 0 };
    if (id === 'player') return { isPlayer: true };
    return undefined;
  },
};
const radio = new RadioSystem();
radio.ctx = radioCtx;
radio._world = radioCtx.peek('world');
radio.active = [];
radio._off = [];

assert.equal(radio.callStrike(), true, 'a strike starts');
assert.equal(radio.active.length, 1, 'one bomber in the air');
assert.equal(radio.callStrike(), false, 'no second bomber while one is airborne');
assert.equal(added.length, 1, 'the bomber mesh entered the scene');
assert(strikeEvents.some((e) => e.type === 'radio:strike'), 'a radio:strike event announces the strike');
// The bomber flies the street axis derived from the spawn yaw — the map's
// north street (0.554, 0, 0.832), not the diagonal fallback.
const flightDir = radio.active[0].dir;
assert(
  Math.abs(flightDir.x - 0.554) < 1e-3 && Math.abs(flightDir.z - 0.832) < 1e-3,
  `the bomber flies the street axis from spawn yaw (got ${flightDir.x.toFixed(3)}, ${flightDir.z.toFixed(3)})`
);

// Fly the whole run at 60 Hz until the strike clears.
let guard = 0;
while (radio.active.length && guard++ < 60 * 60) radio.update(1 / 60);
assert(guard < 60 * 60, 'strike clears within 60 s of sim time');
const strikeBooms = strikeEvents.filter((e) => e.type === 'explosion');
assert(strikeBooms.length >= 40, `a carpet bomb drops a lot of bombs (got ${strikeBooms.length})`);
assert(strikeBooms.every((e) => e.payload.radius === CARPET.radius), 'bombs carry the tuned radius');
assert(strikeBooms.every((e) => e.payload.damage === CARPET.damage), 'bombs carry the tuned damage');
assert(strikeBooms.every((e) => e.payload.position.y === CARPET.blastHeight),
  'bomb blast origins sit above the ground collision surface');
// The blast line spans the whole town along the street axis (the map is a
// rotated square; the town sits in a band along the street).
const xs = strikeBooms.map((e) => e.payload.position.x);
const zs = strikeBooms.map((e) => e.payload.position.z);
assert(Math.min(...xs) < -55 && Math.max(...xs) > 50,
  `blasts cover the street extent in x (${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)})`);
assert(Math.min(...zs) < -85 && Math.max(...zs) > 75,
  `blasts cover the street extent in z (${Math.min(...zs).toFixed(0)}..${Math.max(...zs).toFixed(0)})`);
assert.equal(radio.active.length, 0, 'the strike clears when the run is over');

console.log('Grenade + radio smoke checks passed');
