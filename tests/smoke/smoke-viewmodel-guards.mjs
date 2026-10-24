import assert from 'node:assert/strict';

import { Object3D } from 'three';

import { Viewmodel } from '../../src/weapons/viewmodel.ts';

// Retired procedural records must fail explicitly before mounting anything.
for (const body of [null, undefined]) {
  const vm = Object.create(Viewmodel.prototype);
  vm.rig = new Object3D();
  vm.mats = {};
  assert.throws(() => vm.addWeapon({ id: 'broken', body }, {}), /broken: missing authored weapon/);
  assert.equal(vm.rig.children.length, 0);
}

// The active weapon is checked at entry; use that snapshot throughout recoil.
const vm = Object.create(Viewmodel.prototype);
vm.addRecoil(0, 0); // no active weapon
const spring = () => ({ kick() {} });
Object.assign(vm, {
  adsT: 0,
  rng: { float: () => 0.5, signed: () => 0 },
  recPos: spring(),
  recRot: spring(),
  settle: { ...spring(), f: 1 },
});
for (const boltAction of [false, true]) {
  let authoredShots = 0;
  vm.active = {
    model: { reactiveFire: true },
    animation: {
      fire() {
        authoredShots++;
      },
    },
    def: {
      boltAction,
      recoil: { freq: 1, damping: 1, kickBack: 0, kickUp: 0, pitch: 0, yaw: 0, roll: 0 },
    },
  };
  let impulses = 0;
  vm.recPos.kick = vm.recRot.kick = () => impulses++;
  vm.addRecoil(0, 0);
  assert.equal(authoredShots, 1);
  assert.equal(impulses, 2, 'reactive recoil remains independent of the bolt mechanism');
}

// Teardown tolerates an absent radio and still releases instance-owned geometry.
for (const withRadio of [false, true]) {
  const owned = new Object3D();
  const mesh = new Object3D();
  mesh.isMesh = true;
  let geometryDisposals = 0;
  mesh.geometry = {
    dispose() {
      geometryDisposals++;
    },
  };
  owned.add(mesh);
  const parent = new Object3D();
  parent.add(owned);
  Object.assign(vm, {
    weapons: new Map(),
    armL: { dispose() {} },
    armR: { dispose() {} },
    radio: withRadio ? owned : null,
    _propMaterials: new Map(),
    _reticleGeo: [],
    anchor: new Object3D(),
  });
  vm.dispose();
  assert.equal(geometryDisposals, withRadio ? 1 : 0);
  assert.equal(owned.parent, withRadio ? null : parent);
}
console.log('viewmodel authored-model diagnostics, recoil and radio teardown guards passed');
