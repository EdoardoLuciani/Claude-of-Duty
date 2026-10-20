// Compare measured work, not pixels or a speed threshold. Accept Bun/Node,
// #483 Rust and #483's pinned browser controls. Window formats may differ.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
assert(process.argv.length >= 4, 'node check.mjs BUN.json REFERENCE.json [MORE.json]');
const reports = await Promise.all(
  process.argv.slice(2).map(async (f) => JSON.parse(await readFile(f)))
);
const baseline = reports[0];
assert.equal(baseline.runtime, 'bun');
assert.equal(baseline.compiled, true);
assert(!baseline.freezePose, 'frozen poses are negative controls, not timings');
assert.equal(baseline.rendererSubmitsPerFrame, 1);
assert.equal(baseline.presentationDrawsPerFrame, 0);
for (const r of reports) {
  for (const k of ['datasetSha256', 'width', 'height', 'frames', 'warmup', 'inFlight'])
    assert.equal(r[k], baseline[k], k);
  assert.deepEqual(r.errors, []);
  assert(!r.freezePose, 'frozen reference');
  assert(Number.isFinite(r.msPerFrame) && r.msPerFrame > 0);
  assert.equal(r.samples.length, r.frames);
  if (baseline.mode === 'offscreen') {
    assert.equal(r.format.toLowerCase(), 'rgba8unorm');
    assert(['offscreen', 'raw-offscreen', 'three-offscreen'].includes(r.mode));
  } else if (['windowed', 'window'].includes(r.mode)) assert.equal(r.presentMode, 'Immediate');
  else {
    assert(['raw-canvas', 'three-canvas'].includes(r.mode));
    assert(r.browserFlags.includes('--disable-gpu-vsync'));
    assert(r.browserFlags.includes('--disable-frame-rate-limit'));
  }
  assert(r.adapterInfo, 'adapter attestation required');
  if ('fallback' in r.adapterInfo) assert.equal(r.adapterInfo.fallback, false);
  else
    assert(
      ['DiscreteGpu', 'IntegratedGpu'].includes(r.adapterInfo.deviceType),
      'hardware WGPU adapter'
    );
  if (r.runtime) assert.equal(r.sourceSha256, baseline.sourceSha256, 'same JS port for Bun/Node');
  if (r.lateBuilds !== undefined) assert.equal(r.lateBuilds, 0);
  for (let i = 0; i < r.frames; i++)
    for (const k of ['draws', 'triangles']) {
      assert.equal(r.samples[i][k].length, 5);
      assert.deepEqual(r.samples[i][k], baseline.samples[i][k], `${k} frame ${i}`);
    }
}
console.log(
  `${reports.length} implementations × ${baseline.frames} frames × 5 passes: dataset/work/dimensions/completion bound match.`
);
