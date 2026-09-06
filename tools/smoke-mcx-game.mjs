import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeMCXModel, MCX_URL } from '../src/weapons/mcx.js';
import { WEAPON_DEFS, WEAPON_IDS, PRIMARY_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Viewmodel } from '../src/weapons/viewmodel.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { buildSmg } from '../src/weapons/models/smg.js';
import { Rng } from '../src/core/rng.js';
import { resolveProfile, WEAPON_PROFILES } from '../src/audio/weapons.js';

const def = { ...WEAPON_DEFS.mcx, cycleTime: 60 / WEAPON_DEFS.mcx.rpm };
assert(PRIMARY_IDS.includes('mcx'));
assert.equal(WEAPON_DEFS.rifle.label, 'M4A1');
assert(def.muzzleVelocity < 343 && def.suppressed);
assert.equal(def.tracerEvery, 0);
assert.equal(resolveProfile('MCX VIRTUS'), WEAPON_PROFILES.mcx);
assert.notEqual(resolveProfile('mcx'), resolveProfile('rifle'));
assert(resolveProfile('mcx').suppressed && resolveProfile('mcx').sampleAction === false);
for (const n of [1, 2]) {
  const wav = readFileSync(new URL(`../src/audio/samples/mcx-${n}.wav`, import.meta.url));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt32LE(40) / 96000, .32);
  let peak = 0, energy = 0;
  for (let i = 44; i < wav.length; i += 2) {
    const x = wav.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(x)); energy += x * x;
  }
  assert(peak > .59 && peak < .60, '4.5 dB peak headroom');
  assert(energy > .1);
  assert.equal(wav.readInt16LE(wav.length - 2), 0, 'clean end fade');
}

// Exercise the REAL GLB hierarchy, animation samplers and runtime adapter.
// Only PNG decoding is stubbed: WebGL/browser decoding is checked separately.
const bytes = readFileSync(new URL(MCX_URL));
const loader = new GLTFLoader().register(() => ({
  name: 'NODE_TEXTURE_STUB', loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const model = makeMCXModel(gltf);
assert(model.nodes.muzzle[2] < -.59 && Math.abs(model.nodes.muzzle[0]) < 1e-6, '-Z forward');
assert(model.nodes.eject[0] > .02, 'ejection to shooter right');
assert.equal(model.nodes.opticGlass.reticle, 'chevron');
assert.equal(model.shell.caseLen, .0348);
for (const m of model.materials) {
  assert(m.isMeshStandardMaterial && m.transmission === 0, 'no full-scene transmission pass');
  if (m.name.startsWith('01')) assert(m.metalness === 0 && m.specularIntensity < .2, 'anodized coating, not chrome');
}
const camera = new THREE.PerspectiveCamera(80, 16 / 9, .004, 60);
const messages = [];
const ctx = {
  viewScene: new THREE.Scene(), camera, viewCamera: camera,
  rng: new Rng(0x300bc), time: { elapsed: 0, scale: 1 },
  events: { emit: (name, data) => messages.push({ name, ...data }) },
};
const vm = new Viewmodel(ctx, {
  get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(),
  reticleOutline: () => new THREE.MeshBasicMaterial(),
});
vm.addWeapon(buildRifle(), { ...WEAPON_DEFS.rifle, cycleTime: 60 / WEAPON_DEFS.rifle.rpm });
vm.addWeapon(buildSmg(), { ...WEAPON_DEFS.smg, cycleTime: 60 / WEAPON_DEFS.smg.rpm });
const entry = vm.addWeapon(model, def);
const rig = entry.animation;
assert.equal(rig.root.getObjectByName('spent_case').visible, false);
assert.equal(Object.keys(rig.actions).length, 6);
assert(Math.abs(entry.clips.reloadTac.duration - def.reloadTac) < 1e-6);
assert(Math.abs(entry.clips.reloadEmpty.duration - def.reloadEmpty) < 1e-6);
assert(Math.abs(entry.clips.inspect.duration - def.inspectTime) < 1e-6);
assert(Math.abs(entry.clips.stockFold.duration - def.stockFoldTime) < 1e-6);
assert.equal(entry.clips.reloadTac.events.find(e => e.name === 'magin').t, 111 / 60);

const wp = new WeaponSystem();
wp.ctx = ctx; wp.rng = ctx.rng; wp.viewmodel = vm;
wp.sim = { spawn() {}, clear() {} };
wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
for (const id of WEAPON_IDS) {
  const d = { ...WEAPON_DEFS[id], cycleTime: 60 / WEAPON_DEFS[id].rpm };
  wp.states.set(id, { def: d, pattern: buildRecoilPattern(d, Rng), mag: d.magSize, chambered: true,
    reserve: d.reserve, mode: d.modes[0], modeIndex: 0 });
}
vm.onClipEvent = (name, clip) => wp._onClipEvent(name, clip);
function step(seconds) {
  const count = Math.round(seconds * 120);
  for (let i = 0; i < count; i++) {
    ctx.time.elapsed += 1 / 120;
    wp._fireTimer = Math.max(0, wp._fireTimer - 1 / 120 - 1e-12); // exact cadence boundary
    wp._state.empty = !wp.state.mag && !wp.state.chambered;
    wp.lateUpdate(1 / 120, ctx);
  }
}
assert.deepEqual(wp.weaponIds, ['rifle', 'smg', 'pistol']);
assert(wp.equipPrimary('mcx'));
assert(!wp.owns('rifle') && wp.owns('mcx') && wp.owns('smg') && wp.owns('pistol'));
assert.equal(wp.activeId, 'mcx');
assert.equal(wp.weaponIds.length, 3);
step(.1);

// Automatic cadence must finish the carrier return, not restart an open bolt.
messages.length = 0;
for (let i = 0; i < 10; i++) {
  assert(wp.tryFire());
  step(.075);
  assert(Math.abs(rig.bolt.position.x) < .001, 'carrier in battery before next 800 rpm shot');
}
assert.equal(messages.filter(m => m.name === 'weapon:fire').length, 10);
const shells = messages.filter(m => m.name === 'weapon:shell');
assert.equal(shells.length, 10, 'exactly one independent shell per live round');
assert(shells.every(s => s.caseLen === .0348 && s.weapon.id === 'mcx'));
assert.equal(wp.state.mag, 20);
assert.equal(rig.root.getObjectByName('spent_case').visible, false);

assert(wp.reload());
assert.equal(vm.clipName, 'reloadTac');
assert(!wp.tryFire());
step(1.8);
assert.equal(wp.state.mag, 20, 'no early ammo grant');
step(.1);
assert.equal(wp.state.mag, 30);
assert.equal(wp.state.reserve, 170);
step(.8);
assert.equal(wp.reloading, false);
assert(rig.magazine.visible && !rig.spare.visible, 'one seated mag after reload');

wp.state.mag = 0; wp.state.chambered = false;
assert(wp.reload());
assert.equal(vm.clipName, 'reloadEmpty');
step(.8);
assert(rig.bolt.position.x < -.06, 'empty reload holds bolt open');
step(2.7);
assert(wp.state.chambered && wp.state.mag === 29 && wp.state.reserve === 140);
assert(Math.abs(rig.bolt.position.x) < .001);

// Last round stays open; reload interruption cannot leak a spare mag/stock pose.
wp.state.mag = 0; wp.state.chambered = true;
assert(wp.tryFire()); step(.2);
assert(rig.bolt.position.x < -.06);
assert(wp.reload()); step(.8);
const reserveBeforeCancel = wp.state.reserve;
assert(wp.equipPrimary('rifle'));
assert(!wp.reloading && rig.magazine.visible && !rig.spare.visible);
assert.equal(wp.states.get('mcx').reserve, reserveBeforeCancel);
assert(wp.equipPrimary('mcx'));
assert(wp.inspect()); step(.8);
assert.equal(rig.name, 'Inspect');
assert(wp.tryFire(), 'fire interrupts inspect'); step(.4);
assert(wp.foldStock()); step(.8);
assert.equal(rig.name, 'Stock_Fold');
assert(rig.stock.quaternion.angleTo(new THREE.Quaternion()) > 2);
assert(wp.inspecting && !wp.foldStock());
step(1.3);
assert(!wp.inspecting && rig.stock.quaternion.angleTo(new THREE.Quaternion()) < .001);

// A holster's end callback starts draw; the finished old clip must not erase it.
assert(wp.setWeapon('smg'));
step(.41);
assert.equal(wp.activeId, 'smg');
assert.equal(vm.clipName, 'draw');
step(.7);
assert(wp.setWeapon('mcx'));
step(1.2);
assert.equal(wp.activeId, 'mcx');
assert.equal(vm.clipName, null);

// Shader selection / aspect / hidden hands at 4x, and reset to the original M4.
vm._updateScope(entry, 1);
assert(vm.scopeOverlay.visible && !vm.armL.root.visible && !vm.armR.root.visible);
assert.equal(vm.scopeReticle.material.uniforms.uChevron.value, 1);
assert.equal(vm.scopeMask.material.uniforms.uAspect.value, 16 / 9);
wp.state.mag = 0; wp.state.chambered = false;
assert(wp.reload()); step(.8);
const beforeDeath = wp.state.reserve;
wp._onPlayerDeath(); step(1);
assert(wp.disabled && !vm.anchor.visible && !wp.reloading);
assert.equal(wp.state.reserve, beforeDeath, 'death cannot finish a cancelled reload');
assert(rig.magazine.visible && !rig.spare.visible);
wp.resetForNewGame();
assert.deepEqual(wp.weaponIds, ['rifle', 'smg', 'pistol']);
assert.equal(wp.activeId, 'rifle');
assert.equal(wp.states.get('mcx').reserve, def.reserve);
assert(rig.magazine.visible && !rig.spare.visible);
vm.dispose();
assert.equal(model.materials.size, 0);
assert.equal(model.textures.size, 0);
console.log('MCX gameplay smoke checks passed: real GLB, six clips, ammo/cadence, interruption, scope, shell and sound contracts');
