/**
 * Node smoke test for bandage healing — no browser.
 *
 * Replaces passive regen with hold-to-heal consumables. Covers the contract
 * in issue #287: no waiting refill, cancel preserves the item, completion
 * heals and consumes once, armour-only hits do not cancel, health damage does.
 *
 *   node tools/smoke-heal.mjs
 */
import { Health } from '../src/player/health.js';
import { HealController } from '../src/player/heal.js';
import { HEALING, HEALTH } from '../src/player/tuning.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { WEAPON_IDS } from '../src/weapons/defs.js';
import { ACTIONS, Input } from '../src/core/input.js';
import { Rng } from '../src/core/rng.js';

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
};

function makeHealth() {
  const ctx = {
    time: { elapsed: 0 },
    camera: { rotation: { y: 0 }, position: { x: 0, y: 0, z: 0 } },
    events: { emit() {} },
  };
  return new Health(ctx, null);
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

function makePlayer() {
  const events = [];
  const input = {
    frozen: false,
    enabled: true,
    fire: false,
    firePressed: false,
    ads: false,
    _held: false,
    _pressed: false,
    action(name) { return name === 'heal' && this._held; },
    actionPressed(name) { return name === 'heal' && this._pressed; },
    pressed() { return false; },
  };
  const weapons = {
    begun: 0,
    ended: 0,
    progress: 0,
    busy: false,
    beginHeal() { if (this.busy) return false; this.begun++; return true; },
    endHeal() { this.ended++; },
    setHealProgress(p) { this.progress = p; },
  };
  const ctx = {
    time: { elapsed: 0, scale: 1 },
    input,
    events: {
      emit(type, p) { events.push({ type, phase: p?.phase, amount: p?.amount, reason: p?.reason, health: p?.health, bandages: p?.bandages }); },
      on() { return () => {}; },
    },
    peek(id) {
      if (id === 'weapons') return weapons;
      if (id === 'audio') return { playUi() {} };
      return null;
    },
    camera: { rotation: { y: 0 }, position: { x: 0, y: 1.6, z: 0 } },
  };
  const player = {
    ctx,
    controlEnabled: true,
    sprinting: false,
    tacticalSprint: false,
    sliding: false,
    mantling: false,
    airborne: false,
    movement: { jumped: false },
    health: new Health(ctx, null),
    get dead() { return this.health.dead; },
  };
  player.healCtrl = new HealController(player);
  return { player, input, weapons, events };
}

{
  const { player, input, weapons, events } = makePlayer();
  player.health.value = 40;
  input._pressed = true; input._held = true;
  player.healCtrl.update(0);
  input._pressed = false;
  check('starts while injured with a bandage', player.healCtrl.active && weapons.begun === 1);
  player.healCtrl.update(1.5);
  check('partial hold grants no health', player.health.value === 40 && player.healCtrl.bandages === 2);
  input._held = false;
  player.healCtrl.update(0);
  check('release cancels without consuming', !player.healCtrl.active && player.healCtrl.bandages === 2 && player.health.value === 40);
  check('cancel event fired', events.some((e) => e.type === 'player:heal' && e.phase === 'cancel'));
  input._held = true; input._pressed = false;
  player.healCtrl.update(0);
  check('holding after cancel does not restart', !player.healCtrl.active);
  input._pressed = true;
  player.healCtrl.update(0);
  input._pressed = false;
  check('fresh press restarts with no saved progress', player.healCtrl.active && player.healCtrl.progress === 0);
  player.healCtrl.update(HEALING.duration);
  check('completion heals 50 and consumes one', player.health.value === 90 && player.healCtrl.bandages === 1);
  check('completion is atomic', events.some((e) => e.type === 'player:heal' && e.phase === 'complete' && e.amount === 50));
  check('weapon presentation ended on complete', weapons.ended >= 2);
  input._held = true; input._pressed = false;
  player.healCtrl.update(0);
  check('holding after complete does not spend another', player.healCtrl.bandages === 1 && !player.healCtrl.active);
}

{
  const { player, input } = makePlayer();
  player.health.value = 40;
  input._pressed = true; input._held = true;
  player.healCtrl.update(0);
  input._pressed = false;
  player.healCtrl.elapsed = 2.99;
  player.healCtrl.progress = 2.99 / HEALING.duration;
  input.fire = true;
  input.firePressed = true;
  player.healCtrl.update(1 / 60);
  check('final-frame fire cancels instead of completing',
    !player.healCtrl.active && player.health.value === 40 && player.healCtrl.bandages === 2);
}

{
  const { player, input } = makePlayer();
  player.health.value = 100;
  input._pressed = true; input._held = true;
  player.healCtrl.update(0);
  check('full health cannot start', !player.healCtrl.active);
  player.health.value = 40;
  player.healCtrl.bandages = 0;
  player.healCtrl.update(0);
  check('empty inventory cannot start', !player.healCtrl.active);
  player.healCtrl.bandages = 2;
  player.health.dead = true; player.health.value = 0;
  player.healCtrl.update(0);
  check('dead player cannot start', !player.healCtrl.active);
}

{
  const { player, input, weapons } = makePlayer();
  player.health.value = 40;
  input._pressed = true; input._held = true;
  player.healCtrl.update(0);
  input._pressed = false;
  player.sprinting = true;
  player.healCtrl.update(0);
  check('sprint cancels and keeps the bandage', !player.healCtrl.active && player.healCtrl.bandages === 2 && player.health.value === 40);
  player.sprinting = false;
  input._pressed = true;
  player.healCtrl.update(0);
  input._pressed = false;
  player.airborne = true;
  player.healCtrl.update(0);
  check('jump/airborne cancels', !player.healCtrl.active);
  player.airborne = false;
  input._pressed = true;
  player.healCtrl.update(0);
  input._pressed = false;
  player.controlEnabled = false;
  player.healCtrl.update(0);
  check('pause/shop interrupt cannot complete', !player.healCtrl.active && player.healCtrl.bandages === 2);
  check('weapon restored on interrupt', weapons.ended >= 3);
}

{
  const { player, input } = makePlayer();
  player.health.value = 40;
  input._pressed = true; input._held = true;
  player.healCtrl.update(0);
  input._pressed = false;
  player.healCtrl.update(1);
  const before = player.healCtrl.progress;
  player.health.addArmour(50);
  const dealtArmour = player.health.damage(20, null);
  if (dealtArmour > 0) player.healCtrl.cancel('damage');
  check('armour-only hit does not cancel', player.healCtrl.active && player.healCtrl.progress === before);
  const dealt = player.health.damage(80, null);
  if (dealt > 0) player.healCtrl.cancel('damage');
  check('health damage cancels', dealt > 0 && !player.healCtrl.active && player.healCtrl.bandages === 2);
}

{
  const { player } = makePlayer();
  check('starting loadout is 2', player.healCtrl.bandages === HEALING.startCount);
  check('addBandages respects the carry limit', player.healCtrl.add(8) === 2 && player.healCtrl.bandages === 4);
  check('add at cap is zero', player.healCtrl.add(1) === 0);
  player.healCtrl.bandages = 1;
  player.healCtrl.reset();
  check('reset restores the starting loadout', player.healCtrl.bandages === 2 && !player.healCtrl.active);
}

{
  const vm = {
    anchor: { visible: true }, clip: null, clipName: null, clipT: 0, boltHold: 0, adsT: 0, adsTarget: 0,
    play(name) { this.clipName = name; this.clip = { name, duration: 1 }; },
    stopClip() { this.clip = null; this.clipName = null; },
    holdGrenade() {}, endGrenade() {}, holdRadio() {}, endRadio() {},
    holdBandage() { this._bandage = 1; },
    endBandage() { this._bandage = 0; },
    setBandageProgress(p) { this._bp = p; },
    setActive() {}, addRecoil() {}, muzzleWorld() { return { x: 0, y: 0, z: 0 }; },
  };
  const input = {
    fire: false, firePressed: false, wheel: 0, frozen: false, enabled: true, ads: false,
    actionPressed() { return false; },
    pressed() { return false; },
    held() { return false; },
  };
  const player = {
    dead: false, controlEnabled: true, sprinting: false, stance: 'stand', airborne: false,
    state: 'stand', horizontalSpeed: 0, adsRequested: false, cancelHeal() { wp.endHeal(); },
    setAdsProgress() {},
  };
  const wp = new WeaponSystem();
  wp.ctx = {
    time: { elapsed: 0, scale: 1 },
    camera: { position: { x: 0, y: 1.6, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, updateMatrixWorld() {} },
    scene: { add() {} },
    events: { emit() {} },
    peek(id) { return id === 'player' ? player : undefined; },
    input,
  };
  wp.rng = new Rng(1);
  wp.sim = { spawn() {}, clear() {}, stats: { live: 0, fired: 0 } };
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  wp.viewmodel = vm;
  wp.player = player;
  for (const id of WEAPON_IDS) {
    wp.states.set(id, {
      def: { id, label: id, magSize: 30, reserve: 90, modes: ['auto'], rpm: 700, recoil: { patternLength: 1 } },
      mag: 30, chambered: true, reserve: 90, mode: 'auto', modeIndex: 0,
    });
  }
  wp.activeId = 'rifle';
  wp.owned = new Set(['rifle', 'pistol']);

  check('idle weapons can begin heal', wp.canBeginHeal() === true);
  check('beginHeal stows the gun', wp.beginHeal() === true && wp.healing && vm._bandage === 1);
  check('cannot overlap a second heal', wp.canBeginHeal() === false);
  check('fire blocked while healing', wp.canFire() === false);
  wp.states.get('rifle').chambered = false;
  wp.tryFire();
  check('tryFire cancels healing', wp.healing === false);
  wp.states.get('rifle').chambered = true;
  wp.beginHeal();
  wp.reload();
  check('reload cancels healing', wp.healing === false);
  wp.beginHeal();
  wp.inspect();
  check('inspect cancels healing', wp.healing === false);
  const s = wp.states.get('rifle');
  s.mag = 10; s.reserve = 80;
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
  const input = new Input({}, { sensitivity: 0.002 });
  check('weapon number row contains only slots 1 and 2',
    ACTIONS.swapWeapon.includes('Digit1') && ACTIONS.swapWeapon.includes('Digit2') && !ACTIONS.swapWeapon.includes('Digit3'));
  check('radio and bandage controls are X and H',
    ACTIONS.radio.includes('KeyX') && ACTIONS.heal.includes('KeyH'));
  input.down.add('KeyH');
  check('H activates healing only', input.action('heal') && !input.action('radio'));
  input.down.delete('KeyH');
  input.down.add('KeyX');
  check('X activates the radio only', input.action('radio') && !input.action('heal'));
  input.down.clear();
  let n = 0;
  const ev = (code) => ({
    code, ctrlKey: false, metaKey: false, altKey: false, preventDefault() { n++; },
  });
  input.pointerLocked = false;
  input._gameplayFocus = false;
  n = 0; input._preventBrowserShortcut(ev('Tab'), true);
  check('unlocked Tab is not swallowed', n === 0);
  n = 0; input._preventBrowserShortcut(ev('Space'), true);
  check('unlocked Space is not swallowed', n === 0);
  input._gameplayFocus = true;
  n = 0; input._preventBrowserShortcut(ev('Tab'), true);
  check('gameplay Tab is swallowed', n === 1);
}

check('tuning matches the playtest table',
  HEALING.amount === 50 && HEALING.duration === 3 && HEALING.startCount === 2 &&
  HEALING.maxCount === 4 && HEALTH.max === 100);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
