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
  wp.sim = { spawn() {}, clear() {}, stats: { live: 0, fired: 0 } };
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
  return { wp, input, frame, tap, clips, prompts, cancellations, bodies, player };
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
