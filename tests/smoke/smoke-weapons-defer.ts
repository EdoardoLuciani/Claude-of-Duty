/** Bun smoke: deferred mounts must not sell ghosts. */
import assert from 'node:assert/strict';

import { WEAPON_IDS } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import type { AuthoredWeaponModel, WeaponEntry } from '../../src/weapons/runtime-types.ts';
import type { Viewmodel } from '../../src/weapons/viewmodel.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';

function makeWp(): WeaponSystem {
  const wp = new WeaponSystem();
  const weapons = new Map<import('../../src/weapons/defs.ts').WeaponId, WeaponEntry>([
    ['rifle', fixture<WeaponEntry>({ id: 'rifle' }, complete.testWeaponEntry())],
    ['pistol', fixture<WeaponEntry>({ id: 'pistol' }, complete.testWeaponEntry())],
  ]);
  wp.viewmodel = fixture<Viewmodel>(
    {
      anchor: fixture<Viewmodel['anchor']>({ visible: true }, new complete.THREE.Object3D()),
      weapons,
      addWeapon(record): WeaponEntry {
        const entry = fixture<WeaponEntry>({ id: record.id, tris: 12 }, complete.testWeaponEntry());
        weapons.set(record.id, entry);
        return entry;
      },
      setActive(id): WeaponEntry | null {
        const entry = weapons.get(id) ?? null;
        this.active = entry;
        return entry;
      },
      play(): number {
        return 1;
      },
      stopClip(): void {},
      endGrenade(): void {},
      endRadio(): void {},
    },
    complete.testViewmodel()
  );
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  for (const id of WEAPON_IDS) wp.states.set(id, wp._makeState(id));
  return wp;
}

{
  const wp = makeWp();
  assert.equal(wp.equipSecondary('smg'), false, 'unmounted MPX cannot be bought');
  assert(wp.owns('pistol') && !wp.owns('smg'));
  wp.viewmodel.weapons.set('smg', fixture<WeaponEntry>({ id: 'smg' }, complete.testWeaponEntry()));
  assert.equal(wp.equipSecondary('smg'), true, 'mounted MPX replaces the pistol');
  assert(wp.owns('smg') && !wp.owns('pistol'));
}

{
  const wp = makeWp();
  let resolve: ((model: AuthoredWeaponModel) => void) | undefined;
  wp._restTask = wp._mountRest(
    ['lmg'],
    (): Promise<AuthoredWeaponModel> =>
      new Promise((done): void => {
        resolve = done;
      })
  );
  let settled = false;
  void wp._restTask.then((): void => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false, 'deferred task remains pending until load completes');
  assert.equal(wp.equipPrimary('lmg'), false);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
  assert(resolve);
  resolve(
    fixture<AuthoredWeaponModel & { then?: undefined }>({ id: 'lmg' }, complete.testWeaponModel())
  );
  await wp._restTask;
  assert.equal(settled, true);
  assert.equal(wp.stats.tris, 12);
  assert.equal(wp.equipPrimary('lmg'), true, 'resolved task has mounted the loaded weapon');
  assert(wp.owns('lmg') && !wp.owns('rifle'));
}

{
  const wp = makeWp();
  assert.equal(wp.equipPrimary('lmg'), false);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp.setWeapon('lmg'), false);
}

{
  const wp = makeWp();
  wp._restTask = wp._mountRest(['lmg'], async (): Promise<AuthoredWeaponModel> => {
    throw new Error('nope');
  });
  await wp._restTask; // Load failure still resolves the task; it must not sell a ghost.
  assert.equal(wp.viewmodel.weapons.has('lmg'), false);
  assert.equal(wp.stats.tris, 0);
  assert.equal(wp.equipPrimary('lmg'), false);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
  assert.equal(wp.activeId, 'rifle');
}

{
  const wp = makeWp();
  wp.viewmodel.weapons.set('lmg', fixture<WeaponEntry>({ id: 'lmg' }, complete.testWeaponEntry()));
  assert.equal(wp.equipPrimary('lmg'), true);
  assert(wp.owns('lmg') && !wp.owns('rifle'));
  assert.equal(wp.activeId, 'lmg');
}

{
  const wp = makeWp();
  wp.viewmodel.addWeapon = (): never => {
    throw new Error('mount failed');
  };
  wp._restTask = wp._mountRest(['lmg'], async (): Promise<AuthoredWeaponModel> =>
    fixture<AuthoredWeaponModel & { then?: undefined }>({ id: 'lmg' }, complete.testWeaponModel())
  );
  await assert.rejects(wp._restTask, /mount failed/, 'mount errors still reject the deferred task');
  assert.equal(wp.equipPrimary('lmg'), false);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
}

{
  const wp = makeWp();
  for (const id of ['unknown', '__proto__', 'constructor', 'toString']) {
    assert.equal(wp.setWeapon(id), false, 'debug/DOM strings must be validated');
    assert.equal(wp.setWeaponImmediate(id), false);
  }
  // Deliberately invalid JS inputs must bypass the static slot contract.
  assert.equal(
    Reflect.apply(wp.equipPrimary.bind(wp), wp, ['pistol']),
    false,
    'JS callers still get runtime slot validation'
  );
  assert.equal(Reflect.apply(wp.equipSecondary.bind(wp), wp, ['rifle']), false);
  assert.equal(wp.activeId, 'rifle');
  assert.deepEqual([...wp.owned], ['rifle', 'pistol']);
}

console.log('ok  smoke-weapons-defer');
