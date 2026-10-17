// Runtime adapter/lifecycle coverage complements the independent dense asset contact sweep.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import reference from '../../assets/weapons/m590/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/m590/manifest.json' with { type: 'json' };
import { Rng } from '../../src/core/rng.ts';
import { buildClips, makeSampleResult } from '../../src/weapons/clips.ts';
import { WEAPON_DEFS, WEAPON_IDS } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { makeM4Model, M4_URL } from '../../src/weapons/m4.ts';
import { makeM590Model, M590Animation, M590_URL } from '../../src/weapons/m590.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';

const loader = new GLTFLoader().register(() => ({
  name: 'SMOKE_TEXTURE',
  loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
async function parse(url) {
  const bytes = readFileSync(new URL(url));
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  );
}
assert.equal(
  createHash('sha256')
    .update(readFileSync(new URL(M590_URL)))
    .digest('hex'),
  'd1244541c2654926cceecefc8ccef7251232df9e2b274de374d3471551c7e30e'
);
const model = makeM590Model(await parse(M590_URL)),
  animation = new M590Animation(model);
assert.equal(model.reactiveFire, true);
assert.equal(model.fxClass, 'shotgun');
assert.deepEqual(model.shell, { caseLen: 0.07, rimR: 0.01105 });
assert.deepEqual(model.nodes.gripR, reference.grips.right);
assert.deepEqual(model.nodes.gripL, reference.grips.left);
assert.equal(model.nodes.opticGlass, null);
assert.equal(animation.magazineBody, undefined);
assert.equal(animation.magazine, undefined);
assert.equal(model.moving, undefined);
assert.equal(animation.mixer.time, 0);
assert.equal(Object.keys(animation.actions).length, 7);
assert(model.root.scale.equals(new THREE.Vector3(1, 1, 1)), 'no scale shim');
assert(model.root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6, 'native game basis');
for (const [name, expected] of Object.entries(manifest.sockets)) {
  const key = name === 'ejection' ? 'eject' : name;
  if (!model.nodes[key]) continue;
  assert(new THREE.Vector3(...model.nodes[key]).distanceTo(new THREE.Vector3(...expected)) < 1e-6);
}
const legacy = buildClips({ ...model.nodes, chargeRest: { pos: [0, 0, 0] } }, WEAPON_DEFS.shotgun);
for (const [name, clip] of Object.entries(animation.clips())) {
  assert.equal(clip.duration, legacy[name].duration, `${name}: duration preserved`);
  assert.deepEqual(clip.events, legacy[name].events, `${name}: exact gameplay events preserved`);
  const sample = makeSampleResult();
  clip.sample(clip.duration / 2, sample);
  assert.deepEqual(sample.pos, [0, 0, 0]);
  assert.deepEqual(sample.rot, [0, 0, 0]);
  assert.equal(sample.lhand.weight, 0);
  assert.equal(sample.rhand.weight, 0);
}
const bolt = model.root.getObjectByName('bolt'),
  forend = model.root.getObjectByName('forend');
const boltRest = bolt.position.clone(),
  forendRest = forend.position.clone();
for (const [name, first, last] of [
  ['reloadTac', 0.187, 0.462],
  ['reloadEmpty', 0.418, 0.665],
]) {
  for (const time of [first - 0.0001, first + 0.0001, (first + last) / 2, last + 0.0001]) {
    animation.update(0, name, time);
    assert.equal(
      animation.shellInsert.visible,
      time >= first && time < last,
      `${name}/${time}: authored STEP visibility`
    );
    animation.reset();
    assert.equal(animation.shellInsert.visible, false);
    assert(
      bolt.position.distanceTo(boltRest) < 1e-6 && forend.position.distanceTo(forendRest) < 1e-6
    );
    for (const side of ['left', 'right'])
      assert(
        animation.hands[side].wrist.position.distanceTo(
          new THREE.Vector3(...reference.grips[side].pos)
        ) < 1e-6
      );
  }
}
animation.update(0, 'pump', 0.2);
assert(
  Math.abs(forend.position.z - forendRest.z - 0.089) < 1e-6,
  'provisional native 89 mm stroke'
);
assert(Math.abs(bolt.position.z - boltRest.z - 0.089) < 1e-6);
assert(
  Math.abs(animation.hands.left.wrist.position.z - reference.grips.left.pos[2] - 0.089) < 1e-6,
  'pump hand planted'
);
assert.equal(animation.shellInsert.visible, false);
animation.fire();
assert.equal(animation.mixer.time, 0, 'no second animation clock or fire action');
animation.dispose();
assert.equal(model.materials.size, 0);
assert.equal(model.textures.size, 0);

const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.004, 100),
  events = [],
  shots = [];
const ctx = {
  viewScene: new THREE.Scene(),
  scene: new THREE.Scene(),
  camera,
  viewCamera: new THREE.PerspectiveCamera(60, 16 / 9, 0.004, 100),
  rng: new Rng(410),
  time: { elapsed: 0, scale: 1 },
  get: () => ({ screenSize: { height: 720 } }),
  events: {
    emit(name, payload) {
      events.push({
        name,
        phase: payload.phase,
        time: vm.clipT,
        position: payload.position?.clone(),
        velocity: payload.velocity?.clone(),
        fxClass: payload.fxClass,
        caseLen: payload.caseLen,
        caseRadius: payload.caseRadius,
      });
    },
  },
};
const vm = new Viewmodel(ctx, {
  get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(),
  reticleOutline: () => new THREE.MeshBasicMaterial(),
});
const wp = new WeaponSystem();
wp.ctx = ctx;
wp.viewmodel = vm;
wp.rng = ctx.rng;
wp.sim = {
  spawn(o) {
    shots.push(o);
  },
  clear() {},
};
wp.stats = { tris: 0, fired: 0, live: 0, drawCalls: 0 };
for (const id of WEAPON_IDS) wp.states.set(id, wp._makeState(id));
const entry = vm.addWeapon(makeM590Model(await parse(M590_URL)), wp.states.get('shotgun').def);
vm.addWeapon(makeM4Model(await parse(M4_URL)), wp.states.get('rifle').def);
wp.owned.add('shotgun');
wp.activeId = 'shotgun';
vm.setActive('shotgun');
vm.onClipEvent = (event, clip) => wp._onClipEvent(event, clip);
assert.equal(entry.parts.magazine, undefined);
assert.equal(wp._magProxy(entry), null, 'no shell magazine pool');
const idle = () => {
  wp._state.empty = !wp.ammo.total;
  wp._state.magazineLoaded = wp.state.mag > 0;
};
function step(count = 1) {
  for (let i = 0; i < count; i++) {
    idle();
    wp.lateUpdate(1 / 240, ctx);
  }
}
function setup(mag, chambered, reserve) {
  vm.stopClip();
  wp._tubeLoop = false;
  wp._fireTimer = 0;
  wp.state.mag = mag;
  wp.state.chambered = chambered;
  wp.state.reserve = reserve;
  events.length = 0;
}
for (const [empty, shellin] of [
  [false, 0.451],
  [true, 0.646],
]) {
  for (const time of [0.2, shellin - 0.008, shellin + 0.008]) {
    setup(empty ? 0 : 2, !empty, 10);
    assert(wp.reload());
    step(Math.floor(time * 240));
    const committed = time > shellin;
    assert.equal(wp.state.reserve, committed ? 9 : 10, 'one reserve shell only at shellin');
    assert.equal(wp.state.mag + Number(wp.state.chambered), (empty ? 0 : 3) + (committed ? 1 : 0));
    if (!empty || committed) {
      assert(wp.tryFire(), 'tube reload interruption can fire a loaded shell');
      assert.equal(
        entry.animation.shellInsert.visible,
        false,
        'fire clears insert hull immediately'
      );
      step(120);
      assert.equal(
        events.filter((e) => e.name === 'weapon:shell').length,
        1,
        'exactly one genuine pump ejection'
      );
      const casing = events.find((e) => e.name === 'weapon:shell');
      assert.equal(casing.caseLen, 0.07);
      assert.equal(casing.caseRadius, 0.01105);
      assert.equal(casing.fxClass, 'shotgun', 'actual model identity reaches the casing pool');
      assert(Math.abs(casing.time - 0.144) < 1 / 240, 'one spent hull only at native pump event');
      assert(casing.velocity.toArray().every(Number.isFinite));
    } else {
      assert.equal(wp.tryFire(), false, 'empty reload cannot fire before shellin');
      vm.stopClip();
    }
    assert.equal(entry.animation.shellInsert.visible, false);
  }
  setup(empty ? 0 : 2, !empty, 10);
  assert(wp.reload());
  step(1100);
  assert.equal(wp.reloading, false);
  assert.equal(wp.state.mag, 6);
  assert.equal(wp.state.chambered, true);
  assert.equal(wp.state.reserve, empty ? 3 : 6, 'full 6+1 accounting');
  assert.equal(
    events.filter((e) => e.name === 'weapon:shell').length,
    0,
    'reload pump never invents a spent casing'
  );
}
setup(2, true, 10);
assert(wp.reload());
step(65);
assert(entry.animation.shellInsert.visible);
assert(wp.setWeapon('rifle'));
assert.equal(entry.animation.shellInsert.visible, false);
step(200);
assert.equal(wp.activeId, 'rifle');
assert.equal(entry.group.visible, false);
wp.activeId = 'shotgun';
vm.setActive('shotgun');
setup(2, true, 10);
wp.reload();
step(65);
wp._setDeathDisabled(true);
assert.equal(entry.animation.shellInsert.visible, false);
assert.equal(vm.anchor.visible, false);
wp.resetForNewGame();
assert.equal(vm.anchor.visible, true);
assert.equal(wp.activeId, 'rifle');
assert.equal(entry.animation.shellInsert.visible, false);
assert.equal(wp.states.get('shotgun').mag, 6);
entry.animation.update(0, 'reloadTac', 0.3);
vm.dispose();
assert.equal(entry.animation.shellInsert.visible, false);
assert.equal(entry.model.materials.size, 0);
console.log(
  'M590: immutable native asset, seven event-only clips, STEP visibility, authored hands/pump, per-shell complete/interrupted 6+1 reload, fire/ejection/switch/death/restart/disposal passed'
);
