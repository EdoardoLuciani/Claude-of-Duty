import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ACTIONS } from '../../src/core/input.ts';
import { setCaseScale } from '../../src/fx/shells.ts';
import { WEAPON_DEFS, WEAPON_IDS, SECONDARY_IDS, buildRecoilPattern } from '../../src/weapons/defs.ts';
import { Rng } from '../../src/core/rng.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { makeM590Model, M590Animation, M590_URL } from '../../src/weapons/m590.ts';
import { makeM4Model, M4_URL } from '../../src/weapons/m4.ts';

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

async function shotgunModel() {
  const bytes = readFileSync(new URL(M590_URL));
  const loader = new GLTFLoader().register(() => ({ name: 'NODE_TEXTURE_STUB', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return makeM590Model(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''));
}
const model = await shotgunModel();
assert.equal(model.id, 'shotgun'); assert.equal(model.fxClass, 'shotgun');
assert.equal(model.shell.caseLen, .07); assert.equal(model.shell.rimR, .01105);
const animation = new M590Animation(model), clips = animation.clips();
assert(clips.pump, 'pump clip exists');
assert(clips.reloadTac.events.some(e => e.name === 'shellin'));
assert(clips.reloadEmpty.events.some(e => e.name === 'shellin'));
assert(!clips.reloadTac.events.some(e => e.name === 'magdrop'));
animation.dispose();

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
wp.sim = { spawn(o) { spawned.push(o); }, clear() {} };
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

assert.equal(wp.equipSecondary('smg'), true, 'MPX replaces the starting pistol');
assert(wp.owns('smg') && !wp.owns('pistol') && !wp.owns('shotgun'));
assert.deepEqual(wp.weaponIds, ['rifle', 'smg']);
assert.equal(wp.equipSecondary('shotgun'), true);
assert(wp.owns('shotgun') && !wp.owns('smg') && !wp.owns('pistol'));
assert.deepEqual(wp.weaponIds, ['rifle', 'shotgun']);
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
  const { Viewmodel } = await import('../../src/weapons/viewmodel.ts');
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
  vm3.addWeapon(await shotgunModel(), def);
  vm3.setActive('shotgun');
  assert.equal(vm3.active.parts.magazine, undefined, 'insert hull never enters detachable-magazine paths');
  const IDLE = { ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false };
  vm3.update(1 / 60, IDLE);
  assert.equal(vm3.active.animation.shellInsert.visible, false, 'idle hull hidden');
  vm3.play('pump');
  for (let i = 0; i < 40; i++) {
    vm3.update(1 / 60, IDLE);
    assert.equal(vm3.active.animation.shellInsert.visible, false, `hull visible during pump at frame ${i}`);
  }
  vm3.play('inspect');
  for (let i = 0; i < 20; i++) {
    vm3.update(1 / 60, IDLE);
    assert.equal(vm3.active.animation.shellInsert.visible, false, `hull visible during inspect at frame ${i}`);
  }
  vm3.dispose?.();
}

// Holster 'end' swaps the active weapon mid-update. _updateScope used to write
// the OLD group's visible back on, so both guns stayed on screen.
{
  const { Viewmodel } = await import('../../src/weapons/viewmodel.ts');
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
  const bytes = readFileSync(new URL(M4_URL));
  const loader = new GLTFLoader().register(() => ({ name: 'NODE_TEXTURE_STUB', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  vm4.addWeapon(makeM4Model(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')), rifleDef);
  vm4.addWeapon(await shotgunModel(), sgDef);
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
