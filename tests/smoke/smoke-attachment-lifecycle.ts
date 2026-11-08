import assert from 'node:assert/strict';
import { mock } from 'node:test';

import { Vector3 } from 'three';

import { querySnapshot } from '#query-snapshot';

import { AttachmentQueries, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/attachment-queries.ts';
import type { ClientMessage } from '../../src/ai/attachment-types.ts';
import { parseSnapshotCopy } from '../../src/ai/attachment-types.ts';
import type { SurfaceNav } from '../../src/ai/nav.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { CharacterController } from '../../src/physics/character.ts';
import type { PhysicsSystem } from '../../src/physics/index.ts';
import { MASK } from '../../src/physics/surfaces.ts';
import { NativeWorker } from '../../tools/lib/attachment-worker-fixture.ts';
import { MovementWorker } from '../lib/ai-movement-fixture.ts';
import { fixture } from '../lib/fixture.ts';

const turn = (): Promise<void> => new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, 0));
function makeWorld(): StaticWorld {
  const world = new StaticWorld();
  world.addTriangles(
    new Float32Array([-3, 0, -3, -3, 0, 3, 3, 0, 3, 3, 0, 3, 3, 0, -3, -3, 0, -3]),
    2,
    'concrete'
  );
  world.build();
  return world;
}
function makeNav(): SurfaceNav {
  const world = makeWorld();
  return fixture<SurfaceNav>({
    physics: fixture<PhysicsSystem>({
      staticWorld: world,
      gravity: -20,
      MASK: { ...MASK, CHARACTER: 259 },
    }),
    _probe: new CharacterController(world),
    repeatState: true,
  });
}

const from = new Vector3(),
  to = new Vector3(1, 0, 0);
const run = (s: AttachmentQueries): unknown =>
  s.run(1, 'path', (): boolean => s.request(from, to, 0.36, 1.8, 80));

// Observe only the production deadline timers; drive expiry without ten seconds
// of test latency, and prove every success/error/cancellation clears its timer.
const realSet = globalThis.setTimeout,
  realClear = globalThis.clearTimeout;
const deadlines = new Map<Parameters<typeof clearTimeout>[0], () => void>();
function captureTimeout(
  fn: (...args: unknown[]) => void,
  delay?: number,
  ...args: unknown[]
): ReturnType<typeof setTimeout> {
  const token = realSet(fn, delay, ...args);
  if (delay === 10000) {
    realClear(token);
    deadlines.set(token, (): void => fn(...args));
  }
  return token;
}
const timeoutMock = mock.method(globalThis, 'setTimeout', captureTimeout);
globalThis.clearTimeout = (timer): void => {
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
    let worker: MovementWorker | undefined;
    const s = new AttachmentQueries(makeNav(), {
      workerFactory: (): MovementWorker => {
        if (mode === 'factory') throw new Error('factory failure');
        return (worker = new MovementWorker({
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
        else {
          assert(worker);
          worker.deliver({ type: 'result', id: 1, value: true, ms: 0, moves: 0 });
        }
        await assert.rejects(started, /deadline|before readiness/);
      } else {
        await started;
        if (mode === 'queries') assert.throws((): unknown => run(s), /send queries/);
        else if (mode === 'cancel') {
          assert.equal(run(s), NAV_PENDING);
          assert.throws((): void => s.cancel('1:path'), /send cancel/);
        } else {
          assert(worker);
          worker.deliver({ type: 'ready' });
        }
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
      assert.throws((): unknown => run(s), /failure|send|deadline|readiness/);
      await assert.rejects(s.start(), /failure|send|deadline|readiness/);
    } finally {
      s.dispose();
    }
  }

  const workers: MovementWorker[] = [];
  const s = new AttachmentQueries(makeNav(), {
    workerFactory: (): MovementWorker => {
      const worker = new MovementWorker({ silent: true });
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
  assert(lateFirst);
  lateFirst.call(workers[0], new MessageEvent('message', { data: { type: 'ready' } }));
  assert.equal(s.ready, false, 'old ready cannot finish new initialization');
  workers[1].deliver({ type: 'ready' });
  await second;
  assert(s.ready);
  const third = s.start();
  await turn();
  const lateThird = workers[2].onmessage;
  s.dispose();
  await third;
  assert(lateThird);
  lateThird.call(workers[2], new MessageEvent('message', { data: { type: 'ready' } }));
  assert.equal(s.ready, false, 'disposal settles init and ignores late delivery');
  assert.equal(deadlines.size, 0);
} finally {
  timeoutMock.mock.restore();
  globalThis.clearTimeout = realClear;
}

// Used-length copies have private buffers and preserve every reachable element.
const world = makeWorld();
const copy = parseSnapshotCopy(await querySnapshot(world));
assert(copy);
for (const key of [
  'pos',
  'nrm',
  'surface',
  'mask',
  'object',
  'triIndex',
  'nodeBounds',
  'nodeMeta',
  '_taabb',
] as const) {
  const array: Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array =
    copy.snapshot[key];
  assert.notEqual(array.buffer, world[key].buffer);
  assert.deepEqual(array, world[key].subarray(0, array.length));
}
assert.equal(copy.snapshot.nodeBounds.length, world.nodeCount * 6);
assert.equal(copy.snapshot.nodeMeta.length, world.nodeCount * 2);
assert(copy.snapshot.nodeBounds.length < world.nodeBounds.length);
structuredClone(copy.snapshot, { transfer: copy.transfer });
assert(copy.transfer.every((b): boolean => b.byteLength === 0));
assert(world.pos.byteLength > 0);

// Force a copy yield on each chunk, independent of machine speed.
let clock = 0;
const clockMock = mock.method(performance, 'now', (): number => (clock += 3));
try {
  for (const change of ['version', 'dirty', 'dispose', 'cancel']) {
    const world = makeWorld();
    let current = true;
    const pending = querySnapshot(world, (): boolean => current);
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
      workerFactory: (): MovementWorker => {
        constructed = true;
        return new MovementWorker();
      },
    });
    const pending = s.start();
    if (replacement === 'world') {
      const replacement = makeWorld();
      assert.equal(replacement.version, nav.physics.staticWorld.version);
      nav.physics.staticWorld = replacement;
      assert(nav._probe);
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
  clockMock.mock.restore();
}

for (const duringScope of [false, true]) {
  const nav = makeNav();
  const worker = new MovementWorker();
  const s = new AttachmentQueries(nav, { workerFactory: (): MovementWorker => worker });
  await s.start();
  assert.equal(run(s), NAV_PENDING);
  worker.deliver({ type: 'result', id: [...s.jobs.keys()][0], value: true, ms: 0, moves: 0 });
  assert.equal(run(s), true);
  if (!duringScope) nav.physics.staticWorld.dispose();
  const result = s.run(1, 'path', (): boolean => {
    if (duringScope) nav.physics.staticWorld.dispose();
    return s.request(from, to, 0.36, 1.8, 80);
  });
  assert.equal(result, NAV_CANCELLED, 'disposed source cannot reuse ordinary cached success');
  assert.equal(s.proofs.size, 0);
  assert.equal(s.jobs.size, 0);
  s.dispose();
}

// Duplicate init must not rebind an oracle with old queries still queued.
const transport = new NativeWorker({ record: true });
const s = new AttachmentQueries(makeNav(), {
  workerFactory: (): NativeWorker => transport,
});
try {
  await s.start();
  const init = transport.messages.find(
    (m): m is Extract<ClientMessage, { type: 'init' }> => m.type === 'init'
  );
  assert(init);
  transport.batch([
    { type: 'queries', jobs: [{ id: 900001, actor: 1, key: [0, 0, 0, 1, 0, 0, 0.36, 1.8, 80] }] },
    init,
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
