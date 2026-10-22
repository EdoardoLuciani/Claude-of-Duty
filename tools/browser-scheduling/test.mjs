import assert from 'node:assert/strict';
import test from 'node:test';

import { check } from './check.mjs';
import { parseStat, cpuDelta } from './processes.mjs';
import { replaceOnce } from './source.mjs';
test('pinned replacements reject missing/duplicate matches', () => {
  assert.equal(replaceOnce('one xyz two', 'xyz', 'new'), 'one new two');
  assert.throws(() => replaceOnce('one', 'xyz', 'new'));
  assert.throws(() => replaceOnce('xyz xyz', 'xyz', 'new'));
});
test('proc stat names can contain whitespace and parentheses', () => {
  const fields = Array(22).fill('0');
  fields[0] = 'S';
  fields[1] = '100';
  fields[11] = '123';
  fields[12] = '45';
  fields[19] = '987';
  assert.deepEqual(parseStat('123 (Web (Content)) ' + fields.join(' ')), {
    pid: 123,
    comm: 'Web (Content)',
    ppid: 100,
    ticks: 168,
    start: '987',
  });
});
test('PID reuse/disappearance is not silently counted as CPU savings', () => {
  const before = [
    { pid: 1, start: '1', ticks: 100 },
    { pid: 2, start: '2', ticks: 100 },
  ];
  const result = cpuDelta(before, [{ pid: 1, start: 'NEW', ticks: 1 }], 900);
  assert(result.every((r) => r.missingAtEnd && r.msPerFrame === null));
});
function report() {
  return {
    datasetSha256: 'dataset',
    originalSourceSha256: 'source',
    clientSha256: 'client',
    width: 1920,
    height: 1080,
    frames: 1,
    warmup: 120,
    inFlight: 8,
    dpr: 1,
    visibility: 'visible',
    hasFocus: true,
    primaryEligible: true,
    completed: 1,
    scheduled: 1,
    scheduler: 'raf',
    errors: [],
    presentationCount: null,
    setup: { adapterInfo: { fallback: false }, isolated: true },
    renderNodes: [{ vendor: '0x1002', device: '0x7550' }],
    msPerFrame: 1,
    samples: [{ draws: [1, 2, 3, 4, 5], triangles: [3, 6, 9, 12, 15] }],
  };
}
test('work checker accepts controls, rejects wrong work/incomplete/diagnostic runs', () => {
  assert.match(check([report(), report()]), /work/);
  for (const change of [
    (r) => r.samples[0].draws[2]++,
    (r) => (r.completed = 0),
    (r) => (r.primaryEligible = false),
    (r) => (r.setup.adapterInfo.fallback = true),
  ]) {
    const bad = report();
    change(bad);
    assert.throws(() => check([report(), bad]));
  }
});
