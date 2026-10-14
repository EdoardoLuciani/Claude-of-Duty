/** Node smoke: deferred mounts must not sell ghosts. */
import assert from 'node:assert/strict';
import { WEAPON_IDS } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';

function makeWp() {
  const wp = new WeaponSystem();
  wp.viewmodel = {
    anchor: { visible: true },
    weapons: new Map(['rifle', 'pistol'].map((id) => [id, { id }])),
    addWeapon(record) {
      this.weapons.set(record.id, record);
      return { tris: 12 };
    },
    setActive(id) {
      this.active = id;
      return id;
    },
    play() {
      return 1;
    },
    stopClip() {},
    endGrenade() {},
    endRadio() {},
  };
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  for (const id of WEAPON_IDS) wp.states.set(id, wp._makeState(id));
  return wp;
}

{
  const wp = makeWp();
  assert.equal(wp.equipSecondary('smg'), false, 'unmounted MPX cannot be bought');
  assert(wp.owns('pistol') && !wp.owns('smg'));
  wp.viewmodel.weapons.set('smg', { id: 'smg' });
  assert.equal(wp.equipSecondary('smg'), true, 'mounted MPX replaces the pistol');
  assert(wp.owns('smg') && !wp.owns('pistol'));
}

{
  const wp = makeWp();
  let resolve;
  wp._restTask = wp._mountRest(
    ['lmg'],
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  let settled = false;
  wp._restTask.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false, 'deferred task remains pending until load completes');
  assert.equal(wp.equipPrimary('lmg'), false);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
  resolve({ id: 'lmg' });
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
  wp._restTask = wp._mountRest(['lmg'], async () => {
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
  wp.viewmodel.weapons.set('lmg', { id: 'lmg' });
  assert.equal(wp.equipPrimary('lmg'), true);
  assert(wp.owns('lmg') && !wp.owns('rifle'));
  assert.equal(wp.activeId, 'lmg');
}

{
  const wp = makeWp();
  wp.viewmodel.addWeapon = () => {
    throw new Error('mount failed');
  };
  wp._restTask = wp._mountRest(['lmg'], async () => ({ id: 'lmg' }));
  await assert.rejects(wp._restTask, /mount failed/, 'mount errors still reject the deferred task');
  assert.equal(wp.equipPrimary('lmg'), false);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
}

console.log('ok  smoke-weapons-defer');
