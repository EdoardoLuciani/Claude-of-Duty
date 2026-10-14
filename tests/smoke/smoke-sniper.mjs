import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { setCaseScale } from '../../src/fx/shells.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { makeAX338Model, AX338Animation, AX338_URL } from '../../src/weapons/ax338.ts';
import { ProjectileSim } from '../../src/weapons/ballistics.ts';
import {
  WEAPON_DEFS,
  WEAPON_IDS,
  PRIMARY_IDS,
  buildRecoilPattern,
} from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';

assert(WEAPON_IDS.includes('sniper'));
assert.deepEqual(PRIMARY_IDS, ['rifle', 'lmg', 'sniper', 'mcx']);

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

const bytes = readFileSync(new URL(AX338_URL));
const loader = new GLTFLoader().register(() => ({
  name: 'SMOKE_TEXTURE',
  loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const model = makeAX338Model(
  await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  )
);
const animation = new AX338Animation(model);
assert.equal(model.id, 'sniper');
assert.equal(model.nodes.opticGlass.kind, 'scope');
assert.equal(model.shell.caseLen, 0.0697);
assert.equal(model.shell.rimR, 0.0074);
const lmgScale = setCaseScale({}, 0.051, 0.01195 / 2);
const sniperScale = setCaseScale({}, model.shell.caseLen, model.shell.rimR);
assert.notEqual(sniperScale.lengthScale, lmgScale.lengthScale);
assert.notEqual(sniperScale.radiusScale, lmgScale.radiusScale);

const clips = animation.clips();
assert(clips.cycle, 'bolt-action weapons expose a cycle clip');
assert.equal(clips.cycle.duration, def.boltTime);
// Native bolt/hand choreography is swept in smoke-ax338; the procedural
// additive-part/IK-weight channels no longer describe this authored model.

const scopedWeapon = { optic: { kind: 'scope' }, group: { visible: true } };
const scopeVm = {
  active: scopedWeapon,
  _grenadeState: 0,
  _radioState: 0,
  scopeOverlay: { visible: false },
  armL: { root: { visible: true } },
  armR: { root: { visible: true } },
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
  setActive(id) {
    this.active = id;
    return id;
  },
  play(name) {
    this.clip = { name, duration: 1 };
    this.clipName = name;
    this.clipT = 0;
    return 1;
  },
  stopClip() {
    this.clip = null;
    this.clipName = null;
    this.clipT = 0;
  },
  endGrenade() {},
  endRadio() {},
  muzzleWorld() {
    return { x: 0, y: 0, z: 0 };
  },
  addRecoil() {},
};

const wp = new WeaponSystem();
wp.ctx = {
  time: { elapsed: 0, scale: 1 },
  camera: {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    updateMatrixWorld() {},
  },
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

assert.deepEqual(wp.weaponIds, ['rifle', 'pistol']);
assert.equal(wp.equipPrimary('sniper'), true);
assert(wp.owns('sniper') && !wp.owns('rifle') && !wp.owns('lmg'));
assert.deepEqual(wp.weaponIds, ['sniper', 'pistol']);
assert.equal(wp.activeId, 'sniper');
assert.equal(wp.state.mag, 10);
assert.equal(wp.state.reserve, 30);
assert.equal(wp.equipPrimary('sniper'), false);
assert.equal(wp.equipPrimary('lmg'), true);
assert(wp.owns('lmg') && !wp.owns('sniper'));
wp.resetForNewGame();
assert.deepEqual(wp.weaponIds, ['rifle', 'pistol']);

wp.equipPrimary('sniper');
assert.equal(wp.tryFire(), true);
assert.equal(wp.state.chambered, false);
assert.equal(wp.state.mag, 10, 'bolt action does not strip the mag until chamber');
assert.equal(vm.clipName, 'cycle');
assert.equal(wp.tryFire(), false, 'blocked while the bolt is cycling');
assert.equal(wp.setWeapon('pistol'), false, 'blocked while the bolt is cycling');
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
const physics = new PhysicsSystem(),
  dealt = [];
const events = new EventBus();
events.on('shot:resolved', (e) => {
  resolved = { ...e, to: e.to.clone() };
});
events.on('damage:dealt', (e) =>
  dealt.push({ ...e, point: e.point.clone(), from: e.from.clone() })
);
physics.ctx = { events, time: { elapsed: 0 } };
const cover = physics.addCollider({ shape: 'box', surface: 'wood', hx: 0.025, hy: 1, hz: 1 });
cover.setMatrix(new THREE.Matrix4().makeTranslation(1, 0, 0));
const target = physics.addCollider({ owner: actor, part: 'torso', surface: 'flesh', radius: 0.1 });
target.setSegment(2, -0.5, 0, 2, 0.5, 0, 0.1);
const stop = physics.addCollider({ shape: 'box', surface: 'concrete', hx: 0.1, hy: 1, hz: 1 });
stop.setMatrix(new THREE.Matrix4().makeTranslation(3, 0, 0));
const sim = new ProjectileSim({ peek: () => physics, has: () => true, events });
sim.spawn({
  origin: new THREE.Vector3(),
  dir: new THREE.Vector3(1, 0, 0),
  speed: 100,
  damage: 20,
  penetration: 2,
  maxRange: 20,
  weapon: def,
});
for (let i = 0; i < 120 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
assert.equal(resolved.target, actor, 'telemetry resolves a penetrating actor hit');
assert.equal(resolved.part, 'torso');
assert.equal(dealt.length, 1);
assert.equal(resolved.damage, dealt[0].amount);
assert.ok(dealt[0].from.equals(new THREE.Vector3()), 'damage provenance remains at muzzle');
physics.dispose();

animation.dispose();
console.log('Sniper smoke checks passed');
