import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PerspectiveCamera } from 'three';
import { ACTIONS, Input } from '../src/core/input.js';
import { HEALING } from '../src/player/tuning.js';
import { Health } from '../src/player/health.js';
import { HealController } from '../src/player/heal.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { UiSystem } from '../src/ui/index.js';

const noop = () => {};

// Real input/controller/weapons in engine update order; only presentation is inert.
function fixture(activeId = 'rifle') {
  const weapons = new WeaponSystem();
  const input = new Input({}, {});
  input.down.add('KeyH');
  const events = [];
  const ctx = {
    input, config: {}, time: { elapsed: 0, raw: 0, scale: 1 }, camera: new PerspectiveCamera(),
    events: { emit: (name, payload) => events.push({ name, ...payload }) },
    peek: id => id === 'weapons' ? weapons : id === 'player' ? player : null,
  };
  const player = {
    ctx, controlEnabled: true, health: new Health(ctx, null), movement: { jumped: false },
    horizontalSpeed: 0, stance: 'stand', state: 'stand', setAdsProgress: noop,
    get dead() { return this.health.dead; },
    cancelHeal: reason => player.healCtrl.cancel(reason),
  };
  player.healCtrl = new HealController(player);
  player.health.value = 40;
  weapons.ctx = ctx;
  weapons.player = player;
  weapons.sim = { stats: { live: 0, fired: 0 } };
  weapons.stats = {};
  weapons.viewmodel = {
    adsT: 0, stopClip() { this.clipName = null; }, play(name) { this.clipName = name; },
    holdBandage: noop, endBandage: noop, setBandageProgress: noop, holdGrenade: noop,
  };
  for (const id of ['rifle', 'pistol']) weapons.states.set(id, {
    def: { id, magSize: 30, reserve: 90, modes: ['semi'], spreadHip: 1, spreadAds: .1, spreadDecay: 1 },
    mag: 30, chambered: true, reserve: 90, mode: 'semi',
  });
  weapons.activeId = activeId;
  weapons.owned = new Set(['rifle', 'pistol']);
  assert.equal(player.healCtrl.tryStart(), true);
  return { weapons, player, input, ctx, events };
}

for (const request of ['Digit1', 'Digit2', 'Tab', 'wheel-up', 'wheel-down']) {
  for (const elapsed of [1, HEALING.duration - .01]) test(`${request} cancels at ${elapsed}s`, () => {
    const { weapons, player, input, ctx, events } = fixture(request === 'Digit1' ? 'pistol' : 'rifle');
    player.healCtrl.elapsed = elapsed;
    if (request.startsWith('wheel')) input.wheel = request === 'wheel-up' ? 1 : -1;
    else input._pressed.add(request);
    player.healCtrl.update(1 / 60);
    weapons.update(1 / 60, ctx);
    assert.deepEqual([player.health.value, player.healCtrl.bandages], [40, 2]);
    assert.equal(events.filter(e => e.name === 'player:heal').at(-1).phase, 'cancel');
    assert.equal(weapons._switchTo, request === 'Digit1' ? 'rifle' : 'pistol');
  });
}

for (const ending of ['release', 'complete', 'grenade']) test(`prompt ownership on ${ending}`, () => {
  const { weapons, player, input, ctx } = fixture();
  const ui = new UiSystem();
  ui.ctx = ctx;
  ui.state = { healing: true, bandages: 2, healProgress: .3 };
  ui._lastRaw = 0;
  ui.hudTarget = ui.hudVisible = 1;
  ui._blipCount = 0;
  ui._blipView = [];
  ui._objectives = [];
  ui._weaponState = () => null;
  ui._playerState = () => ({ healing: player.healCtrl.active });
  ui._playerPos = () => ({ x: 0, z: 0 });
  ui._collectBlips = ui._buildCompassObjectives = noop;
  for (const name of ['menu', 'gameOver', 'shop', 'crosshair', 'hit', 'arcs', 'health', 'ammo',
    'killfeed', 'scoreBar', 'banner', 'marketCountdown', 'radio', 'compass']) ui[name] = { update: noop };
  for (const name of ['chromeLayer', 'worldLayer', 'centreLayer']) ui[name] = { style: { setProperty: noop } };
  ui.markers = { updateObjectives: noop, updateGrenades: noop, updateDamage: noop };
  ui.minimap = { bakeDone: true, draw: noop };
  ui.prompt = { value: null, set(p) { this.value = p; }, clear() { this.value = null; }, update: noop };
  weapons.ui = ui;
  ui.lateUpdate(1 / 60, ctx);
  assert.equal(ui.prompt.value.text, 'BANDAGING');
  const bandageKey = ui.prompt.value.key;

  if (ending === 'release') input.down.delete('KeyH');
  else if (ending === 'complete') player.healCtrl.elapsed = HEALING.duration - .01;
  else input._pressed.add('KeyG');
  player.healCtrl.update(1 / 60);
  weapons.update(1 / 60, ctx);
  if (ending === 'grenade') assert.equal(ui.prompt.value.text, 'LONG THROW');
  ui.lateUpdate(1 / 60, ctx);
  input._pressed.clear();
  for (let i = 0; i < 60; i++) {
    weapons.update(1 / 60, ctx);
    ui.lateUpdate(1 / 60, ctx);
  }
  assert.equal(player.healCtrl.active, false);
  assert.deepEqual([player.health.value, player.healCtrl.bandages], ending === 'complete' ? [90, 1] : [40, 2]);
  if (ending === 'grenade') {
    assert.equal(weapons.grenadeEquipped, true);
    assert.equal(ui.prompt.value?.text, 'LONG THROW');
  } else assert.equal(ui.prompt.value, null);
  assert.equal(bandageKey, ACTIONS.heal[0].replace('Key', ''));
});

test('menu advertises the actual heal binding', () => {
  const menu = readFileSync(new URL('../src/ui/menu.js', import.meta.url), 'utf8');
  assert.ok(menu.includes(`${ACTIONS.heal[0].replace('Key', '')} BANDAGE`));
  assert.ok(!menu.includes('X BANDAGE'));
});
