/** Node smoke: deferred mounts must not sell ghosts or apply a stale equip. */
import assert from 'node:assert/strict';
import { WEAPON_IDS } from '../src/weapons/defs.js';
import { WeaponSystem } from '../src/weapons/index.js';

function makeWp() {
  const wp = new WeaponSystem();
  wp.viewmodel = {
    anchor: { visible: true },
    weapons: new Map(['rifle', 'smg', 'pistol'].map((id) => [id, { id }])),
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
  wp._restDone = true;
  assert.equal(wp.equipPrimary('lmg'), false);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
}

{
  const wp = makeWp();
  assert.equal(wp.equipPrimary('lmg'), true);
  assert(wp.owns('lmg') && !wp.owns('rifle'));
  assert.equal(wp._pendingEquip, 'lmg');
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp.setWeapon('lmg'), false);
}

{
  const wp = makeWp();
  wp.equipPrimary('lmg');
  wp.resetForNewGame();
  assert.equal(wp._pendingEquip, null);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
}

{
  const wp = makeWp();
  wp.equipPrimary('lmg');
  assert.equal(wp.equipPrimary('rifle'), true);
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp._pendingEquip, null);
}

{
  const wp = makeWp();
  wp.equipPrimary('lmg');
  await wp._mountRest(['lmg'], async () => { throw new Error('nope'); });
  assert.equal(wp._pendingEquip, null);
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp.equipPrimary('lmg'), false);
}

console.log('ok  smoke-weapons-defer');
