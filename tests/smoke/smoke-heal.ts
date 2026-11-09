/**
 * Bun smoke test for bandage healing — no browser.
 *
 * Replaces passive regen with hold-to-heal consumables. Covers the contract
 * in issue #287: no waiting refill, cancel preserves the item, completion
 * heals and consumes once, armour-only hits do not cancel, health damage does.
 *
 *   bun test ./tests/smoke/smoke-heal.ts
 */
import assert from 'node:assert/strict';

import { DEFAULT_BINDINGS } from '../../src/core/bindings.ts';
import type { EngineEventMap } from '../../src/core/events.ts';
import { Input } from '../../src/core/input.ts';
import { Rng } from '../../src/core/rng.ts';
import { Health } from '../../src/player/health.ts';
import type { PlayerSystem } from '../../src/player/index.ts';
import { HEALING, HEALTH } from '../../src/player/tuning.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { createTestContext } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';
import {
  initializePlayer,
  setPlayerMotion,
  presentationViewmodel,
  initializeWeaponStates,
  inertProjectileSim,
} from '../lib/player-fixture.ts';

let failures = 0;
const check = (name: string, cond: boolean): void => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
};

function makeHealth(): Health {
  return new Health(createTestContext(), null);
}

{
  const hp = makeHealth();
  hp.damage(45, null);
  check('damage lands on health', Math.abs(hp.value - 55) < 1e-6);
  for (let i = 0; i < 600; i++) {
    hp.ctx.time.elapsed += 1 / 60;
    hp.update(1 / 60);
  }
  check('waiting never restores health', Math.abs(hp.value - 55) < 1e-6);
  check('heal clamps at max and returns applied', hp.heal(80) === 45 && hp.value === 100);
  hp.dead = true;
  hp.value = 0;
  check('heal refuses a dead player', hp.heal(50) === 0 && hp.value === 0);
}

{
  const hp = makeHealth();
  hp.addArmour(50);
  hp.damage(20, null);
  check('armour-only hit leaves health full', hp.value === 100 && hp.armour === 35);
  const dealt = hp.damage(80, null);
  check('overflow reaches health', dealt === 25 && hp.value === 75);
}

class HealingWeapons extends WeaponSystem {
  begun = 0;
  ended = 0;
  progress = 0;
  busy = false;
  override beginHeal(): boolean {
    if (this.busy) return false;
    this.begun++;
    return true;
  }
  override endHeal(): void {
    this.ended++;
  }
  override setHealProgress(p: number): void {
    this.progress = p;
  }
}
type HealEvent = EngineEventMap['player:heal'] & { type: 'player:heal' };
function makePlayer(): {
  player: PlayerSystem;
  input: SemanticInput;
  weapons: HealingWeapons;
  events: HealEvent[];
} {
  const events: HealEvent[] = [];
  const input: SemanticInput = {
    frozen: false,
    enabled: true,
    fire: false,
    firePressed: false,
    ads: false,
    wheel: 0,
    _held: false,
    _healPressed: false,
    _actionsPressed: new Set<string>(),
    action(name): boolean {
      return name === 'heal' && this._held;
    },
    actionPressed(name): boolean {
      return (name === 'heal' && this._healPressed) || this._actionsPressed.has(name);
    },
  };
  const weapons = new HealingWeapons();
  const ctx = createTestContext({
    input: fixture<Input>(input, complete.createTestInput()),
    providers: { weapons },
  });
  ctx.camera.position.y = 1.6;
  ctx.events.on('player:heal', (p): void => {
    events.push({ type: 'player:heal', ...p });
  });
  const player = initializePlayer(ctx);
  return { player, input, weapons, events };
}
interface SemanticInput {
  frozen: boolean;
  enabled: boolean;
  fire: boolean;
  firePressed: boolean;
  ads: boolean;
  wheel: number;
  _held: boolean;
  _healPressed: boolean;
  _actionsPressed: Set<string>;
  action(name: string): boolean;
  actionPressed(name: string): boolean;
}

{
  const { player, input, weapons, events } = makePlayer();
  player.health.value = 40;
  input._healPressed = true;
  input._held = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  check('starts while injured with a bandage', player.healCtrl.active && weapons.begun === 1);
  player.healCtrl.update(1.5);
  check(
    'partial hold grants no health',
    player.health.value === 40 && player.healCtrl.bandages === 2
  );
  input._held = false;
  player.healCtrl.update(0);
  check(
    'release cancels without consuming',
    !player.healCtrl.active && player.healCtrl.bandages === 2 && player.health.value === 40
  );
  check(
    'cancel event fired',
    events.some((e): boolean => e.type === 'player:heal' && e.phase === 'cancel')
  );
  input._held = true;
  input._healPressed = false;
  player.healCtrl.update(0);
  check('holding after cancel does not restart', !player.healCtrl.active);
  input._healPressed = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  check(
    'fresh press restarts with no saved progress',
    player.healCtrl.active && player.healCtrl.progress === 0
  );
  player.healCtrl.update(HEALING.duration);
  check(
    'completion heals 50 and consumes one',
    player.health.value === 90 && player.healCtrl.bandages === 1
  );
  check(
    'completion is atomic',
    events.some(
      (e): boolean => e.type === 'player:heal' && e.phase === 'complete' && e.amount === 50
    )
  );
  check('weapon presentation ended on complete', weapons.ended >= 2);
  input._held = true;
  input._healPressed = false;
  player.healCtrl.update(0);
  check(
    'holding after complete does not spend another',
    player.healCtrl.bandages === 1 && !player.healCtrl.active
  );
}

{
  const { player, input } = makePlayer();
  player.health.value = 40;
  input._healPressed = true;
  input._held = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  player.healCtrl.elapsed = 2.99;
  player.healCtrl.progress = 2.99 / HEALING.duration;
  input.fire = true;
  input.firePressed = true;
  player.healCtrl.update(1 / 60);
  check(
    'final-frame fire cancels instead of completing',
    !player.healCtrl.active && player.health.value === 40 && player.healCtrl.bandages === 2
  );
}

// These requests are checked before weapons/UI run on the completion frame.
// The semantic-only fixture deliberately exposes no raw key query.
for (const request of [
  'reload',
  'inspect',
  'grenade',
  'radio',
  'pause',
  'slot1',
  'slot2',
  'cycleWeapon',
  'wheel-up',
  'wheel-down',
]) {
  const { player, input, events } = makePlayer();
  player.health.value = 40;
  input._healPressed = true;
  input._held = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  player.healCtrl.elapsed = HEALING.duration - 0.01;
  if (request.startsWith('wheel')) input.wheel = request === 'wheel-up' ? 1 : -1;
  else input._actionsPressed.add(request);
  player.healCtrl.update(1 / 60);
  check(
    `final-frame ${request} cancels without healing or spending`,
    !player.healCtrl.active &&
      player.health.value === 40 &&
      player.healCtrl.bandages === 2 &&
      events.at(-1)?.phase === 'cancel' &&
      events.at(-1)?.reason === 'interrupt'
  );
}

for (const guard of ['release', 'frozen', 'disabled', 'dead']) {
  const { player, input, events } = makePlayer();
  player.health.value = 40;
  input._healPressed = true;
  input._held = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  if (guard === 'release') input._held = false;
  if (guard === 'frozen') input.frozen = true;
  if (guard === 'disabled') input.enabled = false;
  if (guard === 'dead') player.health.dead = true;
  player.healCtrl.update(HEALING.duration);
  check(
    `final-frame ${guard} wins over completion`,
    !player.healCtrl.active &&
      player.health.value === 40 &&
      player.healCtrl.bandages === 2 &&
      events.at(-1)?.phase === 'cancel' &&
      events.at(-1)?.reason === (guard === 'release' ? 'release' : 'interrupt')
  );
}

for (const request of ['flashlight', 'use', 'slot3']) {
  const { player, input, events } = makePlayer();
  player.health.value = 40;
  input._healPressed = true;
  input._held = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  input._actionsPressed.add(request);
  player.healCtrl.update(HEALING.duration);
  check(
    `${request} does not interrupt completion`,
    player.health.value === 90 &&
      player.healCtrl.bandages === 1 &&
      events.at(-1)?.phase === 'complete'
  );
}

for (const motion of [
  'sprinting',
  'tacticalSprint',
  'sliding',
  'mantling',
  'airborne',
  'jumped',
] as const) {
  const { player, input, events } = makePlayer();
  player.health.value = 40;
  input._healPressed = true;
  input._held = true;
  if (motion === 'jumped') player.movement.jumped = true;
  else setPlayerMotion(player, motion, true);
  player.healCtrl.update(0);
  check(`${motion} prevents starting`, !player.healCtrl.active);
  if (motion === 'jumped') player.movement.jumped = false;
  else setPlayerMotion(player, motion, false);
  player.healCtrl.update(0);
  input._healPressed = false;
  if (motion === 'jumped') player.movement.jumped = true;
  else setPlayerMotion(player, motion, true);
  player.healCtrl.update(HEALING.duration);
  check(
    `${motion} wins over completion and preserves health/item`,
    !player.healCtrl.active &&
      player.health.value === 40 &&
      player.healCtrl.bandages === 2 &&
      events.at(-1)?.phase === 'cancel' &&
      events.at(-1)?.reason === 'move'
  );
}

{
  const { player, input } = makePlayer();
  player.health.value = 100;
  input._healPressed = true;
  input._held = true;
  player.healCtrl.update(0);
  check('full health cannot start', !player.healCtrl.active);
  player.health.value = 40;
  player.healCtrl.bandages = 0;
  player.healCtrl.update(0);
  check('empty inventory cannot start', !player.healCtrl.active);
  player.healCtrl.bandages = 2;
  player.health.dead = true;
  player.health.value = 0;
  player.healCtrl.update(0);
  check('dead player cannot start', !player.healCtrl.active);
}

{
  const { player, input, weapons } = makePlayer();
  player.health.value = 40;
  input._healPressed = true;
  input._held = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  setPlayerMotion(player, 'sprinting', true);
  player.healCtrl.update(0);
  check(
    'sprint cancels and keeps the bandage',
    !player.healCtrl.active && player.healCtrl.bandages === 2 && player.health.value === 40
  );
  setPlayerMotion(player, 'sprinting', false);
  input._healPressed = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  setPlayerMotion(player, 'airborne', true);
  player.healCtrl.update(0);
  check('jump/airborne cancels', !player.healCtrl.active);
  setPlayerMotion(player, 'airborne', false);
  input._healPressed = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  player.controlEnabled = false;
  player.healCtrl.update(0);
  check(
    'pause/shop interrupt cannot complete',
    !player.healCtrl.active && player.healCtrl.bandages === 2
  );
  check('weapon restored on interrupt', weapons.ended >= 3);
}

{
  const { player, input } = makePlayer();
  player.health.value = 40;
  input._healPressed = true;
  input._held = true;
  player.healCtrl.update(0);
  input._healPressed = false;
  player.healCtrl.update(1);
  const before = player.healCtrl.progress;
  player.health.addArmour(50);
  const dealtArmour = player.health.damage(20, null);
  if (dealtArmour > 0) player.healCtrl.cancel('damage');
  check(
    'armour-only hit does not cancel',
    player.healCtrl.active && player.healCtrl.progress === before
  );
  const dealt = player.health.damage(80, null);
  if (dealt > 0) player.healCtrl.cancel('damage');
  check(
    'health damage cancels',
    dealt > 0 && !player.healCtrl.active && player.healCtrl.bandages === 2
  );
}

{
  const { player } = makePlayer();
  check('starting loadout is 2', player.healCtrl.bandages === HEALING.startCount);
  check(
    'addBandages respects the carry limit',
    player.healCtrl.add(8) === 2 && player.healCtrl.bandages === 4
  );
  check('add at cap is zero', player.healCtrl.add(1) === 0);
  player.healCtrl.bandages = 1;
  player.healCtrl.reset();
  check(
    'reset restores the starting loadout',
    player.healCtrl.bandages === 2 && !player.healCtrl.active
  );
}

{
  const wp = new WeaponSystem();
  const input = new Input(complete.testElement('canvas'), {
    sensitivity: 0.002,
    invertY: false,
  });
  const ctx = createTestContext({ input });
  ctx.camera.position.y = 1.6;
  const player = initializePlayer(ctx);
  player.cancelHeal = (): boolean => {
    wp.endHeal();
    return true;
  };
  player.setAdsProgress = (): void => {};
  wp.ctx = ctx;
  wp.rng = new Rng(1);
  wp.sim = inertProjectileSim(ctx);
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  const vm = presentationViewmodel(ctx);
  wp.viewmodel = vm;
  wp.player = player;
  initializeWeaponStates(wp, {
    label: 'test',
    magSize: 30,
    reserve: 90,
    modes: ['auto'],
    rpm: 700,
  });
  wp.activeId = 'rifle';
  wp.owned = new Set(['rifle', 'smg', 'pistol']);

  check('idle weapons can begin heal', wp.canBeginHeal() === true);
  check('beginHeal stows the gun', wp.beginHeal() === true && wp.healing && vm._bandageState === 1);
  check('cannot overlap a second heal', wp.canBeginHeal() === false);
  check('fire blocked while healing', wp.canFire() === false);
  const rifle = wp.states.get('rifle');
  assert.ok(rifle);
  rifle.chambered = false;
  wp.tryFire();
  check('tryFire cancels healing', wp.healing === false);
  rifle.chambered = true;
  wp.beginHeal();
  wp.reload();
  check('reload cancels healing', wp.healing === false);
  wp.beginHeal();
  wp.inspect();
  check('inspect cancels healing', wp.healing === false);
  const s = rifle;
  s.mag = 10;
  s.reserve = 80;
  wp.viewmodel.play('reloadTac');
  check('cannot start during reload', wp.canBeginHeal() === false);
  wp.viewmodel.stopClip();
  wp.grenadeEquipped = true;
  check('cannot start during grenade', wp.canBeginHeal() === false);
  wp.grenadeEquipped = false;
  wp.radioEquipped = true;
  check('cannot start during radio', wp.canBeginHeal() === false);
  wp.radioEquipped = false;
  wp.endHeal();
}

{
  const input = new Input(complete.testElement('canvas'), {
    sensitivity: 0.002,
    invertY: false,
  });
  check(
    'radio and bandage controls are X and H',
    DEFAULT_BINDINGS.radio.includes('KeyX') && DEFAULT_BINDINGS.heal.includes('KeyH')
  );
  input.down.add('KeyH');
  check('H activates healing only', input.action('heal') && !input.action('radio'));
  input.down.delete('KeyH');
  input.down.add('KeyX');
  check('X activates the radio only', input.action('radio') && !input.action('heal'));
  input.down.clear();
  let n = 0;
  const ev = (code: string): KeyboardEvent =>
    fixture<KeyboardEvent>(
      {
        code,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        preventDefault(): void {
          n++;
        },
      },
      complete.testKeyboardEvent()
    );
  input.pointerLocked = false;
  input._gameplayFocus = false;
  n = 0;
  input._preventBrowserShortcut(ev('Tab'));
  check('unlocked Tab is not swallowed', n === 0);
  n = 0;
  input._preventBrowserShortcut(ev('Space'));
  check('unlocked Space is not swallowed', n === 0);
  input._gameplayFocus = true;
  n = 0;
  input._preventBrowserShortcut(ev('Tab'));
  check('gameplay Tab is swallowed', n === 1);
}

check(
  'tuning matches the playtest table',
  HEALING.amount === 50 &&
    HEALING.duration === 3 &&
    HEALING.startCount === 2 &&
    HEALING.maxCount === 4 &&
    HEALTH.max === 100
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
