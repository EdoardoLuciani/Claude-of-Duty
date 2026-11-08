import assert from 'node:assert/strict';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { EngineError } from '../../src/core/events.ts';
import { ModelSystem } from '../../src/core/models.ts';
import type { FrameHook, Subsystem } from '../../src/core/registry.ts';
import { addLifecycle, createCoreFixture } from '../lib/core-fixture.ts';

// A partial update is terminal: later gameplay hooks and later frames cannot
// continue mutating the simulation, even if something tries to unpause it.
const log = console.error;
console.error = (): void => {};
try {
  for (const phase of ['fixedUpdate', 'update', 'lateUpdate', 'render']) {
    const { engine, registry } = createCoreFixture();
    const calls: string[] = [],
      errors: EngineError[] = [];
    const sys: Subsystem = {};
    const methods: FrameHook[] = ['fixedUpdate', 'update', 'lateUpdate'];
    for (const method of methods)
      sys[method] = (): void => {
        calls.push(method);
        if (method === phase) throw new Error(`broken ${phase}`);
      };
    addLifecycle(registry, 'broken', sys);
    addLifecycle(registry, 'after', {
      fixedUpdate: (): number => calls.push('after-fixed'),
      update: (): number => calls.push('after-update'),
      lateUpdate: (): number => calls.push('after-late'),
    });
    let renders = 0;
    addLifecycle(registry, 'render', {
      render(): void {
        renders++;
        if (phase === 'render') throw new Error('broken render');
      },
    });
    engine.events.on('engine:error', (e): number => errors.push(e));
    engine._running = true;
    engine.step(20);
    assert.equal(errors.length, 1);
    assert(engine.error);
    assert.equal(engine.error.method, phase);
    assert.equal(engine.input.enabled, false);
    assert.equal(engine.input.frozen, true);
    assert.equal(engine.time.dt, 0);
    assert.equal(engine._accum, 0);
    if (phase !== 'render') assert.equal(calls.at(-1), phase, 'no later hook after failure');
    else assert.equal(engine._running, false, 'render failures stop the loop');
    const count = calls.length,
      elapsed = engine.time.elapsed;
    engine.time.scale = 1;
    engine.step(40);
    assert.equal(calls.length, count);
    assert.equal(engine.time.elapsed, elapsed);
    assert.equal(errors.length, 1);
    assert.equal(renders, 2, 'simulation failure does not prevent presentation');
  }
  for (const origin of ['update-event', 'external-event', 'resize-hook', 'resize-event']) {
    const { engine, registry } = createCoreFixture();
    const calls: string[] = [],
      errors: EngineError[] = [];
    const fault = (): void => {
      throw new Error(origin);
    };
    engine.events.on('damage:dealt', fault);
    engine.events.on('damage:dealt', (): number => calls.push('later listener'));
    engine.events.on('game:restart', (): void => {
      engine.events.emit('damage:dealt', { target: null, amount: 0 });
      calls.push('continued outer listener');
    });
    // A broken diagnostic subscriber cannot prevent the modal/recorder receiving
    // the original failure or replace it with a recursive engine:error failure.
    engine.events.on('engine:error', (): void => {
      throw new Error('broken diagnostic');
    });
    engine.events.on('engine:error', (e): number => errors.push(e));
    addLifecycle(registry, 'broken', {
      update(): void {
        engine.events.emit('game:restart', {});
        calls.push('continued update');
      },
      resize: origin === 'resize-hook' ? fault : (): void => {},
    });
    addLifecycle(registry, 'after', {
      update: (): number => calls.push('later update'),
      resize: (): number => calls.push('later resize'),
    });
    engine.events.on(
      'resize',
      origin === 'resize-event' ? fault : (): number => calls.push('resize notification')
    );
    engine.events.on('resize', (): number => calls.push('later resize listener'));
    if (origin === 'update-event') engine.step(20);
    else if (origin === 'external-event')
      assert.throws((): void => engine.events.emit('game:restart', {}), /external-event/);
    else engine.resize();
    assert(engine.error);
    assert.equal(engine.error.message, origin);
    assert.equal(engine.error.system, origin === 'resize-hook' ? 'broken' : 'events');
    assert.equal(
      engine.error.method,
      origin === 'resize-hook' || origin === 'resize-event' ? 'resize' : 'damage:dealt'
    );
    // The successful hook before a resize notification is allowed; nothing after
    // the exception, including the second resize listener, may execute.
    assert.deepEqual(calls, origin === 'resize-event' ? ['later resize'] : []);
    const count = calls.length,
      elapsed = engine.time.elapsed;
    engine.time.scale = 1;
    engine.resize();
    engine.step(40);
    engine.step(60);
    assert.equal(calls.length, count);
    assert.equal(engine.time.elapsed, elapsed);
    assert.deepEqual(errors, [engine.error]);
  }
  // resize() hooks may report a terminal failure without throwing. Rechecking
  // the error after each hook is not a constant condition (DeepScan #236542430).
  const { engine: resized, registry: resizeRegistry } = createCoreFixture();
  const resizeCalls: string[] = [];
  addLifecycle(resizeRegistry, 'reported', {
    resize(_w, _h, ctx): void {
      resizeCalls.push('reported');
      ctx.engine.fail('reported', 'resize', new Error('reported without throwing'));
    },
  });
  addLifecycle(resizeRegistry, 'later', {
    resize(): void {
      resizeCalls.push('later');
    },
  });
  resized.events.on('resize', (): number => resizeCalls.push('event'));
  resized.resize();
  assert(resized.error);
  assert.equal(resized.error.message, 'reported without throwing');
  assert.deepEqual(
    resizeCalls,
    ['reported'],
    'skip later hooks and notification after explicit failure'
  );

  // An asynchronous terminal failure during init must not mount later systems
  // or allow start() to schedule gameplay after the initialization rejection.
  const { engine: boot, registry: bootRegistry } = createCoreFixture();
  const failures: EngineError[] = [];
  let laterInit = false;
  boot.events.on('engine:error', (event): number => failures.push(event));
  addLifecycle(bootRegistry, 'render', {
    async init(ctx): Promise<void> {
      await Promise.resolve();
      ctx.engine.fail('render', 'deviceLost', new Error('lost during init'));
    },
  });
  addLifecycle(
    bootRegistry,
    'later',
    {
      init(): void {
        laterInit = true;
      },
    },
    ['render']
  );
  await assert.rejects(boot.init(), /lost during init/);
  boot.fail('render', 'deviceLost', new Error('duplicate notification'));
  boot.start();
  assert.equal(laterInit, false);
  assert.equal(boot._running, false);
  assert.equal(boot.input.enabled, false);
  assert.deepEqual(failures, [boot.error]);
  assert(boot.error);
  assert.equal(boot.error.message, 'lost during init');
} finally {
  console.error = log;
}

// The asset loader must not swallow mandatory navigation download failures.
const fetch = globalThis.fetch;
try {
  const models = new ModelSystem();
  models._loadWorldGLB = async (): Promise<GLTF> =>
    new GLTFLoader().parseAsync(
      JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }),
      ''
    );
  let meta: { version: number; assets: { visual: string; collision: string; nav?: string } } = {
    version: 2,
    assets: { visual: 'visual', collision: 'collision', nav: 'nav.gz' },
  };
  globalThis.fetch = async (input): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    return url.endsWith('level.json') ? Response.json(meta) : new Response(null, { status: 503 });
  };
  await assert.rejects(models._prefetchWorld(), /HTTP 503/, 'retain the real load failure');
  meta = { version: 2, assets: { visual: 'visual', collision: 'collision' } };
  await assert.rejects(models._prefetchWorld(), /missing navigation asset/);
} finally {
  globalThis.fetch = fetch;
}
console.log('ok  terminal engine failure and mandatory navigation');
