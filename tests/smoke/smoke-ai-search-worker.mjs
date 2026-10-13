import assert from 'node:assert/strict';
import { testNav } from '../../tools/lib/test-nav.mjs';
import { makeAgent, makeAi, makeRng } from '../../tools/lib/agent-fixture.mjs';
import { AttachmentQueries, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/attachment-queries.js';

class FakeWorker {
  messages = [];
  postMessage(message) {
    this.messages.push(structuredClone(message));
    if (message.type === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready' } }));
  }
  terminate() {}
}
const nav = await testNav(), oracle = await testNav();
const agent = () => {
  const rng = makeRng(); let draws = 0;
  const float = rng.float;
  rng.float = () => { draws++; return float.call(rng); };
  const a = makeAgent({ ai: makeAi(nav), phys: nav.physics, rng });
  a.position.set(-.5, .008, .5);
  a._searchOrigin.copy(a.position).addScalar(.5); a._searchOrigin.y = .008;
  return { a, draws: () => draws };
};
let checks = 0, moves = 0;
const check = nav._checkAttachment, move = nav._probe.move;
nav._checkAttachment = function (...args) { checks++; return check.apply(this, args); };
nav._probe.move = function (...args) { moves++; return move.apply(this, args); };
const baseline = agent();
assert.equal(baseline.a._buildSearchCandidates(), undefined);
const expected = baseline.a._searchCand.slice(0, baseline.a._searchCount).map(p => p.toArray());
assert.equal(checks, 5); assert.equal(moves, 10, 'original ready-but-unscoped repro ran ten native moves');
nav.worker = new AttachmentQueries(nav, { workerFactory: () => new FakeWorker() });
const worker = nav.worker;
const respond = () => {
  for (const job of worker.jobs.values()) {
    const [x, y, z, tx, ty, tz, radius, height, steps] = job.key;
    const value = oracle._checkAttachment({ x, y, z }, { x: tx, y: ty, z: tz }, radius, height, steps);
    worker.receive({ type: 'result', id: job.id, value, ms: 0, moves: 0 });
  }
};
const complete = a => {
  let result;
  for (let tries = 0; tries < 40; tries++) {
    result = a._buildSearchCandidates();
    if (result !== NAV_PENDING && result !== NAV_CANCELLED) return result;
    respond();
  }
  assert.fail('search failed to complete within bounded retries');
};
try {
  const trial = agent(), a = trial.a;
  checks = moves = 0;
  assert.equal(a._buildSearchCandidates(), NAV_PENDING, 'not ready must not evaluate synchronous eligibility');
  assert.equal(worker.stats.submitted, 0); assert.equal(trial.draws(), 0);
  await worker.start();
  assert.equal(a._buildSearchCandidates(), NAV_PENDING);
  assert.equal(checks, 0); assert.equal(moves, 0); assert.equal(worker.stats.submitted, 1);
  assert.equal(a.hasMoveTarget || a.pathPending, false, 'partial candidates cannot admit movement');
  const scope = worker.scopes.get(`${a.id}:observation`), unsent = scope.unsent, used = scope.used;
  assert.equal(a._buildSearchCandidates(), NAV_PENDING);
  assert.equal(scope.unsent, unsent); assert.equal(scope.used, used, 'retry scratch is reused');
  assert.equal(worker.stats.submitted, 1, 'retry deduplicates the exact proof');
  respond();
  assert.equal(complete(a), undefined);
  assert.deepEqual(a._searchCand.slice(0, a._searchCount).map(p => p.toArray()), expected, 'completed worker candidates equal synchronous native candidates');
  assert.equal(trial.draws(), baseline.draws(), 'lazy geometry preserves seeded draw count');
  assert.equal(trial.a.rng.float(), baseline.a.rng.float(), 'next seeded draw also matches');
  assert.equal(checks, 0); assert.equal(moves, 0, 'oracle replay uses separate scratch, never gameplay main-thread motor');
  assert.equal(worker.samples.length, 0, 'normal play records no detailed samples');

  // A seeded ring point at the baked floor edge needs a nonzero attachment.
  // Delaying it must not change the draws used to construct that intent.
  const edge = agent().a; let edgeDraws = 0;
  edge._searchOrigin.set(9.7, .008, 9.7);
  edge.rng.float = () => ++edgeDraws % 2 ? .125 : (5.2 / 7 - .45) / .55;
  assert.equal(edge._buildSearchCandidates(), NAV_PENDING);
  const draws = edgeDraws, geometry = [...edge._searchGeometry];
  assert(draws > 0);
  for (let i = 0; i < 5; i++) assert.equal(edge._buildSearchCandidates(), NAV_PENDING);
  assert.equal(edgeDraws, draws); assert.deepEqual([...edge._searchGeometry], geometry, 'pending retries do not reroll geometry');
  complete(edge);
  assert.equal(edgeDraws, 24, 'duplicate candidates retain the original twelve-trial bound');
  assert.equal(checks, 0); assert.equal(moves, 0);
  worker.paused = true;
  assert.equal(a._buildSearchCandidates(), NAV_PENDING, 'pause cannot admit even cached proofs');
  worker.paused = false;

  worker.clear();
  a._clearSearch();
  a.position.x = -2.4;
  assert.equal(a._buildSearchCandidates(), NAV_PENDING);
  const oldId = [...worker.jobs.keys()][0];
  a.position.x += .01;
  assert.equal(a._buildSearchCandidates(), NAV_CANCELLED, 'moving live foot supersedes, not unreachable');
  assert.equal(worker.jobs.size, 0);
  worker.receive({ type: 'result', id: oldId, value: true, ms: 0, moves: 0 });
  assert.equal(worker.proofs.size, 0, 'cancelled response cannot resurrect a proof');
  assert.equal(a._buildSearchCandidates(), NAV_PENDING, 'later retry uses new exact foot');
  a._searchPending = true; a._searchUntil = 8; a.stateTime = 8; a.searchOutcome = 'active';
  const submitted = worker.stats.submitted;
  a._tickSearch(.05);
  assert.equal(a.searchOutcome, 'failed'); assert.equal(a._searchPending, false);
  assert.equal(worker.jobs.size, 0); assert.equal(worker.scopes.size, 0);
  assert.equal(worker.stats.submitted, submitted, 'expired search cancels before retry');
  assert.equal(a.hasMoveTarget || a.pathPending, false);

  const rebuilt = agent().a;
  rebuilt.lastKnown.copy(rebuilt._searchOrigin);
  rebuilt._goTo = () => assert.fail('pending candidate construction admitted a route');
  rebuilt._rebuildSearch();
  assert.equal(rebuilt._searchPending, true, 'search entry retains pending instead of using partial candidates');
  rebuilt._clearSearch();
  assert.equal(worker.jobs.size, 0, 'abandoned candidate intent cancels queued work');

  // Inaccessible evidence must scan observation points in the same scope, not
  // nest another run or invent a current-foot fallback while probes are pending.
  const elevated = agent().a;
  elevated._searchOrigin.y = 4;
  assert.equal(elevated._buildSearchCandidates(), NAV_PENDING);
  assert.equal(elevated._observationSearch, true);
  assert.equal(elevated.hasMoveTarget, false, 'pending observation output cannot admit a fallback move');
  complete(elevated);
  assert(elevated._searchCount > 0); assert.equal(elevated.hasMoveTarget, false);
  worker.failure(new Error('search transport failure'));
  assert.throws(() => elevated._buildSearchCandidates(), /search transport failure/);
  assert.equal(checks, 0, 'worker failure never falls back to synchronous eligibility');
  console.log('search worker: before 5 sync checks/10 native moves/0 submissions; after 0 sync checks/0 native moves/1 submission; native candidates/RNG, ready/pending/retry/cancel/expiry/observation/failure');
} finally {
  nav.dispose(); nav.physics.dispose(); oracle.dispose(); oracle.physics.dispose();
}
