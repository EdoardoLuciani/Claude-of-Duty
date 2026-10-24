import assert from 'node:assert/strict';

import { Input } from '../../src/core/input.ts';

const input = new Input({}, { sensitivity: 0.001, invertY: false });
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
Object.assign(input.stick, { moveX: 1, moveY: -1, lookX: 0.5, lookY: -0.5 });
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
input._onKeyDown({ code: 'Space', repeat: true, preventDefault() {} });
input._onKeyUp({ code: 'Space', preventDefault() {} });
input._onMouseUp({ button: 0 });
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
input._onKeyDown({ code: 'Space', repeat: false, preventDefault() {} });
input._onMouseDown({ target: input.canvas, button: 0 });
input._onMouseMove({ movementX: 5, movementY: -2 });
input._onWheel({ target: input.canvas, deltaY: -1 });
input.beginFrame();
assert.equal(input.actionPressed('jump'), true);
assert.equal(input.firePressed, true);
assert.deepEqual(input.look, { x: 0.005, y: -0.002 });
assert.equal(input.wheel, -1);
input.enabled = false;
input.frozen = true;
input.clear();
assert.equal(input.enabled, false);
assert.equal(input.frozen, true);
assert.equal(input.fire, false);
console.log('ok  input clear discards held, edge, pending, look, wheel and stick state');
