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
  endRadio() {},
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

// Hand-pose regression (issue #62).
import { Viewmodel } from '../src/weapons/viewmodel.js';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { buildLmg } from '../src/weapons/models/lmg.js';

const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.004, 60);
const vm2 = new Viewmodel({
  viewScene: new THREE.Scene(),
  camera: cam,
  viewCamera: cam,
  rng: new Rng(0xbeef1234),
}, {
  get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(),
  reticleOutline: () => new THREE.MeshBasicMaterial(),
});
for (const id of ['rifle', 'lmg']) {
  const def = { ...WEAPON_DEFS[id], cycleTime: 60 / WEAPON_DEFS[id].rpm };
  vm2.addWeapon(id === 'rifle' ? buildRifle() : buildLmg(), def);
}

const _inv = new THREE.Matrix4();
const _p = new THREE.Vector3();
const IDLE = { ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false };
const GRIP = { x0: -0.03, x1: 0.03, y0: -0.09, y1: 0.08, z0: -0.04, z1: 0.09 };

function localOf(obj, lx, ly, lz) {
  obj.updateMatrixWorld(true);
  return _p.set(lx, ly, lz).applyMatrix4(obj.matrixWorld).applyMatrix4(_inv).clone();
}
function tipOf(arm, i) {
  return localOf(arm.fingers[i].joints[2], 0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * 0.5);
}
function thumbOf(arm) {
  return localOf(arm.thumb.joints[1], 0, -0.0078 * arm.scale * 1.05, -0.032 * arm.scale * 0.55);
}
function measureHands(id) {
  vm2.setActive(id);
  vm2.update(1 / 60, IDLE);
  vm2.rig.updateMatrixWorld(true);
  _inv.copy(vm2.rig.matrixWorld).invert();
  return {
    w: vm2.active,
    rtips: [0, 1, 2, 3].map((i) => tipOf(vm2.armR, i)),
    ltips: [0, 1, 2, 3].map((i) => tipOf(vm2.armL, i)),
    rthumb: thumbOf(vm2.armR),
    lthumb: thumbOf(vm2.armL),
    pivot: vm2.active.model.nodes.triggerPivot.pos,
    hg: vm2.active.model.nodes.handguard,
  };
}
function inBox(p, b) {
  return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && p.z >= b.z0 && p.z <= b.z1;
}
function checkHold(id, opts) {
  const m = measureHands(id);
  const t = m.rtips[0];
  assert(Math.abs(t.x) < 0.014, `${id} index x=${t.x.toFixed(3)}`);
  assert(Math.abs(t.y - (m.pivot[1] - 0.016)) < 0.014, `${id} index y=${t.y.toFixed(3)}`);
  assert(Math.abs(t.z - m.pivot[2]) < 0.014, `${id} index z=${t.z.toFixed(3)}`);
  const z0 = Math.max(m.hg.z0, m.hg.z1);
  const z1 = Math.min(m.hg.z0, m.hg.z1);
  for (const tip of m.ltips) {
    if (opts.cylPad != null) {
      const d = Math.hypot(tip.x - m.hg.axis[0], tip.y - m.hg.axis[1]);
      assert(d < m.hg.r + opts.cylPad, `${id} support tip ${d.toFixed(3)} vs r ${m.hg.r}`);
    }
    assert(tip.z <= z0 + 0.012 && tip.z >= z1 - 0.012, `${id} support z=${tip.z.toFixed(3)}`);
    if (opts.aheadOf != null) assert(tip.z < opts.aheadOf, `${id} support ahead of box, z=${tip.z.toFixed(3)}`);
  }
  const td = Math.hypot(m.lthumb.x - m.hg.axis[0], m.lthumb.y - m.hg.axis[1]);
  assert(td < m.hg.r + opts.thumbPad, `${id} support thumb ${td.toFixed(3)} vs r ${m.hg.r}`);
  assert(m.rthumb.x < -0.012, `${id} thumb x=${m.rthumb.x.toFixed(3)}`);
  for (let i = 1; i < 4; i++) {
    assert(inBox(m.rtips[i], GRIP), `${id} firing finger ${i} off the grip ${m.rtips[i].toArray().map((n) => n.toFixed(3))}`);
  }
}

checkHold('rifle', { cylPad: 0.006, thumbPad: 0.006 });
checkHold('lmg', { thumbPad: 0.01, aheadOf: -0.18 });

{
  const step = () => vm2.update(1 / 60, IDLE);
  vm2.setActive('lmg');
  step();
  assert.equal(vm2.armR.pose, 'gripLmg');
  vm2.holdGrenade();
  step();
  assert.equal(vm2.armR.pose, 'grenade');
  assert.equal(vm2.grenade.parent, vm2.armR.hand);
  assert(vm2.grenade.position.z < 0, `grenade seated in palm, z=${vm2.grenade.position.z}`);
  vm2.cookGrenade('long');
  vm2._cookBlend = 1;
  step();
  assert.equal(vm2.armR.pose, 'grenade');
  assert.equal(vm2._cookType, 'long');
  vm2.endGrenade();
  step();
  assert.equal(vm2.armR.pose, 'gripLmg');
  vm2.holdRadio();
  step();
  assert.equal(vm2.armR.pose, 'radio');
  assert.equal(vm2.radio.visible, true);
  assert(vm2.radio.position.y < 0, `radio in palm, y=${vm2.radio.position.y}`);
  vm2.rig.updateMatrixWorld(true);
  _inv.copy(vm2.radio.matrixWorld).invert();
  const BODY = { x0: -0.024, x1: 0.024, y0: 0.010, y1: 0.102, z0: -0.015, z1: 0.015 };
  for (let i = 0; i < 4; i++) {
    const f = vm2.armR.fingers[i];
    const rr = vm2.armR._segRadius[i];
    const ll = vm2.armR._segLength[i];
    const pts = [
      localOf(f.joints[0], 0, 0, -ll[0] * 0.5),
      localOf(f.joints[1], 0, 0, -ll[1] * 0.5),
      localOf(f.joints[2], 0, -rr[3] * 1.05, -ll[2] * 0.5),
    ];
    for (const p of pts) assert(!inBox(p, BODY), `radio finger ${i} inside body ${p.toArray().map((n) => n.toFixed(3))}`);
  }
  vm2.endRadio();
  step();
  assert.equal(vm2.armR.pose, 'gripLmg');
  vm2.holdGrenade();
  vm2.throwGrenade('long');
  vm2.onClipEvent = () => {};
  for (let i = 0; i < 120; i++) step();
  assert.equal(vm2._grenadeState, 0);
  assert.equal(vm2.armR.pose, 'gripLmg');
}
vm2.dispose?.();

console.log('LMG smoke checks passed');
