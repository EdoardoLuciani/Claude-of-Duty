import assert from 'node:assert/strict';

import { FIXED_DT } from '../../src/core/config.ts';
import type { FrameHook, Subsystem } from '../../src/core/registry.ts';
import { addLifecycle, createCoreFixture } from '../lib/core-fixture.ts';

// Default-off preserves existing callers/capture pumps. Suspension keeps input,
// raw-time UI, rendering and first-render readiness alive, not gameplay hooks.
const { engine, registry } = createCoreFixture();
const calls: string[] = [];
for (const id of ['game', 'ui', 'telemetry']) {
  addLifecycle(registry, id, {
    fixedUpdate: (): number => calls.push(`${id}:fixed`),
    update: (): number => calls.push(`${id}:update`),
    lateUpdate: (dt): number => calls.push(`${id}:late:${dt}`),
    resize: (): number => calls.push(`${id}:resize`),
  });
}
let renders = 0;
let completed = 0;
let begins = 0;
let ends = 0;
const beginFrame = engine.input.beginFrame.bind(engine.input);
engine.input.beginFrame = (): void => {
  begins++;
  beginFrame();
};
engine.input.endFrame = (): number => ends++;
addLifecycle(registry, 'render', {
  render: (): number => renders++,
});
assert.equal(engine.gameplaySuspended, false);
engine.step(10);
assert(calls.includes('game:fixed'));
assert(calls.includes('game:update'));
assert(calls.includes('telemetry:update'));
assert(engine._accum > 0, 'establish a fractional fixed-step backlog');
const elapsed = engine.time.elapsed;
const frame = engine.time.frame;
const raw = engine.time.raw;
engine.time.scale = 0.5;
engine.setGameplaySuspended(true);
assert.equal(engine.gameplaySuspended, true);
assert.equal(engine.time.dt, 0);
assert.equal(engine.time.alpha, 0);
assert.equal(engine._accum, 0);
engine.onFirstRender = (): number => completed++;
calls.length = 0;
engine.resize();
assert.deepEqual(calls, ['game:resize', 'ui:resize', 'telemetry:resize']);
calls.length = 0;
for (let i = 1; i <= 100; i++) engine.step(10 + i * 100);
assert.equal(engine.time.elapsed, elapsed);
assert.equal(engine.time.dt, 0);
assert.equal(engine.time.alpha, 0);
assert.equal(engine._accum, 0);
assert.equal(engine.time.scale, 0.5, 'gate does not overwrite pause/shop time scale');
assert.equal(engine.time.frame, frame + 100);
assert(Math.abs(engine.time.raw - raw - 10) < 1e-9);
assert.deepEqual(calls, Array(100).fill('ui:late:0'));
assert.equal(begins, 101);
assert.equal(ends, 101);
assert.equal(renders, 101);
assert.equal(completed, 1, 'a successful waiting render is ready, not active');

// Activation clears both the snapshot and unsnapshotted Start intents. It does
// not silently enable input, change capture freeze, or synthesize an extra tick.
engine.input.down.add('Mouse0');
engine.input._pendingDown.add('Space');
engine.input._pendingWheel = 1;
engine.input._rawLook.x = 100;
engine.input.enabled = false;
engine.input.frozen = true;
engine.setGameplaySuspended(false);
assert.equal(engine.input.fire, false);
assert.equal(engine.input._pendingDown.size, 0);
assert.equal(engine.input._pendingWheel, 0);
assert.equal(engine.input._rawLook.x, 0);
assert.equal(engine.input.enabled, false);
assert.equal(engine.input.frozen, true);
assert.equal(engine.time.elapsed, elapsed);
assert.equal(engine.time.frame, frame + 100);
calls.length = 0;
engine.step(10020); // 10 ms wall time, 5 ms scaled; no old fractional backlog
assert.equal(engine.gameplaySuspended, false);
assert.equal(engine.time.dt, 0.005);
assert(Math.abs(engine.time.elapsed - elapsed - 0.005) < 1e-9);
assert(!calls.some((call): boolean => call.endsWith(':fixed')), 'no suspended-time catch-up');
assert(calls.includes('game:update'));
assert(calls.includes('telemetry:update'));
assert(Math.abs(engine._accum - 0.005) < 1e-9);
engine.input.down.add('KeyW');
engine.setGameplaySuspended(false);
assert(engine.input.held('KeyW'), 'idempotent calls do not discard active input');

// A gate raised inside any gameplay hook stops the remaining hooks immediately,
// including non-dt late hooks. In particular, do not subtract a fixed step from
// the accumulator after the hook has cleared it.
const phases: FrameHook[] = ['fixedUpdate', 'update', 'lateUpdate'];
for (const phase of phases) {
  const { engine: gated, registry: gatedRegistry } = createCoreFixture();
  const hooks: string[] = [];
  const trigger: Subsystem = {};
  trigger[phase] = (): void => {
    hooks.push(phase);
    gated.setGameplaySuspended(true);
  };
  addLifecycle(gatedRegistry, 'trigger', trigger);
  addLifecycle(gatedRegistry, 'after', {
    fixedUpdate: (): number => hooks.push('after-fixed'),
    update: (): number => hooks.push('after-update'),
    lateUpdate: (): number => hooks.push('after-late'),
  });
  addLifecycle(gatedRegistry, 'ui', {
    lateUpdate: (dt): void => {
      assert.equal(dt, 0);
      hooks.push('ui');
    },
  });
  addLifecycle(gatedRegistry, 'render', {
    render: (): number => hooks.push('render'),
  });
  gated.step(FIXED_DT * 1000);
  const boundary = hooks.indexOf(phase);
  assert(boundary >= 0);
  assert.deepEqual(hooks.slice(boundary), [phase, 'ui', 'render']);
  assert.equal(gated._accum, 0);
  assert.equal(gated.time.alpha, 0);
}

// Suspension is not a weaker replacement for the terminal-error latch. A UI
// or render failure while waiting still requires reload and cannot be resumed.
const log = console.error;
console.error = (): void => {};
try {
  for (const phase of ['lateUpdate', 'render']) {
    const { engine: failed, registry: failedRegistry } = createCoreFixture();
    failed.setGameplaySuspended(true);
    let uiCalls = 0;
    let drawCalls = 0;
    let firstRender = 0;
    failed.onFirstRender = (): number => firstRender++;
    addLifecycle(failedRegistry, 'ui', {
      lateUpdate(): void {
        uiCalls++;
        if (phase === 'lateUpdate') throw new Error('waiting UI failed');
      },
    });
    addLifecycle(failedRegistry, 'render', {
      render(): void {
        drawCalls++;
        if (phase === 'render') throw new Error('waiting render failed');
      },
    });
    failed._running = true;
    failed.step(20);
    const error = failed.error;
    assert(error);
    assert.equal(error.method, phase);
    assert.equal(firstRender, 0);
    if (phase === 'render') assert.equal(failed._running, false);
    failed.setGameplaySuspended(false);
    failed.time.scale = 1;
    failed.step(40);
    assert.equal(failed.gameplaySuspended, true);
    assert.equal(failed.error, error);
    assert.equal(failed.time.elapsed, 0);
    assert.equal(failed.time.dt, 0);
    assert.equal(failed.input.enabled, false);
    assert.equal(failed.input.frozen, true);
    assert.equal(uiCalls, 1, 'terminal errors skip even UI frame hooks');
    assert.equal(drawCalls, 2, 'existing presentation/failure handling is preserved');
  }
} finally {
  console.error = log;
}
console.log('ok  core gameplay suspension, raw-time UI/input/render, resume and terminal latch');
