// Weapon-owned canonical input contexts; real Input snapshots, no DOM/GPU.
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { bindingLabel } from '../../src/core/bindings.ts';
import { Input } from '../../src/core/input.ts';
import { Rng } from '../../src/core/rng.ts';
import { AmmoPickups } from '../../src/weapons/ammo-pickups.ts';
import { WEAPON_IDS } from '../../src/weapons/defs.ts';
import { WeaponSystem, GRENADE_FUSE } from '../../src/weapons/index.ts';

function makeHarness() {
  const input = new Input({}, { sensitivity: 1, invertY: false });
  input._pollGamepad = () => {};
  for (const method of ['pressed', 'held', 'released']) {
    input[method] = () => {
      throw new Error(`weapons must not query raw ${method}`);
    };
  }
  const wp = new WeaponSystem();
  const clips = [],
    prompts = [],
    cancellations = [],
    bodies = [];
  const player = {
    dead: false,
    controlEnabled: true,
    stance: 'stand',
    state: 'idle',
    horizontalSpeed: 0,
    eyePosition: new THREE.Vector3(0, 1.6, 0),
    feetPosition: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, -1),
    velocity: new THREE.Vector3(),
    setAdsProgress() {},
    cancelHeal(reason) {
      cancellations.push(reason);
      wp.endHeal();
    },
  };
  wp.player = player;
  wp.ui = {
    setPrompt(prompt, owner) {
      prompts.push({ ...prompt, owner });
    },
    clearPrompt() {},
  };
  wp.ctx = {
    input,
    time: { elapsed: 0, scale: 1 },
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    events: { emit() {} },
    peek(id) {
      return id === 'player' ? player : id === 'ui' ? wp.ui : null;
    },
  };
  wp.rng = new Rng(372);
  // A projectile spawn is the only per-pellet side effect of an accepted shot,
  // so counting them measures real trigger output. `update()` copies
  // `sim.stats.fired` back into `wp.stats.fired` every frame.
  const shots = { live: 0, fired: 0 };
  wp.sim = {
    spawn() {
      shots.fired++;
    },
    clear() {},
    stats: shots,
  };
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  wp.physics = {
    addRigidBody(options) {
      bodies.push(options);
      return { position: new THREE.Vector3() };
    },
  };
  wp.viewmodel = {
    anchor: { visible: true },
    clip: null,
    clipName: null,
    adsT: 0,
    setActive() {},
    stopClip() {
      this.clip = null;
      this.clipName = null;
    },
    play(name) {
      this.clip = { duration: 1 };
      this.clipName = name;
      clips.push(name);
    },
    holdGrenade() {},
    cookGrenade() {},
    throwGrenade() {},
    endGrenade() {},
    holdRadio() {},
    endRadio() {},
    setRadioScreen() {},
    holdBandage() {},
    endBandage() {},
    addRecoil() {},
    muzzleWorld() {
      return { x: 0, y: 0, z: 0 };
    },
  };
  for (const id of WEAPON_IDS) wp.states.set(id, wp._makeState(id));
  const frame = ({ down = [], up = [], wheel = 0, dt = 1 / 60 } = {}) => {
    for (const code of down) input._pendingDown.add(code);
    for (const code of up) input._pendingUp.add(code);
    input._pendingWheel = wheel;
    input.beginFrame();
    wp.update(dt, wp.ctx);
    input.endFrame();
  };
  const tap = (...codes) => frame({ down: codes, up: codes });
  return { wp, input, frame, tap, clips, prompts, cancellations, bodies, player, shots };
}

// Same-frame operations retain their order, independent of physical event order.
{
  const { wp, frame } = makeHarness();
  const order = [];
  for (const method of [
    'reload',
    'cycleFireMode',
    'inspect',
    'nextWeapon',
    '_runTrigger',
    '_updateGrenade',
    '_updateRadio',
  ]) {
    wp[method] = () => {
      order.push(method);
    };
  }
  wp.setWeapon = (id) => {
    order.push(`slot:${id}`);
  };
  frame({
    down: ['KeyX', 'KeyG', 'Mouse0', 'Tab', 'Digit2', 'Digit1', 'KeyI', 'KeyB', 'KeyR'],
    wheel: -1,
  });
  assert.deepEqual(order, [
    'reload',
    'cycleFireMode',
    'inspect',
    'slot:rifle',
    'slot:pistol',
    'nextWeapon',
    'nextWeapon',
    '_runTrigger',
    '_updateGrenade',
    '_updateRadio',
  ]);
}

// Tab and wheel remain two requests (a pending holster can refuse the second).
for (const wheel of [-1, 1]) {
  const { wp, frame } = makeHarness();
  const next = wp.nextWeapon.bind(wp);
  const results = [];
  wp.nextWeapon = () => {
    const result = next();
    results.push(result);
    return result;
  };
  frame({ down: ['Tab'], wheel });
  assert.deepEqual(
    results,
    [true, false],
    'both cycle requests run, with existing switching guard'
  );
  assert.equal(wp._switchTo, 'pistol');
  frame();
  assert.equal(results.length, 2, 'held Tab and expired wheel do not repeat');
}

// Slot 3 is inert normally; same-slot selection cannot stow a grenade.
{
  const { wp, tap } = makeHarness();
  tap('Digit3');
  assert.equal(wp._switchTo, null);
  tap('KeyG');
  tap('Digit1');
  assert(wp.grenadeEquipped, 'same-slot selection is a no-op, not a stow');
  tap('Digit2');
  assert(!wp.grenadeEquipped);
  assert.equal(wp._switchTo, 'pistol');
}

// Fire mode remains active on the underlying gun even with an accessory out.
for (const accessory of ['KeyG', 'KeyX']) {
  const { wp, tap, clips } = makeHarness();
  tap(accessory);
  const before = wp.fireMode;
  tap('KeyB');
  assert.notEqual(wp.fireMode, before);
  tap('KeyI', 'KeyR');
  assert(
    !clips.includes('inspect') && !clips.includes('reloadTac'),
    'busy hands block inspect/reload'
  );
  assert(!wp.canFire());
}
{
  const { wp, tap, clips } = makeHarness();
  tap('KeyI');
  assert(wp.inspecting && clips.includes('inspect'), 'inspect action starts the weapon clip');
}

/* ======================================================================== */
/*  selectable fire modes (issue 471)                                       */
/* ======================================================================== */

// Every automatic weapon offers SEMI next to AUTO, and the real B binding
// cycles the authored order without skipping or repeating a mode.
for (const id of ['rifle', 'smg', 'mcx', 'lmg']) {
  const { wp, tap } = makeHarness();
  wp.activeId = id;
  const modes = wp.state.def.modes;
  assert.deepEqual(
    [...modes].sort(),
    id === 'rifle' ? ['auto', 'burst', 'semi'] : ['auto', 'semi'],
    `${id} exposes the selectable fire modes`
  );
  const seen = [];
  for (let i = 0; i < modes.length; i++) {
    tap('KeyB');
    seen.push(wp.fireMode);
    assert.equal(wp.getHudState().mode, wp.fireMode, `${id} HUD follows the selector`);
  }
  assert.deepEqual(seen, [...modes.slice(1), modes[0]], `${id} cycles through every mode`);
}

// SEMI: one shot per distinct press, holding repeats nothing, and the weapon
// cadence still gates a press that lands too early.
{
  const { wp, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  tap('KeyB');
  assert.equal(wp.fireMode, 'semi', 'EVOLYS selector reaches SEMI');
  const total = () => wp.ammo.mag + wp.ammo.reserve;
  const ammo0 = total();
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'the press frame fires exactly one round');
  assert.equal(total(), ammo0 - 1, 'one round leaves the belt');
  for (let i = 0; i < 120; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'holding the trigger does not cycle the action in SEMI');
  assert.equal(total(), ammo0 - 1, 'held fire spends no extra ammunition');
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 2, 'a fresh press after release fires the next single shot');
  assert.equal(total(), ammo0 - 2);
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 2, 'a press inside the cadence window is refused');
  for (let i = 0; i < 6; i++) frame({});
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 3, 'the cadence window opens for a later press');
}

// AUTO keeps firing while held, and the ammo count follows the shot count.
{
  const { wp, frame, shots } = makeHarness();
  wp.activeId = 'lmg';
  assert.equal(wp.fireMode, 'auto');
  const total = () => wp.ammo.mag + wp.ammo.reserve;
  const ammo0 = total();
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  // 700 rpm over one second: ~11 rounds, far above a single shot.
  assert(shots.fired >= 10 && shots.fired <= 13, `AUTO stays continuous (${shots.fired} rounds)`);
  assert.equal(total(), ammo0 - shots.fired, 'AUTO accounting matches the rounds fired');
}

// The M4A1 burst is unchanged: three rounds from one press, then silence.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB');
  assert.equal(wp.fireMode, 'burst');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'the press frame starts the burst');
  for (let i = 0; i < 30; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 3, 'burst still delivers exactly three rounds');
  assert.equal(wp._burstLeft, 0, 'the burst queue is drained');
}

// Cycling away mid-burst drops the queue: no rounds fire after the change.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB'); // rifle: auto -> burst
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  assert.equal(wp._burstLeft, 2, 'two rounds are still queued');
  tap('KeyB'); // burst -> semi with the trigger down
  assert.equal(wp.fireMode, 'semi');
  assert.equal(wp._burstLeft, 0, 'the queued burst dies with the old mode');
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'no stale edge and no queued round fires in SEMI');
}

// AUTO -> SEMI while the trigger is down: the held pull cannot fire the new
// mode; release and press again for the deliberate single shot.
{
  const { wp, frame, shots } = makeHarness();
  wp.activeId = 'mcx'; // auto -> semi in one cycle
  frame({ down: ['Mouse0'] });
  for (let i = 0; i < 12; i++) frame({ down: ['Mouse0'] });
  const auto = shots.fired;
  assert(auto > 1, 'AUTO fired continuously before the switch');
  frame({ down: ['Mouse0', 'KeyB'], up: ['KeyB'] });
  assert.equal(wp.fireMode, 'semi');
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, auto, 'the held pull does not fire the new SEMI mode');
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, auto + 1, 'a fresh press fires the SEMI shot');
}

// SEMI -> AUTO while the trigger is down: the fresh AUTO mode waits for its
// own press instead of running away mid-pull.
{
  const { wp, frame, shots } = makeHarness();
  wp.activeId = 'lmg';
  frame({ down: ['KeyB'], up: ['KeyB'] }); // auto -> semi
  assert.equal(wp.fireMode, 'semi');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  frame({ down: ['Mouse0', 'KeyB'], up: ['KeyB'] }); // semi -> auto
  assert.equal(wp.fireMode, 'auto');
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'the held pull does not run away in AUTO');
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 60; i++) frame({ down: ['Mouse0'] });
  assert(shots.fired > 5, 'release + press restores continuous AUTO fire');
}

// A queued burst dies at the holster: coming back to the same gun must not
// resume it. The per-weapon selection survives the swap.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB'); // rifle: auto -> burst
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  assert.equal(wp._burstLeft, 2);
  frame({ down: ['Tab'], up: ['Tab'] });
  assert.equal(wp._switchTo, 'pistol');
  assert.equal(wp._burstLeft, 0, 'switching drops the queued burst');
  wp._onClipEvent('end', 'holster');
  assert.equal(wp.activeId, 'pistol');
  frame({ down: ['Tab'], up: ['Tab'] });
  wp._onClipEvent('end', 'holster');
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp.fireMode, 'burst', 'the selection stays with the weapon');
  for (let i = 0; i < 40; i++) frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1, 'the old burst does not resume on the way back up');
}

// A new run clears a dirty latch and the non-default selector on an inactive gun.
{
  const { wp, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  tap('KeyB');
  assert.equal(wp.fireMode, 'semi');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  tap('KeyB'); // semi -> auto, still held
  tap('KeyB'); // auto -> semi: leave the non-default selection dirty too
  assert.equal(wp._triggerLatched, true, 'restart precondition: held selector is latched');
  assert.equal(wp.states.get('lmg').mode, 'semi');
  assert.equal(wp.states.get('lmg').modeIndex, 1);
  wp.resetForNewGame();
  assert.equal(wp.activeId, 'rifle');
  assert.equal(wp.fireMode, 'auto', 'a new run starts on the authored first mode');
  assert.equal(wp._triggerLatched, false, 'restart clears the dirty latch');
  assert.equal(wp._burstLeft, 0);
  assert.equal(wp.states.get('lmg').mode, 'auto', 'restart resets the inactive selector');
  assert.equal(wp.states.get('lmg').modeIndex, 0, 'restart resets the inactive mode index');
  frame({ up: ['Mouse0'] });
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, before + 1, 'the reset loadout fires on its first fresh press');
}

// A partial burst independently dirties the restart queue (a selector clears it).
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  frame();
  assert(wp._burstLeft > 0, 'restart precondition: a partial burst is queued');
  wp.resetForNewGame();
  assert.equal(wp._burstLeft, 0, 'restart clears the dirty burst queue');
  frame({ up: ['Mouse0'] });
  tap('KeyB');
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  for (let i = 0; i < 30; i++) frame();
  assert.equal(shots.fired, before + 3, 'a fresh post-restart burst has exactly three rounds');
}

// Death clears a dirty mode-change latch without changing the selected mode.
{
  const { wp, frame, tap, shots } = makeHarness();
  wp.activeId = 'mcx';
  frame({ down: ['Mouse0'] });
  tap('KeyB'); // auto -> semi while held
  assert.equal(wp._triggerLatched, true, 'death precondition: held selector is latched');
  wp._onPlayerDeath();
  assert.equal(wp._triggerLatched, false, 'death clears the dirty latch');
  assert.equal(wp._burstLeft, 0);
  wp._setDeathDisabled(false);
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 10; i++) frame();
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  assert.equal(wp.fireMode, 'semi');
  assert.equal(shots.fired, before + 1, 'a fresh post-death SEMI press fires cleanly');
}

// Death independently clears a real partial M4A1 burst.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  frame();
  assert(wp._burstLeft > 0, 'death precondition: a partial burst is queued');
  wp._onPlayerDeath();
  assert.equal(wp._burstLeft, 0, 'death clears the dirty burst queue');
  assert.equal(wp._triggerLatched, false);
  wp._setDeathDisabled(false);
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 10; i++) frame();
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  for (let i = 0; i < 30; i++) frame();
  assert.equal(wp.fireMode, 'burst');
  assert.equal(shots.fired, before + 3, 'a fresh post-death burst has exactly three rounds');
}

// A release hidden behind the pause/shop control gate cannot strand the next press.
{
  const { wp, player, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  tap('KeyB'); // semi -> auto while held
  assert.equal(wp._triggerLatched, true);
  player.controlEnabled = false;
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 60; i++) frame();
  // A paused frame breaks the pull even without observing its release.
  assert.equal(wp._triggerLatched, false, 'the paused frame breaks the pull');
  player.controlEnabled = true;
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 2, 'the first fresh post-pause press fires immediately');
  for (let i = 0; i < 60; i++) frame();
  assert(shots.fired > 8, 'holding after resume continues AUTO fire');
  frame({ up: ['Mouse0'] });
  tap('KeyB'); // auto -> semi with trigger up
  for (let i = 0; i < 10; i++) frame();
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, before + 1, 'a trigger-up mode change does not block the next press');
}

// A fresh press clears the latch even when reload refuses its shot.
{
  const { wp, player, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  frame({ down: ['Mouse0'] });
  tap('KeyB'); // auto -> semi
  tap('KeyB'); // semi -> auto, still held
  assert.equal(wp.fireMode, 'auto');
  assert.equal(wp._triggerLatched, true);
  assert.equal(wp.reload(), true, 'reload accepts the spent round');
  player.controlEnabled = false;
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 10; i++) frame();
  assert.equal(wp._triggerLatched, false, 'the non-live reload frame breaks the pull');
  player.controlEnabled = true;
  const before = shots.fired;
  frame({ down: ['Mouse0'] });
  assert.equal(wp._triggerLatched, false, 'the reload-blocked fresh press clears the latch');
  assert.equal(shots.fired, before, 'reload still refuses the shot');
  wp._onClipEvent('magin', 'reloadTac');
  wp.viewmodel.stopClip(); // The stub has no mixer to finish the reload clip.
  frame();
  assert.equal(shots.fired, before + 1, 'held AUTO fires after reload without another press');
}

// Frozen/disabled handlers drop releases; the selector must survive the stuck hold.
for (const gate of ['frozen', 'disabled']) {
  const { wp, input, frame, tap, shots } = makeHarness();
  wp.activeId = 'mcx';
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 1);
  tap('KeyB'); // semi -> auto while held
  assert.equal(wp.fireMode, 'auto');
  assert.equal(wp._triggerLatched, true);
  if (gate === 'frozen') input.frozen = true;
  else input.enabled = false;
  input._onMouseUp({ button: 0 });
  assert.equal(input.fire, true, `${gate} handler drops the physical release`);
  for (let i = 0; i < 30; i++) frame();
  assert.equal(wp._triggerLatched, false, `${gate} frames break the pull`);
  input.frozen = false;
  input.enabled = true;
  const before = shots.fired;
  for (let i = 0; i < 10; i++) frame({ down: ['Mouse0'] });
  assert(shots.fired > before, `${gate} resume continues AUTO despite the stuck hold`);
}

// A same-frame selector and fresh fire press uses the newly selected mode.
{
  const { wp, frame, tap, shots } = makeHarness();
  wp.activeId = 'lmg';
  tap('KeyB');
  assert.equal(wp.fireMode, 'semi');
  frame({ down: ['Mouse0', 'KeyB'], up: ['KeyB'] });
  assert.equal(wp.fireMode, 'auto', 'same-frame B advances to the next mode');
  assert.equal(shots.fired, 1, 'same-frame B and fresh fire press fires exactly one round');
}

// A completed burst's authored delay survives a full selector round trip.
{
  const { wp, frame, tap, shots } = makeHarness();
  tap('KeyB');
  frame({ down: ['Mouse0'] });
  for (let i = 0; i < 8; i++) frame();
  assert.equal(shots.fired, 3);
  assert.equal(wp._burstLeft, 0);
  assert(wp._burstCooldown > 0, 'completed burst establishes an inter-burst delay');
  tap('KeyB'); // burst -> semi
  tap('KeyB'); // semi -> auto
  tap('KeyB'); // auto -> burst
  assert(wp._burstCooldown > 0, 'selector preserves the completed-burst delay');
  frame({ up: ['Mouse0'] });
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 3, 'a press within the preserved burst delay is refused');
  frame({ up: ['Mouse0'] });
  for (let i = 0; i < 12; i++) frame();
  frame({ down: ['Mouse0'] });
  assert.equal(shots.fired, 4, 'a fresh press after the delay starts a new burst');
  assert.equal(wp._burstLeft, 2);
}

// Radio owns 1/2/3 only while open, with request priority 1 > 2 > 3.
{
  const { wp, tap, prompts } = makeHarness();
  let strikes = 0;
  wp.radioSys = {
    callStrike() {
      strikes++;
      return true;
    },
  };
  tap('KeyX', 'Digit1');
  assert(wp.radioEquipped && strikes === 0, 'opening frame does not immediately select a request');
  tap('Digit2');
  assert.equal(wp._switchTo, null, 'request 2 never selects the secondary');
  assert.equal(prompts.at(-1).key, bindingLabel('slot2'));
  tap('Digit3');
  assert.equal(prompts.at(-1).key, bindingLabel('slot3'));
  tap('Digit3', 'Digit2', 'Digit1');
  assert.equal(strikes, 1);
  assert.equal(wp.carpetBombs, 0);
  assert(!wp.radioEquipped);
  tap('KeyX');
  tap('Digit1');
  assert(wp.radioEquipped);
  assert.equal(prompts.at(-1).key, bindingLabel('slot1'));
  tap('Tab', 'Digit2');
  assert(
    !wp.radioEquipped && wp._switchTo === 'pistol',
    'cycle stows radio before its request phase'
  );
}
{
  const { wp, tap } = makeHarness();
  tap('KeyX', 'Digit2');
  assert.equal(wp._switchTo, 'pistol', 'normal slot selection precedes radio opening');
  assert(!wp.radioEquipped, 'a same-frame switch blocks opening the radio');
}

// G replaces radio; X cannot replace grenade; simultaneous G/X favors grenade.
{
  const { wp, tap } = makeHarness();
  tap('KeyX');
  tap('KeyG');
  assert(wp.grenadeEquipped && !wp.radioEquipped);
  tap('KeyX');
  assert(wp.grenadeEquipped && !wp.radioEquipped);
  tap('KeyG');
  tap('KeyG', 'KeyX');
  assert(wp.grenadeEquipped && !wp.radioEquipped);
}

// Cooking retains its initiating action. Releasing the other action is inert.
for (const [code, other, action, type] of [
  ['Mouse0', 'Mouse2', 'fire', 'long'],
  ['Mouse2', 'Mouse0', 'ads', 'short'],
]) {
  const { wp, frame, tap, bodies, prompts } = makeHarness();
  tap('KeyG');
  assert.equal(prompts.at(-1).key, bindingLabel('fire'));
  assert.equal(
    prompts.at(-1).sub,
    `${bindingLabel('ads')} SHORT THROW · ${bindingLabel('grenade')} STOWS`
  );
  frame({ down: [code] });
  assert(wp.cooking);
  assert.equal(wp._cookAction, action);
  assert.equal(wp._throwType, type);
  frame({ down: [other] });
  frame({ up: [other] });
  assert(wp.cooking && wp._cookTime > 0, 'non-initiating release does not commit');
  frame({ up: [code] });
  assert(!wp.cooking && wp._throwing);
  assert.equal(wp._cookAction, null);
  assert(wp._throwFuse > 0 && wp._throwFuse < GRENADE_FUSE);
  tap('Mouse0', 'Mouse2', 'Digit2', 'Tab', 'KeyG', 'KeyX');
  assert(wp._throwing && !wp.cooking && wp.grenadeEquipped && !wp.radioEquipped);
  assert.equal(wp._switchTo, null, 'committed throw blocks switching');
  assert.equal(wp.grenades, 1, 'follow-through actions do not spend another grenade');
  wp._onClipEvent('grenade:release', 'grenadeThrow');
  wp._onClipEvent('grenade:release', 'grenadeThrow');
  assert.equal(bodies.length, 1, 'release beat spawns exactly once');
  wp._onClipEvent('grenade:done', 'grenadeThrow');
  assert(!wp.grenadeEquipped && !wp._throwing && wp.canFire());
}
{
  const { wp, tap, frame } = makeHarness();
  tap('KeyG');
  tap('Mouse0', 'Mouse2');
  assert.equal(wp._cookAction, 'fire', 'fire wins simultaneous cook edges');
  frame();
  assert(wp._throwing, 'same-frame tap commits next update via initiating action no longer held');
}
{
  const { wp, tap, frame } = makeHarness();
  tap('KeyG');
  frame({ down: ['Mouse2'] });
  // Inject an action release while its held union remains true: the approved
  // actionReleased contract must commit, not rely solely on the held query.
  const released = wp.ctx.input.actionReleased.bind(wp.ctx.input);
  wp.ctx.input.actionReleased = (action) => action === 'ads' || released(action);
  frame();
  assert(wp.ctx.input.action('ads') && wp._throwing && !wp.cooking);
}

// A release during a frozen frame cannot advance the fuse/throw; resume still
// observes the initiating action no longer held after the release edge expires.
{
  const { wp, input, tap, frame } = makeHarness();
  tap('KeyG');
  frame({ down: ['Mouse0'] });
  const cookTime = wp._cookTime;
  input.frozen = true;
  frame({ up: ['Mouse0'], dt: 1 });
  assert(wp.cooking && !wp._throwing && wp._cookTime === cookTime);
  input.frozen = false;
  frame();
  assert(wp._throwing && !wp.cooking);
}

// Weapon-side healing interruptions remain synchronous and retain their reasons.
for (const [code, reason] of [
  ['KeyI', 'inspect'],
  ['KeyR', 'reload'],
  ['Digit2', 'switch'],
  ['Tab', 'switch'],
  ['KeyG', 'grenade'],
  ['KeyX', 'radio'],
  ['Mouse0', 'fire'],
  ['Mouse2', 'ads'],
]) {
  const { wp, frame, cancellations } = makeHarness();
  assert(wp.beginHeal());
  frame({ down: [code] });
  assert.deepEqual(cancellations, [reason]);
  assert(!wp.healing, `${reason} unwinds the bandage hand`);
}
{
  const { wp, frame, cancellations } = makeHarness();
  assert(wp.beginHeal());
  frame({ wheel: 1 });
  assert.deepEqual(cancellations, ['switch'], 'wheel remains a heal interruption');
}
for (const code of ['Digit1', 'Digit3', 'KeyB']) {
  const { wp, tap, cancellations } = makeHarness();
  assert(wp.beginHeal());
  tap(code);
  assert(
    wp.healing && cancellations.length === 0,
    'same-slot/unused-slot/fire-mode do not interrupt healing'
  );
}
for (const blocked of ['disabled', 'frozen', 'dead', 'controls', 'input']) {
  const { wp, input, player, tap } = makeHarness();
  if (blocked === 'disabled') wp.disabled = true;
  if (blocked === 'frozen') input.frozen = true;
  if (blocked === 'dead') player.dead = true;
  if (blocked === 'controls') player.controlEnabled = false;
  if (blocked === 'input') input.enabled = false;
  const mode = wp.fireMode;
  tap('KeyB', 'KeyI', 'Digit2', 'Tab', 'KeyG', 'KeyX');
  assert.equal(wp.fireMode, mode);
  assert(!wp.inspecting && !wp.switching && !wp.grenadeEquipped && !wp.radioEquipped);
}

// Ammo prompt and hold use the same canonical T binding; F does not resupply.
{
  const { wp, frame, prompts } = makeHarness();
  wp.state.reserve = 0;
  const pickups = new AmmoPickups(wp);
  wp.pickups = pickups;
  try {
    pickups.spawn(new THREE.Vector3());
    frame({ down: ['KeyF'], dt: 0.5 });
    assert.equal(wp.state.reserve, 0);
    assert.equal(prompts.at(-1).key, bindingLabel('use'));
    assert.equal(prompts.at(-1).owner, 'ammo');
    frame({ up: ['KeyF'], down: ['KeyT'], dt: 0.5 });
    assert(wp.state.reserve > 0 && pickups.items.length === 0);
  } finally {
    pickups.dispose();
  }
}

console.log(
  'Weapon input contexts passed: canonical dispatch, ordering, accessories, cooking, committed throw, heal interruptions and ammo labels'
);
