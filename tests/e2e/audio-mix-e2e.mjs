import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { mixCases } from './audio-mix-scenes.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = resolve(process.env.AUDIO_MIX_EVIDENCE_DIR ?? '/tmp/cod-audio-mix');
assert(!evidence.startsWith(root), 'Keep recording exports outside the repository');
mkdirSync(evidence, { recursive: true });
const rate = Number(process.env.AUDIO_MIX_RATE ?? 48000),
  seed = Number(process.env.AUDIO_MIX_SEED ?? 1907);
const filter = process.env.AUDIO_MIX_CASES?.split(',');
const cases = mixCases().filter(
  (c) =>
    !filter ||
    ['gun-rifle-0', 'ambience-idle'].includes(c.id) ||
    filter.some((f) => c.id.includes(f))
);
assert(cases.length > 0, 'No matching benchmark cases');
const rows = [],
  errors = [];
const files = [
  ...readdirSync(resolve(root, 'src/audio'))
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => `src/audio/${name}`),
  'src/core/rng.ts',
  'src/weapons/defs.ts',
  'tests/e2e/audio-mix-scenes.mjs',
  'tests/e2e/audio-mix-e2e.mjs',
];
const sourceHashes = Object.fromEntries(
  files.map((path) => [
    path,
    createHash('sha256')
      .update(readFileSync(resolve(root, path)))
      .digest('hex'),
  ])
);
const report = {
  root,
  rate,
  seed,
  sourceHashes,
  rows,
  errors,
  criteria:
    'Artistic contrast relative to approved own M4; not acoustic SPL calibration. Contextual roles, not all distant weapons above every near cue.',
};
const save = () =>
  writeFileSync(resolve(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 8, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
const port = Number(process.env.PORT ?? 5500);
const server = await ensureViteServer({ root, port });
assert(server, `Port ${port} is already in use; refusing an unverified server`);
let browser;
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/private-mix-benchmark', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: 'Local native mix benchmark — no playback gain or source overrides',
    })
  );
  await page.goto(`http://127.0.0.1:${port}/private-mix-benchmark`);
  for (const scenario of cases) {
    const row = await page.evaluate(
      async ({ scenario, rate, seed }) => {
        const { renderMixCase } = await import('/tests/e2e/audio-mix-scenes.mjs');
        return renderMixCase(scenario, { rate, seed });
      },
      { scenario, rate, seed }
    );
    const pcm = Buffer.from(row.pcm, 'base64');
    delete row.pcm;
    const path = resolve(evidence, scenario.id + '.wav');
    writeFileSync(path, wav(pcm));
    row.pcmSha256 = createHash('sha256').update(pcm).digest('hex');
    const meter = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 }
    );
    assert.equal(meter.status, 0, meter.error?.message ?? meter.stderr);
    writeFileSync(resolve(evidence, scenario.id + '.meter.log'), meter.stderr);
    const momentary = [...meter.stderr.matchAll(/\bM:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
    const integrated = [...meter.stderr.matchAll(/\bI:\s*(-?[\d.]+)\s*LUFS/g)].at(-1);
    const truePeak = [...meter.stderr.matchAll(/Peak:\s*(-?[\d.]+)\s*dBFS/g)].at(-1);
    assert(momentary.length && integrated, 'Missing actual EBU R128 meter output');
    row.loudness = {
      maxMomentaryLUFS: Math.max(...momentary),
      integratedLUFS: Number(integrated[1]),
      estimatedTruePeakDb: truePeak ? Number(truePeak[1]) : null,
    };
    rows.push(row);
    save();
    console.log(
      `${rows.length}/${cases.length} ${scenario.id}: peak ${row.stages.final.peakDb.toFixed(2)} dBFS, max20 ${row.stages.final.max20Db.toFixed(2)}, max200 ${row.stages.final.max200Db.toFixed(2)}; common gain ${row.commonGain.min.toFixed(3)}`
    );
  }
} finally {
  await browser?.close();
  await stopViteServer(server);
  save();
}
assert.equal(errors.length, 0, errors.join('\n'));
for (const row of rows) {
  assert(row.nativeWorklet, `${row.scenario.id}: missing actual worklet`);
  assert.equal(row.errors, 0, `${row.scenario.id}: audio error`);
  assert.equal(row.dropped, 0, `${row.scenario.id}: dropped source`);
  assert.equal(row.stolen, 0, `${row.scenario.id}: stolen source`);
  assert(row.stages.final.peak <= 0.9900001, `${row.scenario.id}: sample ceiling exceeded`);
  if (row.scenario.role === 'silence') {
    for (const [name, stage] of Object.entries(row.stages)) {
      assert.equal(stage.peak, 0, `${row.scenario.id}: ${name} emits idle noise`);
      assert.equal(stage.rms, 0, `${row.scenario.id}: ${name} emits idle energy`);
    }
  } else assert(row.stages.final.peak > 1e-7, `${row.scenario.id}: silent fixture`);
  assert(row.stages.final.tailPeak < 1e-5, `${row.scenario.id}: render may truncate a tail`);
}
const anchor = rows.find((r) => r.scenario.id === 'gun-rifle-0');
if (anchor) {
  report.hierarchy = rows
    .filter((r) =>
      ['routine', 'speech', 'warning', 'background', 'music', 'impact', 'distant'].includes(
        r.scenario.role
      )
    )
    .map((row) => {
      const target = {
        routine: [12, 8, 8],
        speech: [8, 6, 6],
        warning: [6, 3, 6],
        background: [24, 18, 18],
        music: [15, 12, 10],
        impact: [6, 3, 3],
        distant: [12, 10, 10],
      }[row.scenario.role];
      const gap20 = anchor.stages.final.max20Db - row.stages.final.max20Db;
      const gap200 = anchor.stages.final.max200Db - row.stages.final.max200Db;
      const gapMomentary = anchor.loudness.maxMomentaryLUFS - row.loudness.maxMomentaryLUFS;
      return {
        id: row.scenario.id,
        role: row.scenario.role,
        gap20,
        gap200,
        target20: target[0],
        target200: target[1],
        gapMomentary,
        targetMomentary: target[2],
        pass: gap20 >= target[0] && gap200 >= target[1] && gapMomentary >= target[2],
      };
    });
  report.hierarchyFailures = report.hierarchy.filter((r) => !r.pass);
  save();
  console.log(
    JSON.stringify({ cases: rows.length, hierarchyFailures: report.hierarchyFailures }, null, 2)
  );
  if (process.env.AUDIO_MIX_ENFORCE !== '0')
    assert.equal(
      report.hierarchyFailures.length,
      0,
      'Mix hierarchy below documented contrast targets'
    );
}
if (process.env.AUDIO_MIX_BASELINE) {
  const baselinePath = resolve(process.env.AUDIO_MIX_BASELINE);
  const baseline = JSON.parse(readFileSync(resolve(baselinePath, 'results.json'), 'utf8'));
  assert.equal(baseline.rate, rate, 'Anchor comparison requires the same sample rate');
  assert.equal(baseline.seed, seed, 'Anchor comparison requires the same seed');
  report.gunPreservation = [];
  for (const row of rows.filter((r) => r.scenario.role === 'anchor')) {
    const old = baseline.rows.find((r) => r.scenario.id === row.scenario.id);
    assert(old, 'Missing approved gun anchor');
    const a = readFileSync(resolve(baselinePath, row.scenario.id + '.wav')).subarray(44);
    const b = readFileSync(resolve(evidence, row.scenario.id + '.wav')).subarray(44);
    assert.equal(a.length, b.length, 'Gun render duration changed');
    let maxDifference = 0;
    for (let i = 0; i < a.length; i += 4)
      maxDifference = Math.max(maxDifference, Math.abs(a.readFloatLE(i) - b.readFloatLE(i)));
    report.gunPreservation.push({
      id: row.scenario.id,
      bitExact: old.pcmSha256 === row.pcmSha256,
      maxDifference,
    });
    assert(maxDifference <= 3e-7, `${row.scenario.id}: approved gun sound changed`);
  }
  save();
}
// Keep the approved readability floor even without a live noise bed. Comparing
// against digital silence would make this guard trivial. -44 LUFS is the highest
// former bed measurement across the four approved rate/seed matrices.
const quietReferenceLUFS = -44;
if (rows.some((r) => r.scenario.id === 'ambience-idle')) {
  report.quietReferenceLUFS = quietReferenceLUFS;
  report.quietReadability = rows
    .filter((r) =>
      [
        'own-step-concrete-walk',
        'enemy-step-concrete-2',
        'enemy-step-concrete-8',
        'voice-near',
        'ui-hitmarker',
      ].includes(r.scenario.id)
    )
    .map((row) => {
      const gap = row.loudness.maxMomentaryLUFS - quietReferenceLUFS;
      const minimum = row.scenario.id.endsWith('-8') ? -3 : 6;
      return { id: row.scenario.id, gap, minimum, pass: gap >= minimum };
    });
  save();
  if (process.env.AUDIO_MIX_ENFORCE !== '0')
    assert(
      report.quietReadability.every((r) => r.pass),
      'Important quiet-scene cues lost below the approved readability reference'
    );
}
console.log('Native mix benchmark captured; evidence:', evidence);
