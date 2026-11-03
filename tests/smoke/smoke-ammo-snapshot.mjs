import assert from 'node:assert/strict';

import { WeaponSystem } from '../../src/weapons/index.ts';

const weapons = new WeaponSystem();
const empty = {
  mag: 0,
  inMag: 0,
  chambered: false,
  reserve: 0,
  magSize: 0,
  total: 0,
  empty: true,
};
assert.deepEqual(weapons.ammo, empty, 'uninitialized inventory has a complete empty snapshot');
const state = weapons._makeState('rifle');
weapons.states.set('rifle', state);
for (const chambered of [false, true]) {
  for (const mag of [0, 3]) {
    state.mag = mag;
    state.chambered = chambered;
    state.reserve = 20;
    const snapshot = weapons.ammo;
    assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(empty).sort());
    assert.deepEqual(snapshot, {
      mag: mag + Number(chambered),
      inMag: mag,
      chambered,
      reserve: 20,
      magSize: state.def.magSize,
      total: mag + Number(chambered) + 20,
      empty: mag === 0 && !chambered,
    });
  }
}
weapons.states.clear();
assert.deepEqual(weapons.ammo, empty, 'missing active state preserves the snapshot shape');
console.log('Ammo snapshots share one complete shape with unchanged round accounting.');
