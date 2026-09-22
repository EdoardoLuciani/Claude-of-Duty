import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ACTIONS } from '../src/core/input.js';
import { setCaseScale } from '../src/fx/shells.js';
import { WEAPON_DEFS, WEAPON_IDS, SECONDARY_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { buildShotgun } from '../src/weapons/models/shotgun.js';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { buildClips, makeSampleResult } from '../src/weapons/clips.js';

assert.deepEqual(WEAPON_IDS, ['rifle', 'smg', 'pistol', 'lmg', 'shotgun', 'sniper', 'mcx']);
assert(WEAPON_IDS.every((id) => WEAPON_DEFS[id]));
assert.deepEqual(SECONDARY_IDS, ['pistol', 'smg', 'shotgun']);
assert(ACTIONS.swapWeapon.includes('Digit1') && ACTIONS.swapWeapon.includes('Digit2') &&
  ACTIONS.swapWeapon.includes('Tab') && !ACTIONS.swapWeapon.includes('Digit3'));
assert(ACTIONS.radio.includes('KeyX') && ACTIONS.heal.includes('KeyH'));

const sg = WEAPON_DEFS.shotgun;
assert.equal(sg.label, 'M-590');
assert.equal(sg.class, 'shotgun');
assert.equal(sg.caliber, '12g');
assert.equal(sg.pellets, 8);
assert.equal(sg.reloadStyle, 'tube');
assert.equal(sg.action, 'pump');
assert.deepEqual(sg.modes, ['semi']);
assert.equal(sg.magSize, 6);
assert.equal(sg.reserve, 30);
assert(sg.maxRange >= 80, '00 buck stays lethal well past a room');
assert(sg.spreadAds < 0.5, 'FliteControl-tight ADS cone');
assert(sg.spreadHip < 1.6, 'hip cone is a soldier, not a room, at 25 m');

const recoil = buildRecoilPattern(sg, Rng);
assert.equal(recoil.length, sg.recoil.patternLength * 2);
assert(recoil.every(Number.isFinite));
assert(recoil.every((n, i) => i % 2 || n > 0));

const scale = setCaseScale({}, 0.07, 0.01105);
assert(scale.lengthScale > 1.4, '12g hull is longer than 5.56');
assert(scale.radiusScale > 2, '12g hull is fatter than 5.56');

const model = buildShotgun();
assert.equal(model.id, 'shotgun');
assert.equal(model.fxClass, 'shotgun');
assert(model.body);
assert(model.moving.charging);
assert(model.moving.magazine);
assert(model.moving.bolt);
assert(model.moving.trigger);
assert.equal(model.nodes.muzzle.length, 3);
assert(model.nodes.handguard.r > 0);
assert(model.shell.caseLen > 0.06);
assert(model.shell.rimR > 0.009);

const clips = buildClips(model.nodes, sg);
assert(clips.pump, 'pump clip exists');
assert(clips.reloadTac.events.some((e) => e.name === 'shellin'));
assert(clips.reloadEmpty.events.some((e) => e.name === 'shellin'));
assert(!clips.reloadTac.events.some((e) => e.name === 'magdrop'));

// The forend, the bolt its action bars drive and the support hand that grips it
// move as one part; a shorter bolt or hand figure slides the glove along the pump
// (or buries the forend in the receiver) instead of cycling it.
assert.equal(model.nodes.boltTravel[2], model.nodes.chargePull[2], 'bolt matches the forend stroke');
const pumpSample = makeSampleResult();
for (const f of [0, 0.2, 0.35, 0.5, 0.7, 0.85, 1]) {
  clips.pump.sample(f * clips.pump.duration, pumpSample);
  const hand = pumpSample.lhand.pos[2] - model.nodes.gripL.pos[2];
  assert(Math.abs(hand - pumpSample.parts.charge * model.nodes.chargePull[2]) < 1e-6,
    `pump at ${f * 100}%: hand sits ${(hand * 1000).toFixed(1)} mm off the forend`);
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

const wp = new WeaponSystem();
wp.ctx = {
  time: { elapsed: 0, scale: 1 },
  camera: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), updateMatrixWorld() {} },
};
wp.rng = new Rng(0x590b00);
const spawned = [];
wp.sim = { spawn(o) { spawned.push(o); }, clear() {}, stats: { live: 0, fired: 0 } };
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

assert.deepEqual(wp.weaponIds, ['rifle', 'pistol']);
assert(wp.owns('pistol') && !wp.owns('smg') && !wp.owns('shotgun'));

const pressed = { code: null };
const input = {
  fire: false, firePressed: false, ads: false, wheel: 0, frozen: false, enabled: true,
  actionPressed() { return false; },
  pressed(code) { return code === pressed.code; },
  held() { return false; },
};
const player = {
  dead: false, controlEnabled: true, adsRequested: false, sprinting: false,
  stance: 'stand', airborne: false, horizontalSpeed: 0, state: 'idle',
  setAdsProgress() {},
};
wp.player = player;
wp.ctx.input = input;
wp.ctx.peek = (id) => id === 'player' ? player : null;
const tap = (code) => { pressed.code = code; wp.update(0, wp.ctx); pressed.code = null; };

wp.setWeaponImmediate('pistol');
tap('Digit1');
assert.equal(wp._switchTo, 'rifle', '1 selects the equipped primary');
wp.setWeaponImmediate('rifle');
tap('Digit2');
assert.equal(wp._switchTo, 'pistol', '2 selects the equipped secondary');
wp.setWeaponImmediate('rifle');
tap('Digit3');
assert.equal(wp._switchTo, null, '3 has no normal weapon binding');
assert.equal(wp.radioEquipped, false, '3 does not equip utility equipment');
assert.equal(wp.activeId, 'rifle');
assert.equal(wp.nextWeapon(), true);
assert.equal(wp._switchTo, 'pistol', 'cycling reaches only the current secondary');
wp.setWeaponImmediate('pistol');
assert.equal(wp.nextWeapon(), true);
assert.equal(wp._switchTo, 'rifle', 'cycling wraps to the current primary');
wp.setWeaponImmediate('rifle');
wp.equipPrimary('lmg');
wp.setWeaponImmediate('pistol');
tap('Digit1');
assert.equal(wp._switchTo, 'lmg', '1 selects the equipped primary after a primary swap');
wp.equipPrimary('rifle');

assert.equal(wp.equipSecondary('smg'), true, 'MPX replaces the starting pistol');
assert(wp.owns('smg') && !wp.owns('pistol') && !wp.owns('shotgun'));
assert.deepEqual(wp.weaponIds, ['rifle', 'smg']);
wp.setWeaponImmediate('rifle');
tap('Digit2');
assert.equal(wp._switchTo, 'smg', '2 selects the equipped MPX secondary');
assert.equal(wp.equipSecondary('shotgun'), true);
assert(wp.owns('shotgun') && !wp.owns('smg') && !wp.owns('pistol'));
assert.deepEqual(wp.weaponIds, ['rifle', 'shotgun']);
wp.setWeaponImmediate('rifle');
tap('Digit2');
assert.equal(wp._switchTo, 'shotgun', '2 selects the equipped shotgun secondary');
wp.setWeaponImmediate('shotgun');
assert.equal(wp.activeId, 'shotgun');
assert.equal(wp.state.mag, sg.magSize);
assert.equal(wp.state.reserve, sg.reserve);
assert.equal(wp.equipSecondary('shotgun'), false, 'cannot buy a weapon already equipped');

wp.state.mag = 3;
assert.equal(wp.reload(), true);
assert.equal(wp.reloading, true);
assert.equal(wp.equipSecondary('smg'), true, 'swap back to the MPX');
assert.equal(wp.reloading, false);
assert.equal(wp.tryFire(), true);
assert.equal(wp.state.mag, WEAPON_DEFS.smg.magSize - 1);

wp.equipSecondary('shotgun');
wp.resetForNewGame();
assert.deepEqual(wp.weaponIds, ['rifle', 'pistol']);
assert.equal(wp.activeId, 'rifle');
assert(!wp.owns('shotgun'));

wp.equipSecondary('shotgun');
spawned.length = 0;
wp.stats.fired = 0;
assert.equal(wp.tryFire(), true);
assert.equal(spawned.length, 8, 'one shell is eight pellets');
assert.equal(wp._pendingShots, 1, 'one weapon:fire per shell');
assert(spawned.every((p) => p.tracer === false), '12g has no tracer');
assert.equal(wp.viewmodel.clipName, 'pump');
assert.equal(wp.state.mag, sg.magSize - 1);
assert.equal(wp.state.chambered, true);

wp._fireTimer = 0;
wp.viewmodel.stopClip();
wp.state.mag = 0;
wp.state.chambered = true;
spawned.length = 0;
assert.equal(wp.tryFire(), true);
assert.equal(wp.state.chambered, false);
assert.equal(wp.state.mag, 0);
assert.equal(spawned.length, 8);

wp._fireTimer = 0;
wp.viewmodel.stopClip();
wp.state.reserve = 4;
wp.state.mag = 0;
wp.state.chambered = false;
assert.equal(wp.reload(), true);
assert.equal(wp.viewmodel.clipName, 'reloadEmpty');
wp._insertShell();
assert.equal(wp.state.chambered, true);
assert.equal(wp.state.mag, 0);
assert.equal(wp.state.reserve, 3);
wp._insertShell();
assert.equal(wp.state.mag, 1);
wp._insertShell();
wp._insertShell();
assert.equal(wp.state.reserve, 0);
assert.equal(wp._insertShell(), false);

wp.state.reserve = 10;
wp.state.mag = sg.magSize;
assert.equal(wp._insertShell(), false, 'tube full');

// Pump after a shot must never flash the insert hull under the receiver.
{
  const { Viewmodel } = await import('../src/weapons/viewmodel.js');
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.004, 60);
  const vm3 = new Viewmodel({
    viewScene: new THREE.Scene(),
    camera: cam,
    viewCamera: cam,
    rng: new Rng(0x590b00),
  }, {
    get: () => new THREE.MeshStandardMaterial(),
    reticle: () => new THREE.MeshBasicMaterial(),
    reticleOutline: () => new THREE.MeshBasicMaterial(),
  });
  const def = { ...sg, cycleTime: 60 / sg.rpm };
  vm3.addWeapon(buildShotgun(), def);
  vm3.setActive('shotgun');
  const IDLE = { ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false };
  vm3.update(1 / 60, IDLE);
  assert.equal(vm3.active.parts.magazine.visible, false, 'idle hull hidden');
  vm3.play('pump');
  for (let i = 0; i < 40; i++) {
    vm3.update(1 / 60, IDLE);
    assert.equal(vm3.active.parts.magazine.visible, false, `hull visible during pump at frame ${i}`);
  }
  vm3.play('inspect');
  for (let i = 0; i < 20; i++) {
    vm3.update(1 / 60, IDLE);
    assert.equal(vm3.active.parts.magazine.visible, false, `hull visible during inspect at frame ${i}`);
  }
  vm3.dispose?.();
}

// Holster 'end' swaps the active weapon mid-update. _updateScope used to write
// the OLD group's visible back on, so both guns stayed on screen.
{
  const { Viewmodel } = await import('../src/weapons/viewmodel.js');
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.004, 60);
  const vm4 = new Viewmodel({
    viewScene: new THREE.Scene(),
    camera: cam,
    viewCamera: cam,
    rng: new Rng(0x590b00),
  }, {
    get: () => new THREE.MeshStandardMaterial(),
    reticle: () => new THREE.MeshBasicMaterial(),
    reticleOutline: () => new THREE.MeshBasicMaterial(),
  });
  const rifleDef = { ...WEAPON_DEFS.rifle, cycleTime: 60 / WEAPON_DEFS.rifle.rpm };
  const sgDef = { ...sg, cycleTime: 60 / sg.rpm };
  vm4.addWeapon(buildRifle(), rifleDef);
  vm4.addWeapon(buildShotgun(), sgDef);
  vm4.setActive('rifle');
  vm4.onClipEvent = (name, clipName) => {
    if (name === 'end' && clipName === 'holster') {
      vm4.setActive('shotgun');
      vm4.play('draw');
    }
  };
  const IDLE = { ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false };
  vm4.play('holster');
  const holsterDur = vm4.clip.duration;
  for (let t = 0; t < holsterDur + 0.05; t += 1 / 60) vm4.update(1 / 60, IDLE);
  const rifle = vm4.weapons.get('rifle');
  const shotgun = vm4.weapons.get('shotgun');
  assert.equal(rifle.group.visible, false, 'holstered rifle stays hidden');
  assert.equal(shotgun.group.visible, true, 'drawn shotgun is visible');
  vm4.dispose?.();
}

console.log('Shotgun smoke checks passed');
