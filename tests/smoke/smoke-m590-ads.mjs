// Held-input ADS through the real M590 pump, weapon-to-player handoff and FOV paths.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import manifest from '../../assets/weapons/m590/manifest.json' with { type: 'json' };
import { Input } from '../../src/core/input.ts';
import { Rng } from '../../src/core/rng.ts';
import { CameraRig } from '../../src/player/camera.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';
import { WEAPON_IDS } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { makeM4Model, M4_URL } from '../../src/weapons/m4.ts';
import { makeM590Model, M590_URL } from '../../src/weapons/m590.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';

const input = new Input({}, { sensitivity: 0.002, invertY: false });
input._pollGamepad = () => {};
const player = new PlayerSystem(),
  wp = new WeaponSystem(),
  events = [];
const ctx = {
  input,
  config: { fov: 80, adsFovScale: 0.62, adsSensScale: 0.62 },
  camera: new THREE.PerspectiveCamera(80, 16 / 9, 0.004, 100),
  viewCamera: new THREE.PerspectiveCamera(60, 16 / 9, 0.004, 100),
  scene: new THREE.Scene(),
  viewScene: new THREE.Scene(),
  rng: new Rng(410),
  time: { elapsed: 0, frame: 0, scale: 1 },
  peek: (id) => (id === 'player' ? player : null),
  get: () => ({ screenSize: { height: 720 } }),
  events: {
    emit(name) {
      events.push({ name, time: vm.clipT });
    },
  },
};
player.ctx = ctx;
player.movement = new Movement(ctx, player);
player.movement.character = {
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  grounded: true,
};
player.rig = new CameraRig(ctx);
player.health = new Health(ctx, player.rig);
const vm = new Viewmodel(ctx, {
  get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(),
  reticleOutline: () => new THREE.MeshBasicMaterial(),
});
wp.ctx = ctx;
wp.player = player;
wp.viewmodel = vm;
wp.rng = ctx.rng;
const shots = [];
wp.sim = {
  spawn(o) {
    shots.push(o);
  },
  stats: { live: 0, fired: 0 },
};
wp.stats = { tris: 0, fired: 0, live: 0, drawCalls: 0 };
for (const id of WEAPON_IDS) wp.states.set(id, wp._makeState(id));
const loader = new GLTFLoader().register(() => ({
  name: 'SMOKE_TEXTURE',
  loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
for (const [url, makeModel] of [
  [M590_URL, makeM590Model],
  [M4_URL, makeM4Model],
]) {
  const bytes = readFileSync(new URL(url));
  const model = makeModel(
    await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      ''
    )
  );
  vm.addWeapon(model, wp.states.get(model.id).def);
}
wp.owned.add('shotgun');
wp.activeId = 'shotgun';
vm.setActive('shotgun');
vm.onClipEvent = (event, clip) => wp._onClipEvent(event, clip);
const dt = 1 / 240;
function frame({ down = [], up = [] } = {}) {
  for (const code of down) input._pendingDown.add(code);
  for (const code of up) input._pendingUp.add(code);
  input.beginFrame();
  ctx.time.frame++;
  ctx.time.elapsed += dt;
  player._updateAds(dt);
  wp.update(dt, ctx);
  player.rig.update(dt, player.movement, player.health);
  player.rig.applyTo(ctx.camera);
  wp.lateUpdate(dt, ctx);
  input.endFrame();
}
function step(count) {
  for (let i = 0; i < count; i++) frame();
}
function settledADS() {
  assert.equal(vm.adsT, 1);
  assert.equal(vm.adsTarget, 1);
  assert.equal(player.adsProgress, 1);
  assert.equal(player.movement.adsAmount, 1);
  assert(
    Math.abs(ctx.camera.fov - ctx.config.fov * ctx.config.adsFovScale) < 0.001,
    'world ADS FOV retained'
  );
  assert(
    Math.abs(ctx.viewCamera.fov - 60 * wp.current.viewFov) < 0.001,
    'viewmodel ADS FOV retained'
  );
}
frame({ down: ['Mouse2'] });
step(480);
settledADS();
assert.equal(wp.ammo.mag, 7, 'full 6+1 before shot');
frame({ down: ['Mouse0'] });
assert.equal(vm.clipName, 'pump');
assert.equal(vm.clip.duration, manifest.clips.Pump.duration);
assert.equal(wp.ammo.mag, 6);
assert.equal(shots.length, 8);
frame({ up: ['Mouse0'] });
const animation = vm.active.animation,
  forend = animation.root.getObjectByName('forend');
const forendRest = forend.position.z;
let maxStroke = 0,
  maxRootTilt = 0,
  maxRecoil = 0;
while (wp.pumping) {
  settledADS();
  assert.equal(wp.canFire(), false);
  assert.equal(wp.tryFire(), false, 'pump remains busy even after fire timer expires');
  maxStroke = Math.max(maxStroke, forend.position.z - forendRest);
  maxRootTilt = Math.max(maxRootTilt, animation.root.quaternion.angleTo(new THREE.Quaternion()));
  maxRecoil = Math.max(maxRecoil, Math.abs(vm.recPos.z));
  assert.equal(animation.mixer.time, 0, 'clip time is the only authored animation clock');
  assert.equal(animation.shellInsert.visible, false);
  assert(
    vm.armL.hand.position.distanceTo(vm._handPosL) < 1e-6,
    'support wrist follows authored pump contact'
  );
  frame();
}
assert(
  Math.abs(vm.clipT - manifest.clips.Pump.duration) <= dt + 1e-9,
  'full original pump duration'
);
assert(maxStroke > 0.08, 'native action travel retained');
assert(maxRootTilt > 0.05, 'authored handling tilt retained');
assert(maxRecoil > 0.001, 'reactive recoil retained');
const shells = events.filter((e) => e.name === 'weapon:shell');
assert.equal(shells.length, 1, 'one genuine ejection');
assert(
  Math.abs(shells[0].time - manifest.clips.Pump.events[0].time) <= dt,
  'ejection keeps authored event timing'
);
step(12);
settledADS();
assert.equal(shots.length, 8, 'busy fire attempts consumed no extra shell');

// Release and repress RMB while the same native pump continues.
frame({ down: ['Mouse0'] });
frame({ up: ['Mouse0'] });
step(12);
const clip = vm.clip,
  timeBeforeRelease = vm.clipT;
frame({ up: ['Mouse2'] });
assert.equal(vm.adsTarget, 0);
assert(vm.adsT < 1);
step(12);
const released = vm.adsT;
assert(released < 1);
assert(player.adsProgress < 1);
assert(ctx.camera.fov > 49.6);
assert.equal(vm.clip, clip);
assert(vm.clipT > timeBeforeRelease);
frame({ down: ['Mouse2'] });
assert.equal(vm.adsTarget, 1);
assert(vm.adsT > released, 'ADS can resume during pump');
while (wp.pumping) frame();
step(480);
settledADS();
assert.equal(events.filter((e) => e.name === 'weapon:shell').length, 2);
assert.equal(shots.length, 16);

// Enter ADS from hip during a pump, without restarting its clock.
frame({ up: ['Mouse2'] });
step(60);
assert.equal(vm.adsT, 0);
frame({ down: ['Mouse0'] });
frame({ up: ['Mouse0'] });
const hipPump = vm.clip;
frame({ down: ['Mouse2'] });
assert.equal(vm.clip, hipPump);
assert.equal(vm.adsTarget, 1);
assert(vm.adsT > 0);
while (wp.pumping) frame();
step(480);
settledADS();

// Existing reload/inspect/holster exclusions and draw behavior stay intact,
// on both M590 and a different authored weapon.
frame({ down: ['KeyR'] });
frame({ up: ['KeyR'] });
assert(wp.reloading);
assert.equal(vm.adsTarget, 0);
step(55);
assert.equal(vm.adsT, 0);
assert(player.adsProgress < 0.01);
assert(ctx.camera.fov > 75);
vm.stopClip();
wp._tubeLoop = false;
for (const id of ['shotgun', 'rifle']) {
  wp.activeId = id;
  vm.setActive(id);
  step(480);
  settledADS();
  for (const name of ['reloadTac', 'reloadEmpty', 'inspect', 'holster']) {
    vm.adsT = 1;
    vm.play(name);
    frame();
    assert.equal(vm.adsTarget, 0, `${id}/${name} still excludes ADS`);
    assert(vm.adsT < 1);
    vm.stopClip();
  }
  vm.adsT = 1;
  vm.play('draw');
  frame();
  assert.equal(vm.adsTarget, 1);
  assert.equal(vm.adsT, 1);
  vm.stopClip();
}
vm.dispose();
console.log(
  'M590 ADS: held full pump + native motion/ejection/busy fire, release/repress/enter mid-pump, post-pump Player/world/view FOV, reload/inspect/holster exclusions and rifle behavior passed'
);
