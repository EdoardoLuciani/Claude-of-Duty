import assert from 'node:assert/strict';
import { Engine } from '../src/core/engine.js';
import { ModelSystem } from '../src/core/models.js';
import { WeaponMaterials } from '../src/weapons/materials.js';

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
const materials = new WeaponMaterials({ get: () => ({ get: () => ({}) }) });
assert.throws(() => materials.get('misspelled-surface'), /unknown material/);
materials.dispose();
console.log('ok  terminal engine failure, mandatory navigation and explicit material names');
