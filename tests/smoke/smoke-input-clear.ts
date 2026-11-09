import assert from 'node:assert/strict';

import { DEFAULT_BINDINGS } from '../../src/core/bindings.ts';
import { Input } from '../../src/core/input.ts';
import * as complete from '../lib/dom-fixture.ts';
import { fixture } from '../lib/fixture.ts';

function keyEvent(code: string, repeat = false): KeyboardEvent {
  return fixture<KeyboardEvent>(
    {
      code,
      repeat,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault(): void {},
    },
    complete.testKeyboardEvent()
  );
}

// Keep canonical coverage/conflict checks without a second literal binding table.
const owners = new Map<string, string>();
for (const [action, codes] of Object.entries(DEFAULT_BINDINGS)) {
  assert(codes.length > 0);
  for (const code of codes) {
    assert(!owners.has(code), `${code}: ${owners.get(code)} conflicts with ${action}`);
    owners.set(code, action);
  }
}

const input = new Input(complete.testElement('canvas'), {
  sensitivity: 0.001,
  invertY: false,
});
input.pointerLocked = true;
input._gameplayFocus = true;
input.gamepadIndex = 2;
for (const codes of [
  input.down,
  input._pressed,
  input._released,
  input._pendingDown,
  input._pendingUp,
]) {
  codes.add('Mouse0');
  codes.add('Space');
  codes.add('KeyW');
  codes.add('Escape');
}
input.look.x = input.look.y = input._rawLook.x = input._rawLook.y = 20;
input.wheel = input._pendingWheel = 3;
input.stick = { moveX: 1, moveY: -1, lookX: 0.5, lookY: -0.5 };
input.clear();
for (const codes of [
  input.down,
  input._pressed,
  input._released,
  input._pendingDown,
  input._pendingUp,
])
  assert.equal(codes.size, 0);
assert.deepEqual(input.look, { x: 0, y: 0 });
assert.deepEqual(input._rawLook, { x: 0, y: 0 });
assert.deepEqual(input.stick, { moveX: 0, moveY: 0, lookX: 0, lookY: 0 });
assert.equal(input.wheel, 0);
assert.equal(input._pendingWheel, 0);
assert.equal(input.pointerLocked, true);
assert.equal(input._gameplayFocus, true);
assert.equal(input.gamepadIndex, 2);
assert.equal(input.enabled, true);
assert.equal(input.frozen, false);

// Holding the keyboard activation key through the handoff must not replay it
// via repeat. Its release must not generate a gameplay release edge either.
input._onKeyDown(keyEvent('Space', true));
input._onKeyUp(keyEvent('Space'));
input._onMouseUp(fixture<MouseEvent>({ button: 0 }, complete.testMouseEvent()));
input.beginFrame();
assert.equal(input.actionPressed('jump'), false);
assert.equal(input.actionReleased('jump'), false);
assert.equal(input.action('forward'), false);
assert.equal(input.fire, false);
assert.equal(input.firePressed, false);
assert.equal(input.actionReleased('fire'), false);
assert.equal(input.pressed('Escape'), false);
assert.deepEqual(input.moveVector(), { x: 0, y: 0 });
assert.deepEqual(input.look, { x: 0, y: 0 });
assert.equal(input.wheel, 0);

// New physical actions work normally; clearing is a one-time handoff, not a
// new input mode or pointer-lock policy.
input._onKeyDown(keyEvent('Space'));
input._onMouseDown(
  fixture<MouseEvent>({ target: input.canvas, button: 0 }, complete.testMouseEvent())
);
input._onMouseMove(fixture<MouseEvent>({ movementX: 5, movementY: -2 }, complete.testMouseEvent()));
input._onWheel(
  fixture<WheelEvent>({ target: input.canvas, deltaY: -1 }, complete.testWheelEvent())
);
input.beginFrame();
assert.equal(input.actionPressed('jump'), true);
assert.equal(input.firePressed, true);
assert.deepEqual(input.look, { x: 0.005, y: -0.002 });
assert.equal(input.wheel, -1);

// Alias edges retain physical-key semantics; a same-frame tap retains both edges.
input.clear();
input._onKeyDown(keyEvent('ControlLeft'));
input.beginFrame();
assert(input.action('crouch') && input.actionPressed('crouch'));
input._onKeyDown(keyEvent('KeyC'));
input.beginFrame();
assert(input.action('crouch') && input.actionPressed('crouch'));
input._onKeyUp(keyEvent('ControlLeft'));
input.beginFrame();
assert(input.action('crouch') && input.actionReleased('crouch'));
input._onKeyUp(keyEvent('KeyC'));
input._onKeyDown(keyEvent('KeyZ'));
input._onKeyUp(keyEvent('KeyZ'));
input.beginFrame();
assert(!input.action('crouch') && !input.action('prone'));
assert(input.actionPressed('prone') && input.actionReleased('prone'));
input._onKeyDown(keyEvent('KeyF'));
assert(!input.action('flashlight'), 'DOM events wait for the next snapshot');
input.beginFrame();
for (let fixedRead = 0; fixedRead < 4; fixedRead++) assert(input.actionPressed('flashlight'));
input._onKeyDown(keyEvent('KeyF', true));
input._onKeyDown(keyEvent('Tab'));
input._onWheel(
  fixture<WheelEvent>({ target: input.canvas, deltaY: -1 }, complete.testWheelEvent())
);
input.beginFrame();
assert(
  input.action('flashlight') && !input.actionPressed('flashlight'),
  'repeat is not a new edge'
);
assert(input.actionPressed('cycleWeapon') && input.wheel === -1, 'Tab and wheel stay independent');
input.enabled = false;
input.frozen = true;
input.clear();
assert.equal(input.enabled, false);
assert.equal(input.frozen, true);
assert.equal(input.fire, false);
console.log('ok  input clear discards held, edge, pending, look, wheel and stick state');
