#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function distribution(values) {
  if (!values.length) return null;
  assert(values.every(Number.isFinite), 'nonfinite latency');
  const a = values.slice().sort((x, y) => x - y);
  const at = p => +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(4);
  return { n: a.length, min: at(0), p50: at(.5), p95: at(.95), p99: at(.99), max: at(1),
    mean: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(4) };
}

export function analyzeLatency(report) {
  assert.equal(report.failure, null, 'failed profile is not a successful benchmark');
  const data = report.workerLatency;
  if (!data) return { instrumented: false, frames: report.summary, shots: report.combat.aiShots };
  assert.equal(data.outstandingEchoes, 0); assert.equal(data.outstandingQueries, 0);
  const queries = data.rows.filter(r => r.frame !== null && r.frame >= 0);
  const delivered = queries.filter(r => r.delivered !== null);
  assert(delivered.length, 'no measured queries');
  const segments = r => ({
    assembly: r.posted - r.created,
    outbound: r.worker.received - r.posted,
    intake: r.worker.queued - r.worker.received,
    queue: r.worker.started - r.worker.queued,
    compute: r.worker.ended - r.worker.started,
    packaging: r.worker.posted - r.worker.ended,
    delivery: r.delivered - r.worker.posted,
    total: r.delivered - r.created,
    postCall: r.postReturned - r.posted,
  });
  const parts = delivered.map(r => {
    const p = segments(r);
    for (const value of Object.values(p)) assert(Number.isFinite(value) && value >= -.25, 'clock/order mismatch exceeds 0.25 ms');
    const sum = p.assembly + p.outbound + p.intake + p.queue + p.compute + p.packaging + p.delivery;
    assert(Math.abs(sum - p.total) < .001, 'latency decomposition does not close');
    return p;
  });
  const phases = Object.fromEntries(Object.keys(parts[0]).map(key => [key, distribution(parts.map(p => p[key]))]));
  const overlap = delivered.map(r => data.frames.reduce((sum, f) => sum +
    Math.max(0, Math.min(r.delivered, f.end) - Math.max(r.worker.posted, f.start)), 0));
  const deliveryTotal = parts.reduce((s, p) => s + p.delivery, 0);
  const echoes = {};
  for (const phase of new Set(data.echoes.map(r => r.phase))) {
    const rows = data.echoes.filter(r => r.phase === phase && (r.frame === null || r.frame >= 0));
    assert(rows.every(r => r.delivered !== null), 'undelivered echo');
    echoes[phase] = {
      roundTrip: distribution(rows.map(r => r.delivered - r.posted)),
      outbound: distribution(rows.map(r => r.worker.received - r.posted)),
      delivery: distribution(rows.map(r => r.delivered - r.worker.posted)),
    };
    if (phase.startsWith('idle-hold-')) {
      const hold = Number(phase.slice(10));
      assert(echoes[phase].roundTrip.p50 >= hold - .25, 'positive busy control failed');
    }
  }
  const chain = data.echoes.filter(r => r.phase === 'idle-chain');
  const paired = data.frames.filter(f => f.i >= 0).map(f => {
    const before = data.echoes.find(r => r.phase === 'before-step' && r.frame === f.i);
    const after = data.echoes.find(r => r.phase === 'after-step' && r.frame === f.i);
    return before && after ? { frameMs: f.end - f.start,
      rttDifference: (before.delivered - before.posted) - (after.delivered - after.posted),
      deliverySeparation: after.delivered - before.delivered } : null;
  }).filter(Boolean);
  const decisionDetails = data.decisions?.map(d => {
    const jobs = data.rows.filter(r => r.actor === d.actor && r.kind === d.kind && r.scopeStarted === d.scopeStarted);
    return { ...d, jobs: jobs.length, submissionFrames: [...new Set(jobs.map(r => r.frame))],
      observedWorkerMs: jobs.filter(r => r.delivered !== null).reduce((s, r) => s + r.ms, 0),
      unreturned: jobs.filter(r => r.delivered === null).length };
  }) ?? null;
  const uses = delivered.filter(r => r.consumed !== null);
  const originalUses = uses.filter(r => r.originalScopeConsumed);
  const retries = delivered.filter(r => r.firstRetry !== null);
  return { instrumented: true, phases, echoes,
    idleChain: chain.length ? { n: chain.length, elapsedMs: chain.at(-1).delivered - chain[0].posted,
      amortizedMs: (chain.at(-1).delivered - chain[0].posted) / chain.length } : null,
    pairedEcho: paired.length ? { n: paired.length, frameMs: distribution(paired.map(p => p.frameMs)),
      rttDifference: distribution(paired.map(p => p.rttDifference)), deliverySeparation: distribution(paired.map(p => p.deliverySeparation)) } : null,
    decisionDetails,
    queries: queries.length, delivered: delivered.length, stale: delivered.filter(r => r.stale).length,
    deliveryWaitOverlappingMainFrameFraction: deliveryTotal ? overlap.reduce((a, b) => a + b, 0) / deliveryTotal : null,
    deliveredToOriginalRetry: distribution(retries.map(r => r.firstRetry - r.delivered)),
    deliveredToAnyCacheUse: distribution(uses.map(r => r.consumed - r.delivered)),
    deliveredToOriginalScopeUse: distribution(originalUses.map(r => r.consumed - r.delivered)),
    noObservedRetry: delivered.length - retries.length, noObservedCacheUse: delivered.length - uses.length,
    otherScopeCacheUses: uses.length - originalUses.length,
    longest: delivered.slice().sort((a, b) => (b.delivered - b.created) - (a.delivered - a.created)).slice(0, 5).map(r => ({ ...r, segments: segments(r) })),
    frameSummary: report.summary, shots: report.combat.aiShots,
    decisions: report.worker.samples.filter(s => s.type === 'decision'), pendingDecisions: report.worker.pendingDecisions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert(process.argv.length > 2, 'usage: node tools/analyze-worker-latency.mjs report.json [...]');
  const results = Object.fromEntries(process.argv.slice(2).map(path => [path, analyzeLatency(JSON.parse(readFileSync(path, 'utf8')))]));
  console.log(JSON.stringify(results, null, 2));
}
