/** Node smoke: deferred mounts must not sell ghosts. */
import assert from 'node:assert/strict';
import { WEAPON_IDS } from '../src/weapons/defs.js';
import { WeaponSystem } from '../src/weapons/index.js';

function makeWp() {
  const wp = new WeaponSystem();
  wp.viewmodel = {
    anchor: { visible: true },
    weapons: new Map(['rifle', 'pistol'].map((id) => [id, { id }])),
    setActive(id) { this.active = id; return id; },
    play() { return 1; },
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
  wp._restDone = true;
  assert.equal(wp.equipPrimary('lmg'), false);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
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
  await wp._mountRest(['lmg'], async () => { throw new Error('nope'); });
  assert.equal(wp._restDone, true);
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

console.log('ok  smoke-weapons-defer');
