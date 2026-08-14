import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ACTIONS } from '../src/core/input.js';
import { setCaseScale } from '../src/fx/shells.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';
import { WeaponSystem } from '../src/weapons/index.js';

assert.deepEqual(WEAPON_IDS, ['rifle', 'smg', 'pistol', 'lmg']);
assert(WEAPON_IDS.every((id) => WEAPON_DEFS[id]));
// The LMG is a market purchase that replaces the rifle — there is no 4th slot.
assert(ACTIONS.swapWeapon.includes('Digit3') && !ACTIONS.swapWeapon.includes('Digit4'));
// The LMG stays in the def table so the market can sell it against the M4.
assert.equal(WEAPON_DEFS.lmg.label, 'EVOLYS-7.62');
assert.equal(WEAPON_DEFS.rifle.label, 'M4A1');

const lmg = WEAPON_DEFS.lmg;
assert.equal(lmg.magSize, 100);
assert.equal(lmg.reserve, 150);
const recoil = buildRecoilPattern(lmg, Rng);
assert.equal(recoil.length, lmg.recoil.patternLength * 2);
assert(recoil.every(Number.isFinite));
assert(recoil.every((n, i) => i % 2 || n > 0));

const scale = setCaseScale({}, 0.051, 0.01195 / 2);
assert(Math.abs(scale.lengthScale - 0.051 / 0.045) < 1e-9);
assert(Math.abs(scale.radiusScale - (0.01195 / 2) / 0.00495) < 1e-9);
assert.notEqual(scale.lengthScale, scale.radiusScale);

// ---- WeaponSystem loadout swap (the real API, not the market fake) -------
// The market smoke (tools/smoke-market.mjs) stubs `weapons`, so these checks
// drive the real WeaponSystem.equipPrimary / owns / weaponIds / refillAmmo /
// resetForNewGame path: regressions in the loadout swap (clip leftover, fresh
// ammo, ownership reset, refill scoped to owned guns) must fail CI. The rig
// itself needs a browser, so only the clip/active-mesh surface WeaponSystem
// talks to is stubbed.
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
  muzzleWorld() { return { x: 0, y: 0, z: 0 }; },
  addRecoil() {},
};

const wp = new WeaponSystem();
wp.ctx = {
  time: { elapsed: 0, scale: 1 },
  camera: { quaternion: new THREE.Quaternion(), updateMatrixWorld() {} },
};
wp.rng = new Rng(0x1234abcd);
wp.sim = { spawn() {}, clear() {} };
wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
wp.viewmodel = vm;
// Same state construction as WeaponSystem.init(), minus the GLB load.
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

// Spawn loadout: rifle/smg/pistol owned, no 4th slot, rifle active.
assert.deepEqual(wp.weaponIds, ['rifle', 'smg', 'pistol']);
assert(wp.owns('rifle') && wp.owns('smg') && wp.owns('pistol') && !wp.owns('lmg'));
assert.equal(wp.activeId, 'rifle');

// Buying the LMG replaces the rifle, equips it immediately, fresh ammo.
assert.equal(wp.equipPrimary('lmg'), true);
assert(wp.owns('lmg') && !wp.owns('rifle'));
assert.deepEqual(wp.weaponIds, ['smg', 'pistol', 'lmg']);
assert.equal(wp.activeId, 'lmg');
assert.equal(wp.state.mag, WEAPON_DEFS.lmg.magSize);
assert.equal(wp.state.reserve, WEAPON_DEFS.lmg.reserve);
assert.equal(wp.state.chambered, true);
assert.equal(wp.equipPrimary('lmg'), false, 'cannot buy a weapon already equipped');

// Mid-reload purchase: the leftover reload clip must not keep the gun blocked.
wp.state.mag = 10; // below magSize so reload() starts a clip
assert.equal(wp.reload(), true);
assert.equal(wp.reloading, true);
assert.equal(wp.equipPrimary('rifle'), true, 'swap back to the M4');
assert.equal(wp.reloading, false, 'equipPrimary stops the in-flight reload clip');
assert.equal(wp.tryFire(), true, 'bought gun fires immediately — not clip-blocked');
assert.equal(wp.state.mag, WEAPON_DEFS.rifle.magSize - 1);

// Ammo refill and the aggregate fraction only count owned weapons.
wp.state.reserve = 10;
assert(wp.ammoFraction() < 1);
wp.refillAmmo();
assert.equal(wp.state.reserve, WEAPON_DEFS.rifle.reserve);
assert.equal(wp.ammoFraction(), 1);

// game:restart resets ownership, the active weapon and every state.
wp.equipPrimary('lmg');
wp.state.mag = 5;
wp.state.reserve = 0;
wp.resetForNewGame();
assert.deepEqual(wp.weaponIds, ['rifle', 'smg', 'pistol']);
assert.equal(wp.activeId, 'rifle');
assert.equal(wp.state.mag, WEAPON_DEFS.rifle.magSize);
assert.equal(wp.state.reserve, WEAPON_DEFS.rifle.reserve);
assert.equal(wp.reloading, false);

console.log('LMG smoke checks passed');
