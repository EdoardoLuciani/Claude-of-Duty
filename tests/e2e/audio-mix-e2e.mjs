import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { mixCases } from './audio-mix-scenes.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rate = Number(process.env.AUDIO_MIX_RATE ?? 48000);
const seed = Number(process.env.AUDIO_MIX_SEED ?? 1907);
const filter = process.env.AUDIO_MIX_CASES?.split(',');
const cases = mixCases().filter(
  (c) =>
    !filter ||
    ['gun-rifle-0', 'ambience-idle'].includes(c.id) ||
    filter.some((f) => c.id.includes(f))
);
assert(cases.length > 0, 'No matching mix cases');
const evidence = process.env.AUDIO_MIX_EVIDENCE_DIR
  ? resolve(process.env.AUDIO_MIX_EVIDENCE_DIR)
  : null;
assert(
  !evidence || (evidence !== resolve(root) && !evidence.startsWith(root)),
  'Keep evidence outside the repository'
);
const baselinePath = process.env.AUDIO_MIX_BASELINE;
const baseline = baselinePath
  ? JSON.parse(readFileSync(resolve(baselinePath, 'results.json'), 'utf8'))
  : null;
if (baseline) {
  assert.equal(baseline.rate, rate, 'Baseline sample rate');
  assert.equal(baseline.seed, seed, 'Baseline seed');
}
const rows = [],
  errors = [];
const port = Number(process.env.PORT ?? 5500);
const server = await ensureViteServer({ root, port });
assert(server, 'Refusing an unverified server on an occupied port');
let browser;
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/private-mix', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'Native mix regression' })
  );
  await page.goto(`http://127.0.0.1:${port}/private-mix`);
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
    row.pcmSha256 = createHash('sha256').update(pcm).digest('hex');
    // Meter the actual full-length float output directly; no WAV writer/export tree.
    const meter = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostats',
        '-f',
        'f32le',
        '-ar',
        String(rate),
        '-ac',
        '2',
        '-i',
        'pipe:0',
        '-af',
        'ebur128=peak=true',
        '-f',
        'null',
        '-',
      ],
      { input: pcm, encoding: 'utf8', maxBuffer: 1024 * 1024 }
    );
    assert.equal(meter.status, 0, meter.error?.message ?? meter.stderr);
    const momentary = [...meter.stderr.matchAll(/\bM:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
    const integrated = [...meter.stderr.matchAll(/\bI:\s*(-?[\d.]+)\s*LUFS/g)].at(-1);
    const truePeak = [...meter.stderr.matchAll(/Peak:\s*(-?[\d.]+)\s*dBFS/g)].at(-1);
    assert(momentary.length && integrated, 'Missing actual EBU R128 measurements');
    row.loudness = {
      maxMomentaryLUFS: Math.max(...momentary),
      integratedLUFS: Number(integrated[1]),
      estimatedTruePeakDb: truePeak ? Number(truePeak[1]) : null,
    };
    rows.push(row);
    assert(row.nativeWorklet, scenario.id + ': missing native worklet');
    assert.equal(row.errors, 0, scenario.id + ': audio error');
    assert.equal(row.dropped, 0, scenario.id + ': dropped voice');
    assert.equal(row.stolen, 0, scenario.id + ': stolen voice');
    assert(row.stages.final.peak <= 0.9900001, scenario.id + ': sample ceiling');
    if (scenario.role === 'silence') {
      for (const stage of Object.values(row.stages)) {
        assert.equal(stage.peak, 0, scenario.id + ': idle noise');
        assert.equal(stage.rms, 0, scenario.id + ': idle energy');
      }
    } else assert(row.stages.final.peak > 1e-7, scenario.id + ': silent fixture');
    assert(row.stages.final.tailPeak < 1e-5, scenario.id + ': truncated tail');
    if (baseline && scenario.role === 'anchor') {
      assert(
        baseline.rows.some((old) => old.scenario.id === scenario.id),
        'Missing approved gun anchor'
      );
      const old = readFileSync(resolve(baselinePath, scenario.id + '.wav')).subarray(44);
      assert.equal(old.length, pcm.length, 'Gun duration changed');
      let difference = 0;
      for (let i = 0; i < old.length; i += 4)
        difference = Math.max(difference, Math.abs(old.readFloatLE(i) - pcm.readFloatLE(i)));
      row.baselineMaxDifference = difference;
      assert(difference <= 3e-7, scenario.id + ': approved gun waveform changed');
    }
    console.log(
      `${rows.length}/${cases.length} ${scenario.id}: ${row.stages.final.max20Db.toFixed(2)} dB/20ms; ${row.loudness.maxMomentaryLUFS} LUFS`
    );
  }
  assert.deepEqual(errors, []);
  const anchor = rows.find((r) => r.scenario.id === 'gun-rifle-0');
  assert(anchor, 'Missing own M4 anchor');
  for (const row of rows) {
    const target = {
      routine: [12, 8, 8],
      speech: [8, 6, 6],
      warning: [6, 3, 6],
      background: [24, 18, 18],
      music: [15, 12, 10],
      impact: [6, 3, 3],
      distant: [12, 10, 10],
    }[row.scenario.role];
    if (target) {
      const gaps = [
        anchor.stages.final.max20Db - row.stages.final.max20Db,
        anchor.stages.final.max200Db - row.stages.final.max200Db,
        anchor.loudness.maxMomentaryLUFS - row.loudness.maxMomentaryLUFS,
      ];
      assert(
        gaps.every((gap, i) => gap >= target[i]),
        `${row.scenario.id}: hierarchy ${gaps} below ${target}`
      );
    }
    // Fixed historical floor, NOT the now-silent ambience measurement.
    if (
      [
        'own-step-concrete-walk',
        'enemy-step-concrete-2',
        'enemy-step-concrete-8',
        'voice-near',
        'ui-hitmarker',
      ].includes(row.scenario.id)
    )
      assert(
        row.loudness.maxMomentaryLUFS - -44 >= (row.scenario.id.endsWith('-8') ? -3 : 6),
        row.scenario.id + ': quiet-scene readability'
      );
  }
  // Meter the actual unducked incoming stem, not only the gun-dominated sum.
  // A peak ceiling alone cannot prove that feedback survives sustained fire.
  for (const row of rows.filter((r) => r.scenario.event === 'damage')) {
    const ui = row.stages.uiFeedback;
    assert(
      ui.max20Db > -31 && ui.max20Db < -15,
      row.scenario.id + ': incoming readability/headroom'
    );
    assert(ui.peak < 0.65, row.scenario.id + ': composite source headroom');
    if (row.scenario.combat) {
      const quiet = rows.find((r) => r.scenario.id === row.scenario.id.replace('-combat', ''));
      if (quiet)
        assert(
          Math.abs(ui.max20Db - quiet.stages.uiFeedback.max20Db) < 3,
          row.scenario.id + ': feedback is not gun-ducked'
        );
    }
  }
  const health = rows.find((r) => r.scenario.id === 'damage-health');
  const concussed = rows.find((r) => r.scenario.id === 'damage-concussed');
  if (health && concussed)
    assert(
      Math.abs(health.stages.uiFeedback.max20Db - concussed.stages.uiFeedback.max20Db) < 0.01,
      'concussion must not bury player feedback'
    );
  console.log(
    `PASS: ${rows.length} native mix scenarios; hierarchy, readability, silence, voices and tails.`
  );
} finally {
  await browser?.close();
  stopViteServer(server);
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      resolve(evidence, 'results.json'),
      JSON.stringify({ rate, seed, rows, errors }, null, 2) + '\n'
    );
  }
}
