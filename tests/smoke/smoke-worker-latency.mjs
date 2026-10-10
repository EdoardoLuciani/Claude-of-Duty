import assert from 'node:assert/strict';
import { analyzeLatency, distribution } from '../../tools/analyze-worker-latency.mjs';
import { measureWorkerLatency } from '../../tools/lib/worker-latency.js';

const row = { frame: 0, created: 0, posted: 1, postReturned: 1.1,
  worker: { received: 2, queued: 3, started: 5, ended: 8, posted: 9 },
  delivered: 15, firstRetry: 20, consumed: 21, originalScopeConsumed: true, stale: false };
const report = {
  failure: null, summary: {}, combat: { aiShots: 1 }, worker: { samples: [], pendingDecisions: [] },
  workerLatency: { outstandingEchoes: 0, outstandingQueries: 0,
    rows: [row], frames: [{ start: 0, end: 14 }], echoes: [] },
};
const result = analyzeLatency(report);
assert.equal(result.phases.assembly.p50, 1);
assert.equal(result.phases.outbound.p50, 1);
assert.equal(result.phases.intake.p50, 1);
assert.equal(result.phases.queue.p50, 2);
assert.equal(result.phases.compute.p50, 3);
assert.equal(result.phases.packaging.p50, 1);
assert.equal(result.phases.delivery.p50, 6);
assert.equal(result.phases.total.p50, 15);
assert.equal(result.deliveryWaitOverlappingMainFrameFraction, 5 / 6);
assert.equal(result.deliveredToOriginalRetry.p50, 5);
assert.equal(result.deliveredToOriginalScopeUse.p50, 6);
assert.equal(distribution([]), null);

const censored = structuredClone(report);
censored.workerLatency.rows[0].firstRetry = null;
censored.workerLatency.rows[0].consumed = null;
const missing = analyzeLatency(censored);
assert.equal(missing.deliveredToOriginalRetry, null);
assert.equal(missing.deliveredToOriginalScopeUse, null);
assert.equal(missing.noObservedRetry, 1);
assert.equal(missing.noObservedCacheUse, 1);
const reused = structuredClone(report);
reused.workerLatency.rows[0].originalScopeConsumed = false;
assert.equal(analyzeLatency(reused).otherScopeCacheUses, 1);
assert.equal(analyzeLatency(reused).deliveredToOriginalScopeUse, null);

const badClock = structuredClone(report);
badClock.workerLatency.rows[0].worker.received = -100;
assert.throws(() => analyzeLatency(badClock), /clock\/order mismatch/);
const badTrace = structuredClone(report);
delete badTrace.workerLatency.rows[0].worker.queued;
assert.throws(() => analyzeLatency(badTrace), /clock\/order mismatch/);
assert.throws(() => analyzeLatency({ ...report, failure: 'failed boot' }), /failed profile/);
const falseControl = structuredClone(report);
falseControl.workerLatency.echoes.push({ phase: 'idle-hold-8', frame: null, posted: 0,
  delivered: 1, worker: { received: .1, posted: .2 } });
assert.throws(() => analyzeLatency(falseControl), /positive busy control failed/);
// Exercise the browser wrapper with a bounded fake, including false cache reads,
// replacement scopes, ownership restoration and initialization failure cleanup.
const savedIsolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
globalThis.crossOriginIsolated = false;
try {
  const clock = () => performance.timeOrigin + performance.now();
  let id = 0, throws = false;
  const listeners = new Set();
  const worker = {
    addEventListener(_name, listener) { listeners.add(listener); },
    removeEventListener(_name, listener) { listeners.delete(listener); },
    postMessage(data) {
      if (throws) throw new Error('original posting error');
      const received = clock();
      queueMicrotask(() => {
        if (data.type === 'latency-probe') {
          for (const listener of listeners) listener({ data: { type: data.type, id: data.id, received, posted: received } });
        } else if (data.type === 'queries') {
          for (const job of data.jobs) service.receive({ type: 'result', id: job.id, value: false, ms: 0, moves: 1,
            trace: { received, queued: received, started: received, ended: received, posted: received } });
        }
      });
    },
  };
  const service = {
    worker, ready: true, jobs: new Map(), scopes: new Map(), proofs: new Map(), current: null,
    record() {},
    receive(message) {
      const job = this.jobs.get(message.id);
      this.proofs.set(job.key.join(','), message.value); this.jobs.delete(message.id);
    },
    run(actor, kind, fn) {
      const key = `${actor}:${kind}`;
      if (!this.scopes.has(key)) this.scopes.set(key, { actor, kind, started: performance.now() });
      this.current = this.scopes.get(key);
      try { return fn(); } finally { this.current = null; }
    },
    request(from, to, radius, height, maxSteps) {
      const key = [from.x, from.y, from.z, to.x, to.y, to.z, radius, height, maxSteps];
      if (this.proofs.has(key.join(','))) return this.proofs.get(key.join(','));
      const job = { id: ++id, key, scope: this.current, sent: performance.now() };
      this.jobs.set(id, job); worker.postMessage({ type: 'queries', jobs: [{ id, key, actor: this.current.actor }] });
      return false;
    },
  };
  const engine = { ctx: { get: () => ({ grid: { worker: service }, agents: [] }) } };
  const oldRequest = service.request, oldPost = worker.postMessage;
  const unrelated = () => {};
  listeners.add(unrelated);
  const probe = await measureWorkerLatency(engine);
  const from = { x: 0, y: 0, z: 0 }, to = { x: 1, y: 0, z: 0 };
  const request = () => service.request(from, to, .36, 1.8, 80);
  probe.before(0); service.run(1, 'path', request); probe.after();
  await Promise.resolve();
  assert.equal(service.run(1, 'path', request), false);
  assert.notEqual(probe.snapshot().rows[0].consumed, null, 'cached failure is consumption too');
  assert.notEqual(probe.snapshot().rows[0].firstRetry, null);
  assert.equal(probe.snapshot().rows[0].originalScopeConsumed, true);
  to.x = 2;
  service.run(1, 'path', request); await Promise.resolve();
  service.scopes.delete('1:path');
  service.run(1, 'path', request);
  const replaced = probe.snapshot().rows[1];
  assert.equal(replaced.firstRetry, null, 'new scope is not an old intent retry');
  assert.equal(replaced.retryScopeReplaced, true);
  assert.equal(replaced.originalScopeConsumed, false);
  await probe.finish(); probe.dispose();
  assert.equal(service.request, oldRequest); assert.equal(worker.postMessage, oldPost);
  assert.deepEqual([...listeners], [unrelated]);
  throws = true;
  await assert.rejects(() => measureWorkerLatency(engine), /original posting error/);
  assert.deepEqual([...listeners], [unrelated]);
} finally {
  if (savedIsolation) Object.defineProperty(globalThis, 'crossOriginIsolated', savedIsolation);
  else delete globalThis.crossOriginIsolated;
}
console.log('worker latency phases, clocks, controls, scope identity and cleanup: OK');
