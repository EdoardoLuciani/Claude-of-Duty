/**
 * Node smoke for deferred weapon mounts: missing meshes must not take
 * ownership after rest has settled, must not desync setWeapon, and must
 * not apply a stale _pendingEquip after a rebuy or restart.
 */
import assert from 'node:assert/strict';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';
import { WeaponSystem } from '../src/weapons/index.js';

function makeVm() {
  return {
    anchor: { visible: true },
    weapons: new Map([
      ['rifle', { id: 'rifle' }],
      ['smg', { id: 'smg' }],
      ['pistol', { id: 'pistol' }],
    ]),
    setActive(id) { this.active = id; return id; },
    play() { return 1; },
    stopClip() {},
    endGrenade() {},
    endRadio() {},
  };
}

function makeWp() {
  const wp = new WeaponSystem();
  wp.viewmodel = makeVm();
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  for (const id of WEAPON_IDS) {
    const def = { ...WEAPON_DEFS[id] };
    def.cycleTime = 60 / def.rpm;
    wp.states.set(id, {
      def,
      pattern: buildRecoilPattern(def, Rng),
      mag: def.magSize,
      chambered: true,
      reserve: def.reserve,
      mode: def.modes[0],
      modeIndex: 0,
    });
  }
  return wp;
}

{
  const wp = makeWp();
  wp._restDone = true;
  assert.equal(wp.equipPrimary('lmg'), false);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
  assert.equal(wp.activeId, 'rifle');
}

{
  const wp = makeWp();
  wp._restDone = false;
  assert.equal(wp.equipPrimary('lmg'), true);
  assert(wp.owns('lmg') && !wp.owns('rifle'));
  assert.equal(wp._pendingEquip, 'lmg');
  assert.equal(wp.activeId, 'rifle');
}

{
  const wp = makeWp();
  wp.owned.add('lmg');
  assert.equal(wp.setWeapon('lmg'), false);
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp._switchTo, null);
}

{
  const wp = makeWp();
  wp._restDone = false;
  wp.equipPrimary('lmg');
  wp.resetForNewGame();
  assert.equal(wp._pendingEquip, null);
  assert(wp.owns('rifle') && !wp.owns('lmg'));
}

{
  const wp = makeWp();
  wp._restDone = false;
  wp.equipPrimary('lmg');
  assert.equal(wp.equipPrimary('rifle'), true);
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp._pendingEquip, null);
}

{
  const wp = makeWp();
  wp._restDone = false;
  wp.equipPrimary('lmg');
  await wp._mountRest(['lmg'], async () => { throw new Error('nope'); });
  assert.equal(wp._pendingEquip, null);
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp.equipPrimary('lmg'), false);
}

console.log('ok  smoke-weapons-defer');
