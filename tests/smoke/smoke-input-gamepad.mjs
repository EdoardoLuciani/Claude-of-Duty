// Disabled native input must not leak held or stale axes into actual Player consumers.
import assert from 'node:assert/strict';

import { Input } from '../../src/core/input.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let polls = 0;
const pads = [{ axes: [1, -1, 1, -1] }];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    getGamepads() {
      polls++;
      return pads;
    },
  },
});
try {
  const input = new Input({}, { sensitivity: 0.002, invertY: false });
  const player = new PlayerSystem();
  const ctx = { input, config: { adsSensScale: 0.7 }, time: { frame: 0, elapsed: 0, dt: 1 / 60 } };
  player.ctx = ctx;
  player.movement = new Movement(ctx, player);
  const movement = player.movement;
  const neutral = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 };
  const held = { moveX: 1, moveY: -1, lookX: 1, lookY: -1 };
  function frame(enabled) {
    input.enabled = enabled;
    ctx.time.frame++;
    ctx.time.elapsed += ctx.time.dt;
    input.beginFrame();
    // Actual Player fixed phase consumes look and latches commands; no physics
    // character is needed to test the input contract, so motor stepping is inert.
    player.fixedUpdate(1 / 120, ctx);
    const yaw = movement.yaw,
      pitch = movement.pitch;
    player.fixedUpdate(1 / 120, ctx);
    assert.equal(movement.yaw, yaw, 'look is consumed once per frame');
    assert.equal(movement.pitch, pitch);
    input.endFrame();
  }
  function assertNeutral(yaw, pitch, expectedPolls) {
    assert.equal(polls, expectedPolls, 'native polling respects the enabled state');
    assert.deepEqual(input.stick, neutral, 'all four axes, including stale values, are cleared');
    assert.equal(movement.cmd.moveX, 0);
    assert.equal(movement.cmd.moveY, 0);
    assert.equal(movement.cmd.sprintHeld, false);
    assert.equal(movement.cmd.sprintPressed, false);
    assert.equal(movement.yaw, yaw);
    assert.equal(movement.pitch, pitch);
    assert(movement.yawRate === 0);
  }
  Object.assign(input.stick, held); // stale values must also clear on first disabled frame
  frame(false);
  assertNeutral(0, 0, 0);
  frame(false);
  assertNeutral(0, 0, 0);
  frame(true);
  assert.equal(polls, 1);
  assert.deepEqual(input.stick, held);
  assert.equal(movement.cmd.moveX, 1 / Math.sqrt(2));
  assert.equal(movement.cmd.moveY, 1 / Math.sqrt(2));
  assert.equal(movement.cmd.sprintHeld, true);
  assert.equal(movement.cmd.sprintPressed, true);
  assert.equal(movement.yaw, -3.1 / 60);
  assert.equal(movement.pitch, 3.1 / 60);
  const yaw = movement.yaw,
    pitch = movement.pitch;
  frame(false); // pad is still held and the previous frame's axes are nonzero
  assertNeutral(yaw, pitch, 1);
  frame(false);
  assertNeutral(yaw, pitch, 1);
  frame(true);
  assert.equal(polls, 2, 'native controls resume on re-enable');
  assert.deepEqual(input.stick, held);
  assert(movement.yaw < yaw && movement.pitch > pitch);
  pads.length = 0;
  const disconnectedYaw = movement.yaw,
    disconnectedPitch = movement.pitch;
  frame(true);
  assertNeutral(disconnectedYaw, disconnectedPitch, 3);
  console.log(
    'ALL PASS: disabled/enabled/disabled held gamepad axes, native polling, Player commands and yaw/pitch'
  );
} finally {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
}
