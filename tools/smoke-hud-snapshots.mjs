/**
 * Headless regressions for issue 286: HUD reads canonical getHudState()
 * snapshots and does not invent ammo/health when those systems are missing.
 *
 *   node tools/smoke-hud-snapshots.mjs
 */
import assert from 'node:assert/strict';
import { UiSystem } from '../src/ui/index.js';

function makeUi(systems = {}) {
  const ui = Object.create(UiSystem.prototype);
  ui.ctx = {
    peek(id) { return systems[id]; },
    camera: { position: { x: 0, y: 1.6, z: 0 } },
  };
  ui.state = {
    health: 100, maxHealth: 100, ammo: 30, reserve: 90, magSize: 30,
    simulate: false, move: 0, ads: false, regen: false, armour: 0,
  };
  ui._pos = { copy(p) { Object.assign(this, p); return this; } };
  ui._blips = Array.from({ length: 48 }, () => ({ x: 0, z: 0, kind: 'enemy', heading: 0, fade: 1 }));
  ui._blipCount = 0;
  ui.demo = null;
  ui.health = { onRegenStart() { ui._regenCue = true; } };
  return ui;
}

{
  const snap = { ammo: 17, name: 'M4A1' };
  const ui = makeUi({
    weapons: { hudState: { ammo: 1 }, getHudState() { return snap; } },
  });
  assert.equal(ui._weaponState(), snap, 'weapons.getHudState is the HUD contract');
}

{
  const ui = makeUi({ weapons: { hudState: { ammo: 1 } } });
  assert.equal(ui._weaponState(), null, 'hudState without getHudState is ignored');
}

{
  const snap = { health: 64, armour: 50, regen: true, move: 0.4 };
  const ui = makeUi({
    player: { health: 12, hudState: { health: 3 }, getHudState() { return snap; } },
  });
  assert.equal(ui._playerState(), snap, 'player.getHudState is the HUD contract');
  assert.equal(ui._playerState().health, 64, 'numeric player.health is not the snapshot');
}

{
  const ui = makeUi({ player: { health: 12, hudState: { health: 3 } } });
  assert.equal(ui._playerState(), null, 'missing getHudState leaves HUD defaults');
}

{
  const ui = makeUi({
    ai: {
      actors: [{ position: { x: 9, z: 9 }, alive: true }],
      getHudActors() {
        return [{ position: { x: 4, z: -2 }, hudX: 4, hudZ: -2, hudFade: 1, alive: true }];
      },
    },
  });
  ui._collectBlips();
  assert.equal(ui._blipCount, 1, 'blips come from getHudActors');
  assert.equal(ui._blips[0].x, 4);
  assert.equal(ui._blips[0].z, -2);
}

{
  const ui = makeUi({
    ai: { actors: [{ pos: { x: 9, z: 9 }, alive: true }] },
  });
  ui._collectBlips();
  assert.equal(ui._blipCount, 0, '.actors / .pos are not a HUD contract');
}

{
  const ui = makeUi({});
  const before = { ...ui.state };
  // Missing systems must not launch a second health/ammo simulation.
  assert.equal(ui._weaponState(), null);
  assert.equal(ui._playerState(), null);
  assert.equal(ui.state.health, before.health, 'defaults stay put without a player snapshot');
  assert.equal(ui.state.ammo, before.ammo, 'defaults stay put without a weapon snapshot');
  assert.equal(ui._regenCue, undefined, 'HUD does not start its own regen');
}

console.log('smoke-hud-snapshots: ok');
