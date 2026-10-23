import assert from 'node:assert/strict';

import { Vector3 } from 'three';

import { AttachmentQueries, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/attachment-queries.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { CharacterController } from '../../src/physics/character.ts';
import { querySnapshot } from '../../src/physics/query-snapshot.js';
import { NativeWorker } from '../../tools/lib/attachment-worker-fixture.mjs';

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
function makeWorld() {
  const world = new StaticWorld();
  world.addTriangles(
    new Float32Array([-3, 0, -3, -3, 0, 3, 3, 0, 3, 3, 0, 3, 3, 0, -3, -3, 0, -3]),
    2,
    'concrete'
  );
  world.build();
  return world;
}
function makeNav() {
  const world = makeWorld();
  return {
    physics: { staticWorld: world, gravity: -20, MASK: { CHARACTER: 259 } },
    _probe: new CharacterController(world),
  };
}
class FakeWorker {
  constructor({ silent = false, throws } = {}) {
    this.silent = silent;
    this.throws = throws;
  }
  postMessage(message) {
    if (message.type === this.throws) throw new Error(`send ${message.type}`);
    if (message.type === 'init' && !this.silent)
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
  }
  terminate() {
    this.terminated = true;
  }
}
const from = new Vector3(),
  to = new Vector3(1, 0, 0);
const run = (s) => s.run(1, 'path', () => s.request(from, to, 0.36, 1.8, 80));

// Observe only the production deadline timers; drive expiry without ten seconds
// of test latency, and prove every success/error/cancellation clears its timer.
const realSet = globalThis.setTimeout,
  realClear = globalThis.clearTimeout;
const deadlines = new Map();
globalThis.setTimeout = (fn, delay, ...args) => {
  if (delay !== 10000) return realSet(fn, delay, ...args);
  const token = {};
  deadlines.set(token, fn);
  return token;
};
globalThis.clearTimeout = (timer) => {
  if (!deadlines.delete(timer)) realClear(timer);
};
try {
  for (const mode of [
    'factory',
    'init',
    'queries',
    'cancel',
    'timeout',
    'early-result',
    'duplicate-ready',
  ]) {
    let worker;
    const s = new AttachmentQueries(makeNav(), {
      workerFactory: () => {
        if (mode === 'factory') throw new Error('factory failure');
        return (worker = new FakeWorker({
          silent: ['timeout', 'early-result'].includes(mode),
          throws: mode,
        }));
      },
    });
    try {
      const started = s.start();
      if (['factory', 'init'].includes(mode))
        await assert.rejects(started, /factory failure|send init/);
      else if (['timeout', 'early-result'].includes(mode)) {
        await turn();
        if (mode === 'timeout') [...deadlines.values()][0]();
        else worker.onmessage({ data: { type: 'result', id: 1, value: true, ms: 0, moves: 0 } });
        await assert.rejects(started, /deadline|before readiness/);
      } else {
        await started;
        if (mode === 'queries') assert.throws(() => run(s), /send queries/);
        else if (mode === 'cancel') {
          assert.equal(run(s), NAV_PENDING);
          assert.throws(() => s.cancel('1:path'), /send cancel/);
        } else worker.onmessage({ data: { type: 'ready' } });
      }
      assert(s.error, `${mode}: failure is terminal`);
      assert.equal(s.ready, false);
      assert.equal(s.jobs.size, 0);
      assert.equal(s.proofs.size, 0);
      assert.equal(deadlines.size, 0, `${mode}: no deadline leaks`);
      if (worker) {
        assert(worker.terminated);
        assert.equal(worker.onmessage, null);
      }
      assert.throws(() => run(s), /failure|send|deadline|readiness/);
      await assert.rejects(s.start(), /failure|send|deadline|readiness/);
    } finally {
      s.dispose();
    }
  }

  const workers = [];
  const s = new AttachmentQueries(makeNav(), {
    workerFactory: () => {
      const worker = new FakeWorker({ silent: true });
      workers.push(worker);
      return worker;
    },
  });
  const first = s.start();
  await turn();
  const lateFirst = workers[0].onmessage;
  const second = s.start();
  await turn();
  await first;
  lateFirst({ data: { type: 'ready' } });
  assert.equal(s.ready, false, 'old ready cannot finish new initialization');
  workers[1].onmessage({ data: { type: 'ready' } });
  await second;
  assert(s.ready);
  const third = s.start();
  await turn();
  const lateThird = workers[2].onmessage;
  s.dispose();
  await third;
  lateThird({ data: { type: 'ready' } });
  assert.equal(s.ready, false, 'disposal settles init and ignores late delivery');
  assert.equal(deadlines.size, 0);
} finally {
  globalThis.setTimeout = realSet;
  globalThis.clearTimeout = realClear;
}

// Used-length copies have private buffers and preserve every reachable element.
const world = makeWorld();
const copy = await querySnapshot(world);
for (const [key, array] of Object.entries(copy.snapshot)) {
  if (!ArrayBuffer.isView(array)) continue;
  assert.notEqual(array.buffer, world[key].buffer);
  assert.deepEqual(array, world[key].subarray(0, array.length));
}
assert.equal(copy.snapshot.nodeBounds.length, world.nodeCount * 6);
assert.equal(copy.snapshot.nodeMeta.length, world.nodeCount * 2);
assert(copy.snapshot.nodeBounds.length < world.nodeBounds.length);
structuredClone(copy.snapshot, { transfer: copy.transfer });
assert(copy.transfer.every((b) => b.byteLength === 0));
assert(world.pos.byteLength > 0);

// Force a copy yield on each chunk, independent of machine speed.
const realNow = performance.now;
let clock = 0;
performance.now = () => (clock += 3);
try {
  for (const change of ['version', 'dirty', 'dispose', 'cancel']) {
    const world = makeWorld();
    let current = true;
    const pending = querySnapshot(world, () => current);
    if (change === 'version') world.version++;
    else if (change === 'dirty') world.dirty = true;
    else if (change === 'dispose') world.dispose();
    else current = false;
    assert.equal(await pending, null, `${change} during copy aborts`);
  }
  for (const replacement of ['world', 'controller']) {
    const nav = makeNav();
    let constructed = false;
    const s = new AttachmentQueries(nav, {
      workerFactory: () => {
        constructed = true;
        return new FakeWorker();
      },
    });
    const pending = s.start();
    if (replacement === 'world') {
      const replacement = makeWorld();
      assert.equal(replacement.version, nav.physics.staticWorld.version);
      nav.physics.staticWorld = replacement;
      nav._probe.world = replacement;
    } else nav._probe = new CharacterController(nav.physics.staticWorld);
    await pending;
    assert.equal(constructed, false, `${replacement} identity checked after yield`);
    assert.equal(s.ready, false);
    await s.start();
    assert(s.ready);
    s.dispose();
  }
} finally {
  performance.now = realNow;
}

for (const duringScope of [false, true]) {
  const nav = makeNav();
  let worker;
  const s = new AttachmentQueries(nav, { workerFactory: () => (worker = new FakeWorker()) });
  await s.start();
  assert.equal(run(s), NAV_PENDING);
  worker.onmessage({
    data: { type: 'result', id: [...s.jobs.keys()][0], value: true, ms: 0, moves: 0 },
  });
  assert.equal(run(s), true);
  if (!duringScope) nav.physics.staticWorld.dispose();
  const result = s.run(1, 'path', () => {
    if (duringScope) nav.physics.staticWorld.dispose();
    return s.request(from, to, 0.36, 1.8, 80);
  });
  assert.equal(result, NAV_CANCELLED, 'disposed source cannot reuse ordinary cached success');
  assert.equal(s.proofs.size, 0);
  assert.equal(s.jobs.size, 0);
  s.dispose();
}

// Duplicate init must not rebind an oracle with old queries still queued.
let transport;
const s = new AttachmentQueries(makeNav(), {
  workerFactory: () => (transport = new NativeWorker({ record: true })),
});
try {
  await s.start();
  transport.batch([
    { type: 'queries', jobs: [{ id: 900001, actor: 1, key: [0, 0, 0, 1, 0, 0, 0.36, 1.8, 80] }] },
    transport.messages.find((m) => m.type === 'init'),
  ]);
  const deadline = performance.now() + 2000;
  while (!s.error && performance.now() < deadline) await turn();
  assert.match(s.error?.message ?? '', /duplicate initialization/);
  assert.equal(transport.results.length, 0, 'malformed lifecycle fails before queued native work');
} finally {
  s.dispose();
}
console.log(
  'attachment lifecycle: typed transport failures/deadlines, restart/late delivery, private used-length snapshots, mid-copy invalidation and source-disposal safety'
);
