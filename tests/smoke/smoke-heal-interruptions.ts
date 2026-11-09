import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { Vector3 } from 'three';

import { bindingLabels, bindingLabel } from '../../src/core/bindings.ts';
import type { EngineContext } from '../../src/core/context.ts';
import type { EngineEventMap } from '../../src/core/events.ts';
import { Input } from '../../src/core/input.ts';
import type { PlayerSystem } from '../../src/player/index.ts';
import { HEALING } from '../../src/player/tuning.ts';
import { AmmoPanel } from '../../src/ui/ammo.ts';
import { Compass, ScoreBar } from '../../src/ui/compass.ts';
import { CONTROL_SECTIONS } from '../../src/ui/controls.ts';
import { Crosshair } from '../../src/ui/crosshair.ts';
import { DamageArcs } from '../../src/ui/damage.ts';
import { HealthFx } from '../../src/ui/health.ts';
import { Hitmarkers } from '../../src/ui/hitmarkers.ts';
import { UiSystem } from '../../src/ui/index.ts';
import { Killfeed } from '../../src/ui/killfeed.ts';
import { MarketCountdown } from '../../src/ui/market.ts';
import { Minimap } from '../../src/ui/minimap.ts';
import { Prompt, Banner } from '../../src/ui/prompts.ts';
import type { WeaponId } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { createTestContext, createTestInput } from '../lib/context.ts';
import type { TestProviders } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture as partialFixture } from '../lib/fixture.ts';
import {
  initializePlayer,
  setPlayerMotion,
  presentationViewmodel,
  initializeWeaponStates,
  inertProjectileSim,
} from '../lib/player-fixture.ts';

const noop = (): void => {};

// Real input/controller/weapons in engine update order; only presentation is inert.
type HealEvent = EngineEventMap['player:heal'] & { name: 'player:heal' };
interface HealFixture {
  weapons: WeaponSystem;
  player: PlayerSystem;
  input: Input;
  ctx: EngineContext;
  events: HealEvent[];
}
function fixture(activeId: WeaponId = 'rifle'): HealFixture {
  const weapons = new WeaponSystem();
  const input = createTestInput();
  input.down.add('KeyH');
  const events: HealEvent[] = [];
  const providers: TestProviders = { weapons };
  const ctx = createTestContext({ input, providers });
  const player = initializePlayer(ctx);
  providers.player = player;
  player.setAdsProgress = noop;
  player.health.value = 40;
  ctx.events.on('player:heal', (payload): void => {
    events.push({ name: 'player:heal', ...payload });
  });
  weapons.ctx = ctx;
  weapons.player = player;
  weapons.sim = inertProjectileSim(ctx);
  weapons.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  weapons.viewmodel = presentationViewmodel(ctx);
  initializeWeaponStates(weapons, {
    magSize: 30,
    reserve: 90,
    modes: ['semi'],
    spreadHip: 1,
    spreadAds: 0.1,
    spreadDecay: 1,
  });
  weapons.activeId = activeId;
  weapons.owned = new Set(['rifle', 'pistol']);
  assert.equal(player.healCtrl.tryStart(), true);
  return { weapons, player, input, ctx, events };
}

class RecordingPrompt extends Prompt {
  value: Parameters<Prompt['set']>[0] | null = null;
  override set(p: Parameters<Prompt['set']>[0]): void {
    super.set(p);
    this.value = p;
  }
  override clear(): void {
    super.clear();
    this.value = null;
  }
  override update(): void {}
}

for (const request of ['Digit1', 'Digit2', 'Tab', 'wheel-up', 'wheel-down']) {
  for (const elapsed of [1, HEALING.duration - 0.01])
    test(`${request} cancels at ${elapsed}s`, (): void => {
      const { weapons, player, input, ctx, events } = fixture(
        request === 'Digit1' ? 'pistol' : 'rifle'
      );
      player.healCtrl.elapsed = elapsed;
      if (request.startsWith('wheel')) input.wheel = request === 'wheel-up' ? 1 : -1;
      else input._pressed.add(request);
      player.healCtrl.update(1 / 60);
      weapons.update(1 / 60, ctx);
      assert.deepEqual([player.health.value, player.healCtrl.bandages], [40, 2]);
      assert.equal(events.filter((e): boolean => e.name === 'player:heal').at(-1)?.phase, 'cancel');
      assert.equal(weapons._switchTo, request === 'Digit1' ? 'rifle' : 'pistol');
    });
}

for (const ending of ['release', 'complete', 'grenade'])
  test(`prompt ownership on ${ending}`, (): void => {
    const { weapons, player, input, ctx } = fixture();
    const ui = new UiSystem();
    ui.ctx = ctx;
    ui.fpsText = '— FPS';
    ui.state = partialFixture<UiSystem['state']>(
      {
        healing: true,
        bandages: 2,
        healProgress: 0.3,
        marketIn: 0,
      },
      new UiSystem().state
    );
    ui._lastRaw = 0;
    ui.hudTarget = ui.hudVisible = 1;
    ui._blipCount = 0;
    ui._blipView = [];
    player.getHudState = (): ReturnType<PlayerSystem['getHudState']> => ({
      health: player.health.value,
      maxHealth: player.health.max,
      dead: false,
      maxArmour: player.health.maxArmour,
      suppression: 0,
      position: player.position,
      armour: player.health.armour,
      bandages: player.healCtrl.bandages,
      healing: player.healCtrl.active,
      healProgress: player.healCtrl.active ? 0.3 : 0,
      hurt: 0,
      pulse: 0,
      move: 0,
      sprint: false,
      crouch: false,
      ads: false,
      airborne: false,
    });
    ui._playerPos = (): Vector3 => new Vector3();
    ui._collectBlips = noop;
    ui.menu = partialFixture<UiSystem['menu']>(
      { open: false, update: noop },
      complete.testPauseMenu()
    );
    ui.gameOver = partialFixture<UiSystem['gameOver']>({ update: noop }, complete.testGameOver());
    ui.shop = partialFixture<UiSystem['shop']>({ update: noop }, complete.testMarketOverlay());
    ui.radio = partialFixture<UiSystem['radio']>({ update: noop }, complete.testRadioPanel());
    ui.crosshair = new Crosshair();
    ui.hit = new Hitmarkers();
    ui.arcs = new DamageArcs();
    ui.health = new HealthFx();
    ui.ammo = new AmmoPanel();
    ui.killfeed = new Killfeed();
    ui.scoreBar = new ScoreBar();
    ui.banner = new Banner();
    ui.marketCountdown = new MarketCountdown(0);
    ui.compass = new Compass();
    ui.crosshair.update =
      ui.hit.update =
      ui.arcs.update =
      ui.health.update =
      ui.ammo.update =
      ui.killfeed.update =
      ui.scoreBar.update =
      ui.banner.update =
      ui.marketCountdown.update =
      ui.compass.update =
        noop;
    for (const name of ['chromeLayer', 'centreLayer'] as const)
      ui[name] = partialFixture<HTMLElement & { _ows: Map<string, string> }>(
        {
          _ows: new Map(),
          style: partialFixture<CSSStyleDeclaration>({ setProperty: noop }, complete.testStyle()),
        },
        Object.assign(complete.testElement('div'), { _ows: new Map<string, string>() })
      );
    ui.minimap = new Minimap(ctx.rng);
    ui.minimap.bakeDone = true;
    const prompt = new RecordingPrompt();
    ui.prompt = prompt;
    weapons.ui = ui;
    ui.lateUpdate(1 / 60, ctx);
    assert.ok(prompt.value);
    assert.equal(prompt.value.text, 'BANDAGING');
    const bandageKey = prompt.value.key;

    if (ending === 'release') input.down.delete('KeyH');
    else if (ending === 'complete') player.healCtrl.elapsed = HEALING.duration - 0.01;
    else input._pressed.add('KeyG');
    player.healCtrl.update(1 / 60);
    weapons.update(1 / 60, ctx);
    if (ending === 'grenade') assert.equal(prompt.value?.text, 'LONG THROW');
    ui.lateUpdate(1 / 60, ctx);
    input._pressed.clear();
    for (let i = 0; i < 60; i++) {
      weapons.update(1 / 60, ctx);
      ui.lateUpdate(1 / 60, ctx);
    }
    assert.equal(player.healCtrl.active, false);
    assert.deepEqual(
      [player.health.value, player.healCtrl.bandages],
      ending === 'complete' ? [90, 1] : [40, 2]
    );
    if (ending === 'grenade') {
      assert.equal(weapons.grenadeEquipped, true);
      assert.equal(prompt.value?.text, 'LONG THROW');
    } else assert.equal(prompt.value, null);
    assert.equal(bandageKey, bindingLabel('heal'));
  });

test('bandaging continues and completes while walking', (): void => {
  const { weapons, player, input, ctx, events } = fixture();
  input.down.add('KeyW');
  player.movement.horizontalSpeed = 3;
  for (const motion of ['sprinting', 'tacticalSprint', 'sliding', 'mantling', 'airborne'] as const)
    setPlayerMotion(player, motion, false);
  for (let second = 1; second <= HEALING.duration; second++) {
    player.healCtrl.update(1);
    weapons.update(1, ctx);
    if (second < HEALING.duration) {
      assert.equal(player.healCtrl.active, true);
      assert.equal(player.healCtrl.progress, second / HEALING.duration);
      assert.deepEqual([player.health.value, player.healCtrl.bandages], [40, 2]);
    }
  }
  assert.equal(player.healCtrl.active, false);
  assert.deepEqual([player.health.value, player.healCtrl.bandages], [90, 1]);
  assert.deepEqual(
    events.filter((e): boolean => e.name === 'player:heal').map((e): string => e.phase),
    ['start', 'complete']
  );
});

for (const motion of [
  'sprinting',
  'tacticalSprint',
  'sliding',
  'mantling',
  'airborne',
  'jumped',
] as const) {
  test(`bandage reference movement cancellation: ${motion}`, (): void => {
    const { player, events } = fixture();
    if (motion === 'jumped') player.movement.jumped = true;
    else setPlayerMotion(player, motion, true);
    player.healCtrl.update(1);
    assert.equal(player.healCtrl.active, false);
    assert.deepEqual([player.health.value, player.healCtrl.bandages], [40, 2]);
    assert.equal(events.filter((e): boolean => e.name === 'player:heal').at(-1)?.reason, 'move');
  });
}

test('menu advertises the actual heal binding', (): void => {
  const bandage = CONTROL_SECTIONS.flatMap(
    (section): (typeof section.controls)[number][] => section.controls
  ).find((control): boolean => control.description.startsWith('Bandage ('));
  assert.ok(bandage);
  assert.deepEqual(bandage.keys, bindingLabels('heal'));
  assert.ok(!bandage.keys.includes(bindingLabel('radio')));
  assert.equal(bandage.description, `Bandage (hold ${HEALING.duration}s)`);
});
