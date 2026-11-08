import assert from 'node:assert/strict';

import * as THREE from 'three';

/** Player consumers of canonical controls, exercised in fixed/update input phase order. */
import type { EngineContext } from '../../src/core/context.ts';
import type { EngineEventMap } from '../../src/core/events.ts';
import { Input } from '../../src/core/input.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { CharacterController } from '../../src/physics/character.ts';
import { CameraRig } from '../../src/player/camera.ts';
import { HealController } from '../../src/player/heal.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { LedgeProbe } from '../../src/player/mantle.ts';
import { LEDGE_NONE } from '../../src/player/mantle.ts';
import { Movement } from '../../src/player/movement.ts';
import { FLASHLIGHT, HEALING, MOVE } from '../../src/player/tuning.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture as partialFixture } from '../lib/fixture.ts';

// Real player, movement, health and input; only collision and weapon presentation are inert.
interface FrameOptions {
  down?: string[];
  up?: string[];
  steps?: number;
  dt?: number;
}
type HealEvent = EngineEventMap['player:heal'] & { name: 'player:heal' };
interface PlayerFixture {
  input: Input;
  player: PlayerSystem;
  ctx: EngineContext;
  events: HealEvent[];
  frame: (options?: FrameOptions) => void;
}
function fixture(): PlayerFixture {
  const input = new Input(partialFixture<HTMLCanvasElement>({}), {
    sensitivity: 0.002,
    invertY: false,
  });
  const player = new PlayerSystem();
  const events: HealEvent[] = [];
  const weapons = new WeaponSystem();
  weapons.beginHeal = (): boolean => true;
  weapons.endHeal = (): void => {};
  weapons.setHealProgress = (): void => {};
  const ctx = createTestContext({ input, providers: { weapons, player } });
  ctx.config.fov = 75;
  ctx.config.adsFovScale = 0.62;
  ctx.config.adsSensScale = 0.7;
  ctx.time.dt = 1 / 60;
  ctx.time.alpha = 1;
  ctx.events.on('player:heal', (payload): void => {
    events.push({ name: 'player:heal', ...payload });
  });
  player.ctx = ctx;
  player.movement = new Movement(ctx, player);
  player.rig = new CameraRig(ctx);
  player.health = new Health(ctx, player.rig);
  player.healCtrl = new HealController(player);
  player.flashlightOn = false;
  player.flashlight = new THREE.SpotLight();
  player.movement.probe = new LedgeProbe(null);
  player.movement.probe.probe = (): typeof LEDGE_NONE => LEDGE_NONE;
  const character = new CharacterController(new StaticWorld());
  character.grounded = true;
  character.canFit = (): boolean => true;
  character.move = (x, y, z): number => {
    character.position.x += x;
    character.position.y += y;
    character.position.z += z;
    character.grounded = character.position.y <= 0;
    if (character.grounded) {
      character.position.y = 0;
      character.velocity.y = 0;
    }
    return Math.hypot(x, y, z);
  };
  player.movement.character = character;
  function frame({ down = [], up = [], steps = 2, dt = 1 / 60 }: FrameOptions = {}): void {
    for (const code of down) input._pendingDown.add(code);
    for (const code of up) input._pendingUp.add(code);
    ctx.time.frame++;
    ctx.time.elapsed += dt;
    ctx.time.dt = dt;
    input.beginFrame();
    for (let i = 0; i < steps; i++) player.fixedUpdate(ctx.time.fixed, ctx);
    player.update(dt, ctx);
    input.endFrame();
  }
  return { input, player, ctx, events, frame };
}

for (const steps of [0, 1, 3]) {
  const { input, player, ctx, frame } = fixture();
  input._pendingDown.add('KeyF');
  assert.equal(
    input.actionPressed('flashlight'),
    false,
    'pending DOM input is not a frame snapshot'
  );
  ctx.time.frame++;
  input.beginFrame();
  for (let i = 0; i < steps; i++) {
    player.fixedUpdate(ctx.time.fixed, ctx);
    assert.equal(player.flashlightOn, false, 'fixed steps do not consume flashlight presses');
  }
  player.update(1 / 60, ctx);
  input.endFrame();
  assert.equal(player.flashlightOn, true, `${steps} fixed steps: F toggles in update`);
  assert.equal(player.flashlight.intensity, FLASHLIGHT.intensity);
  assert.equal(input.action('use'), false, 'F never activates interact');
  assert.equal(
    input.actionPressed('flashlight'),
    true,
    'consumer reads do not drain snapshot edges'
  );
  frame({ steps });
  assert.equal(input.actionPressed('flashlight'), false, 'next beginFrame clears the old edge');
  assert.equal(player.flashlightOn, true, 'holding F does not retoggle');
  frame({ steps, down: ['KeyT'], up: ['KeyF'] });
  assert.equal(input.action('use'), true, 'T holds interact');
  assert.equal(input.action('flashlight'), false, 'T never holds flashlight');
  assert.equal(player.flashlightOn, true, 'T does not toggle flashlight');
  frame({ steps });
  assert.equal(input.action('use'), true, 'interact remains held without a fresh edge');
  assert.equal(input.actionPressed('use'), false);
  frame({ steps, down: ['KeyF'], up: ['KeyT'] });
  assert.equal(player.flashlightOn, false, 'fresh F toggles off');
  assert.equal(player.flashlight.intensity, 0);
}

for (const guard of ['zero-dt', 'control-disabled', 'input-disabled', 'frozen', 'dead']) {
  const { player, input, frame } = fixture();
  player.setFlashlightEnabled(true);
  if (guard === 'control-disabled') player.setControlEnabled(false);
  if (guard === 'input-disabled') input.enabled = false;
  if (guard === 'frozen') input.frozen = true;
  if (guard === 'dead') {
    player.health.dead = true;
    player._death.active = true;
  }
  frame({ down: ['KeyF'], dt: guard === 'zero-dt' ? 0 : 1 / 60, steps: 0 });
  assert.equal(player.flashlightOn, guard !== 'dead', `${guard} blocks F; only death switches off`);
  assert.equal(player.flashlight.shadow.needsUpdate, guard !== 'dead');
}
{
  const { player } = fixture();
  player.setFlashlightEnabled(true);
  const light = player.flashlight;
  player.respawn();
  assert.equal(player.flashlightOn, false, 'restart/respawn switches off');
  assert.equal(
    player.flashlight,
    light,
    'toggles and restart preserve the permanent light identity'
  );
}

for (const steps of [1, 3]) {
  const { player, input, frame } = fixture();
  frame({ steps, down: ['ControlLeft'] });
  assert.equal(player.stance, 'crouch', 'one rendered press toggles once across fixed substeps');
  frame({ steps, down: ['KeyC', 'ControlRight'] });
  assert.equal(input.actionPressed('crouch'), true, 'physical alias edges remain visible');
  assert.equal(player.stance, 'crouch', 'alias press cannot retoggle a held stance union');
  frame({ steps, up: ['ControlLeft', 'KeyC'] });
  assert.equal(input.actionReleased('crouch'), true);
  assert.equal(player.stance, 'crouch', 'partial alias release retains the union latch');
  frame({ steps, up: ['ControlRight'] });
  frame({ steps, down: ['KeyC'] });
  assert.equal(player.stance, 'stand', 'fresh union press toggles again');
  frame({ steps, down: ['KeyZ'], up: ['KeyC'] });
  assert.equal(player.stance, 'prone', 'Z prone toggles once');
  frame({ steps });
  assert.equal(player.stance, 'prone', 'held prone does not retoggle');
}
{
  const { player, frame } = fixture();
  frame({ steps: 0, down: ['KeyC'] });
  assert.equal(player.movement.cmd.crouchPressed, true, 'zero-step update still latches the frame');
  assert.equal(player.stance, 'stand', 'stance transitions wait for a fixed step');
  frame({ steps: 0 });
  assert.equal(player.movement.cmd.crouchPressed, false, 'held union is not a second edge');
}
{
  const { player, frame } = fixture();
  frame({ down: ['KeyW', 'ShiftRight'] });
  for (let i = 0; i < 12; i++) frame();
  assert.equal(player.sprinting, false, 'Right Shift remains unbound');
  frame({ down: ['ShiftLeft'], up: ['ShiftRight'] });
  for (let i = 0; i < Math.ceil(MOVE.sprintStartDelay * 60); i++) frame();
  assert.equal(player.sprinting, true, 'Left Shift plus forward retains sprint delay');
  assert.equal(player.tacticalSprint, false, 'first Shift hold is not a tactical double tap');
  frame({ up: ['ShiftLeft'] });
  frame({ down: ['ShiftLeft'] });
  for (let i = 0; i < Math.ceil(MOVE.sprintStartDelay * 60); i++) frame();
  assert.equal(player.tacticalSprint, true, 'second tap within the window retains tactical sprint');
  frame({ up: ['ShiftLeft'] });
  assert.equal(player.tacticalSprint, false, 'release ends tactical sprint');
}

{
  const { player, input, events, frame } = fixture();
  player.health.value = 40;
  frame({ down: ['KeyW', 'KeyH'] });
  for (let i = 0; i < 30; i++) frame();
  assert.ok(
    player.horizontalSpeed > 0 && player.healCtrl.active,
    'walking permits continued healing'
  );
  assert.deepEqual(
    [player.health.value, player.bandages],
    [40, 2],
    'partial walking hold grants nothing'
  );
  frame({ down: ['KeyF', 'KeyT'] });
  assert.ok(
    player.flashlightOn && input.action('use') && player.healCtrl.active,
    'F/T do not interrupt heal hold'
  );
  for (let i = 0; i < 180 && player.healCtrl.active; i++) frame();
  assert.deepEqual(
    [player.health.value, player.bandages],
    [90, 1],
    'walking hold completes exactly once'
  );
  for (let i = 0; i < 10; i++) frame();
  assert.equal(
    events.filter((e): boolean => e.name === 'player:heal' && e.phase === 'complete').length,
    1
  );
  assert.deepEqual(
    [player.health.value, player.bandages],
    [90, 1],
    'held H after completion does not restart'
  );
}
for (const request of ['KeyI', 'Digit1', 'Digit2', 'Tab', 'wheel-up', 'wheel-down']) {
  const { player, input, events, frame } = fixture();
  player.health.value = 40;
  frame({ down: ['KeyH'] });
  player.healCtrl.elapsed = HEALING.duration - 0.01;
  if (request.startsWith('wheel')) input._pendingWheel = request === 'wheel-up' ? 1 : -1;
  frame({ down: request.startsWith('wheel') ? [] : [request], steps: 0 });
  assert.equal(
    player.healCtrl.active,
    false,
    `${request} interrupts completion from the real snapshot`
  );
  assert.deepEqual([player.health.value, player.bandages], [40, 2]);
  assert.equal(events.filter((e): boolean => e.name === 'player:heal').at(-1)?.reason, 'interrupt');
}
for (const motion of ['sprint', 'jump']) {
  const { player, events, frame } = fixture();
  player.health.value = 40;
  frame({ down: ['KeyW', 'KeyH'] });
  player.healCtrl.elapsed = motion === 'jump' ? HEALING.duration - 0.01 : 1;
  frame({ down: [motion === 'sprint' ? 'ShiftLeft' : 'Space'] });
  if (motion === 'sprint') for (let i = 0; i < 12 && player.healCtrl.active; i++) frame();
  assert.equal(
    player.healCtrl.active,
    false,
    `${motion} interrupts after fixed movement, before completion`
  );
  assert.deepEqual([player.health.value, player.bandages], [40, 2]);
  assert.equal(events.filter((e): boolean => e.name === 'player:heal').at(-1)?.reason, 'move');
  if (motion === 'jump') {
    assert.equal(player.movement.jumped, false, 'update drains the jump event before heal');
    assert.equal(player.airborne, true, 'airborne guard still prevents final-frame healing');
  }
}
console.log(
  'ALL PASS: player F/T isolation and guards, input phases, stance union latch, tactical sprint and walking/sprint/jump healing'
);
