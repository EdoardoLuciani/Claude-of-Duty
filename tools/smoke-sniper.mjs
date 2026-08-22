import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ACTIONS } from '../src/core/input.js';
import { setCaseScale } from '../src/fx/shells.js';
import { WEAPON_DEFS, WEAPON_IDS, PRIMARY_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { buildSniper } from '../src/weapons/models/sniper.js';
import { buildClips, makeSampleResult } from '../src/weapons/clips.js';
import { Viewmodel } from '../src/weapons/viewmodel.js';
import { ProjectileSim } from '../src/weapons/ballistics.js';

assert(WEAPON_IDS.includes('sniper'));
assert.deepEqual(PRIMARY_IDS, ['rifle', 'lmg', 'sniper']);
assert(ACTIONS.swapWeapon.includes('Digit3') && !ACTIONS.swapWeapon.includes('Digit4'));

const def = WEAPON_DEFS.sniper;
assert.equal(def.label, 'AX-338');
assert.equal(def.caliber, '8.6x70');
assert.deepEqual(def.modes, ['semi']);
assert.equal(def.boltAction, true);
assert.equal(def.magSize, 10);
assert.equal(def.muzzleVelocity, 880);
assert.equal(def.damage, 145);

const recoil = buildRecoilPattern(def, Rng);
assert.equal(recoil.length, def.recoil.patternLength * 2);
assert(recoil.every(Number.isFinite));
assert(recoil.every((n, i) => i % 2 || n > 0));

const model = buildSniper();
assert.equal(model.id, 'sniper');
assert.equal(model.nodes.opticGlass.kind, 'scope');
assert.equal(model.shell.caseLen, 0.0697);
assert.equal(model.shell.rimR, 0.0074);
const lmgScale = setCaseScale({}, 0.051, 0.01195 / 2);
const sniperScale = setCaseScale({}, model.shell.caseLen, model.shell.rimR);
assert.notEqual(sniperScale.lengthScale, lmgScale.lengthScale);
assert.notEqual(sniperScale.radiusScale, lmgScale.radiusScale);

const clips = buildClips(model.nodes, def);
assert(clips.cycle, 'bolt-action weapons expose a cycle clip');
assert.equal(clips.cycle.duration, def.boltTime);
const sample = makeSampleResult();
clips.cycle.sample(def.boltTime * 0.5, sample);
assert(sample.parts.bolt > 0.5, 'bolt is open mid-cycle');
assert(sample.rhand.weight > 0.5, 'shooting hand is on the bolt mid-cycle');

const scopedWeapon = { optic: { kind: 'scope' }, group: { visible: true } };
const scopeVm = {
  active: scopedWeapon, _grenadeState: 0, _radioState: 0,
  scopeOverlay: { visible: false },
  armL: { root: { visible: true } }, armR: { root: { visible: true } },
};
Viewmodel.prototype._updateScope.call(scopeVm, scopedWeapon, 1);
assert(!scopeVm.armL.root.visible && !scopeVm.armR.root.visible, 'scope hides arms');
scopeVm._grenadeState = 1;
Viewmodel.prototype._updateScope.call(scopeVm, scopedWeapon, 1);
assert(scopeVm.armL.root.visible && scopeVm.armR.root.visible, 'grenade restores scoped arms');
assert.equal(scopedWeapon.group.visible, false, 'accessory keeps the scoped weapon hidden');

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
  config: { adsFovScale: 0.62, adsSensScale: 0.62 },
};
wp.rng = new Rng(0x3381a9);
wp.sim = { spawn() {}, clear() {} };
wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
wp.viewmodel = vm;
for (const id of WEAPON_IDS) {
  const d = { ...WEAPON_DEFS[id] };
  d.cycleTime = 60 / d.rpm;
  wp.states.set(id, {
    def: d,
    pattern: buildRecoilPattern(d, Rng),
    mag: d.magSize,
    chambered: true,
    reserve: d.reserve,
    mode: d.modes[0],
    modeIndex: 0,
  });
}

assert.deepEqual(wp.weaponIds, ['rifle', 'smg', 'pistol']);
assert.equal(wp.equipPrimary('sniper'), true);
assert(wp.owns('sniper') && !wp.owns('rifle') && !wp.owns('lmg'));
assert.deepEqual(wp.weaponIds, ['smg', 'pistol', 'sniper']);
assert.equal(wp.activeId, 'sniper');
assert.equal(wp.state.mag, 10);
assert.equal(wp.state.reserve, 30);
assert.equal(wp.equipPrimary('sniper'), false);
assert.equal(wp.equipPrimary('lmg'), true);
assert(wp.owns('lmg') && !wp.owns('sniper'));
wp.resetForNewGame();
assert.deepEqual(wp.weaponIds, ['rifle', 'smg', 'pistol']);

wp.equipPrimary('sniper');
assert.equal(wp.tryFire(), true);
assert.equal(wp.state.chambered, false);
assert.equal(wp.state.mag, 10, 'bolt action does not strip the mag until chamber');
assert.equal(vm.clipName, 'cycle');
assert.equal(wp.tryFire(), false, 'blocked while the bolt is cycling');
assert.equal(wp.setWeapon('smg'), false, 'blocked while the bolt is cycling');
wp._onClipEvent('chamber', 'cycle');
assert.equal(wp.state.mag, 9);
assert.equal(wp.state.chambered, true);
wp.viewmodel.stopClip();

// Interrupted cycle: full box, empty chamber — reload must still chamber.
wp._fireTimer = 0;
wp.state.mag = 10;
wp.state.chambered = false;
assert.equal(wp.reload(), true);
assert.equal(vm.clipName, 'reloadEmpty');
wp._completeReload(true);
assert.equal(wp.state.chambered, true);
assert.equal(wp.state.mag, 9);
wp.viewmodel.stopClip();

wp._fireTimer = 0;
wp.state.mag = 0;
wp.state.chambered = true;
assert.equal(wp.tryFire(), true);
assert.equal(wp.viewmodel.boltHold, 1);
assert.notEqual(vm.clipName, 'cycle');

let resolved;
const actor = { id: 9 };
const physics = {
  MASK: { BULLET: 1 }, raycast: () => ({ hit: true }),
  fireBullet: () => [
    { point: new THREE.Vector3(1, 0, 0), exit: false, actor: null, damage: 20 },
    { point: new THREE.Vector3(2, 0, 0), exit: false, actor, part: 'torso', damage: 16 },
  ],
};
const sim = new ProjectileSim({
  peek: () => physics, has: () => true,
  events: { emit(type, e) { if (type === 'shot:resolved') resolved = e; } },
});
sim.spawn({ origin: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0),
  speed: 100, damage: 20, penetration: 2, weapon: def });
sim.fixedUpdate(1 / 60);
assert.equal(resolved.target, actor, 'telemetry resolves a penetrating actor hit');
assert.equal(resolved.part, 'torso');

console.log('Sniper smoke checks passed');
