import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export function check(reports) {
  assert(reports.length > 0);
  const base = reports[0];
  for (const r of reports) {
    for (const field of [
      'datasetSha256',
      'originalSourceSha256',
      'clientSha256',
      'width',
      'height',
      'frames',
      'warmup',
      'inFlight',
    ])
      assert.equal(r[field], base[field], field);
    assert.equal(r.width, 1920);
    assert.equal(r.height, 1080);
    assert.equal(r.dpr, 1);
    assert.equal(r.visibility, 'visible');
    assert.equal(r.hasFocus, true);
    assert.equal(r.primaryEligible, true, 'diagnostics must not be pooled');
    assert.equal(r.completed, r.frames);
    assert.equal(r.samples.length, r.frames);
    assert.deepEqual(r.errors, []);
    assert.equal(r.scheduled, r.scheduler === 'completion' ? 0 : r.frames);
    assert.equal(r.setup.adapterInfo.fallback, false);
    assert.equal(r.setup.isolated, true);
    assert(
      r.renderNodes.some((n) => n.vendor === '0x1002' && n.device === '0x7550'),
      'hardware RX 9070 XT'
    );
    assert(r.msPerFrame > 0 && Number.isFinite(r.msPerFrame));
    assert.equal(r.presentationCount, null, 'do not claim presentation from GPU fences');
    for (let i = 0; i < r.frames; i++)
      for (const field of ['draws', 'triangles']) {
        assert.equal(r.samples[i][field].length, 5);
        assert(r.samples[i][field].every((n) => Number.isSafeInteger(n) && n > 0));
        assert.deepEqual(r.samples[i][field], base.samples[i][field], `${field} frame ${i}`);
      }
  }
  return `${reports.length} runs × ${base.frames} frames × 5 passes: work, dataset, source, actual completion and dimensions match (formats separately recorded).`;
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  assert(process.argv.length >= 4, 'node check.mjs FIRST.json SECOND.json [...]');
  console.log(
    check(
      await Promise.all(process.argv.slice(2).map(async (path) => JSON.parse(await readFile(path))))
    )
  );
}
