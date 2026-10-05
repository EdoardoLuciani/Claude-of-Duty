import assert from 'node:assert/strict';
import { Engine } from '../../src/core/engine.js';
import { ModelSystem } from '../../src/core/models.js';
import { WeaponMaterialsNode } from '../../src/weapons/materials-tsl.js';

// A partial update is terminal: later gameplay hooks and later frames cannot
// continue mutating the simulation, even if something tries to unpause it.
const log = console.error;
console.error = () => {};
try {
  for (const phase of ['fixedUpdate', 'update', 'lateUpdate', 'render']) {
    const engine = new Engine({ canvas: {}, config: { fov: 80, deterministic: true, sensitivity: .001 } });
    const calls = [], errors = [];
    const sys = { constructor: { id: 'broken' } };
    for (const method of ['fixedUpdate', 'update', 'lateUpdate']) sys[method] = () => {
      calls.push(method);
      if (method === phase) throw new Error(`broken ${phase}`);
    };
    engine.registry.add(sys);
    engine.registry.add({ constructor: { id: 'after' },
      fixedUpdate: () => calls.push('after-fixed'), update: () => calls.push('after-update'),
      lateUpdate: () => calls.push('after-late') });
    let renders = 0;
    engine.registry.add({ constructor: { id: 'render' }, render() {
      renders++;
      if (phase === 'render') throw new Error('broken render');
    } });
    engine.events.on('engine:error', e => errors.push(e));
    engine._running = true;
    engine.step(20);
    assert.equal(errors.length, 1);
    assert.equal(engine.error.method, phase);
    assert.equal(engine.input.enabled, false);
    assert.equal(engine.input.frozen, true);
    assert.equal(engine.time.dt, 0);
    assert.equal(engine._accum, 0);
    if (phase !== 'render') assert.equal(calls.at(-1), phase, 'no later hook after failure');
    else assert.equal(engine._running, false, 'render failures stop the loop');
    const count = calls.length, elapsed = engine.time.elapsed;
    engine.time.scale = 1;
    engine.step(40);
    assert.equal(calls.length, count);
    assert.equal(engine.time.elapsed, elapsed);
    assert.equal(errors.length, 1);
    assert.equal(renders, 2, 'simulation failure does not prevent presentation');
  }
  for (const origin of ['update-event', 'external-event', 'resize-hook', 'resize-event']) {
    const engine = new Engine({ canvas: { clientWidth: 1280, clientHeight: 720 },
      config: { fov: 80, deterministic: true, sensitivity: .001 } });
    const calls = [], errors = [];
    const fault = () => { throw new Error(origin); };
    engine.events.on('damage:dealt', fault);
    engine.events.on('damage:dealt', () => calls.push('later listener'));
    engine.events.on('outer', () => {
      engine.events.emit('damage:dealt', {});
      calls.push('continued outer listener');
    });
    // A broken diagnostic subscriber cannot prevent the modal/recorder receiving
    // the original failure or replace it with a recursive engine:error failure.
    engine.events.on('engine:error', () => { throw new Error('broken diagnostic'); });
    engine.events.on('engine:error', e => errors.push(e));
    engine.registry.add({ constructor: { id: 'broken' },
      update() {
        engine.events.emit('outer', {});
        calls.push('continued update');
      },
      resize: origin === 'resize-hook' ? fault : () => {},
    });
    engine.registry.add({ constructor: { id: 'after' },
      update: () => calls.push('later update'), resize: () => calls.push('later resize') });
    engine.events.on('resize', origin === 'resize-event' ? fault : () => calls.push('resize notification'));
    engine.events.on('resize', () => calls.push('later resize listener'));
    if (origin === 'update-event') engine.step(20);
    else if (origin === 'external-event') assert.throws(() => engine.events.emit('outer', {}), /external-event/);
    else engine.resize();
    assert.equal(engine.error.message, origin);
    assert.equal(engine.error.system, origin === 'resize-hook' ? 'broken' : 'events');
    assert.equal(engine.error.method, origin === 'resize-hook' || origin === 'resize-event' ? 'resize' : 'damage:dealt');
    // The successful hook before a resize notification is allowed; nothing after
    // the exception, including the second resize listener, may execute.
    assert.deepEqual(calls, origin === 'resize-event' ? ['later resize'] : []);
    const count = calls.length, elapsed = engine.time.elapsed;
    engine.time.scale = 1;
    engine.resize(); engine.step(40); engine.step(60);
    assert.equal(calls.length, count);
    assert.equal(engine.time.elapsed, elapsed);
    assert.deepEqual(errors, [engine.error]);
  }
  // An asynchronous terminal failure during init must not mount later systems
  // or allow start() to schedule gameplay after the initialization rejection.
  const boot = new Engine({ canvas: {}, config: { fov: 80, deterministic: true } });
  const failures = [];
  let laterInit = false;
  boot.events.on('engine:error', event => failures.push(event));
  boot.registry.add({ constructor: { id: 'render' }, async init(ctx) {
    await Promise.resolve();
    ctx.engine.fail('render', 'deviceLost', new Error('lost during init'));
  } });
  boot.registry.add({ constructor: { id: 'later', deps: ['render'] }, init() { laterInit = true; } });
  await assert.rejects(boot.init(), /lost during init/);
  boot.fail('render', 'deviceLost', new Error('duplicate notification'));
  boot.start();
  assert.equal(laterInit, false);
  assert.equal(boot._running, false);
  assert.equal(boot.input.enabled, false);
  assert.deepEqual(failures, [boot.error]);
  assert.equal(boot.error.message, 'lost during init');
} finally { console.error = log; }

// The asset loader must not swallow mandatory navigation download failures.
const fetch = globalThis.fetch;
try {
  const models = new ModelSystem();
  models._loadWorldGLB = async () => ({});
  let meta = { version: 2, assets: { visual: 'visual', collision: 'collision', nav: 'nav.gz' } };
  globalThis.fetch = async url => url.endsWith('level.json')
    ? { ok: true, json: async () => meta } : { ok: false, status: 503 };
  await assert.rejects(models._prefetchWorld(), /HTTP 503/, 'retain the real load failure');
  meta = { version: 2, assets: { visual: 'visual', collision: 'collision' } };
  await assert.rejects(models._prefetchWorld(), /missing navigation asset/);
} finally { globalThis.fetch = fetch; }
const materials = new WeaponMaterialsNode({ get: () => ({}) });
assert.throws(() => materials.get('misspelled-surface'), /unknown material/);
materials.dispose();
console.log('ok  terminal engine failure, mandatory navigation and explicit material names');
