#!/usr/bin/env node
/** Decoded-asset regression: audible-scale pitch/envelope cycling across every loop wrap. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { measureLoop } from '../../tools/lib/aircraft-loop.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const before = process.argv.find((a) => a.startsWith('--before='))?.slice(9);
const manifest = JSON.parse(
  readFileSync(resolve(root, 'src/audio/samples/aircraft/provenance.json'))
);
function measure(dir, name, target) {
  const p = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-i',
      resolve(dir, `src/audio/samples/aircraft/${name}.opus`),
      '-ar',
      '12000',
      '-ac',
      '1',
      '-f',
      'f32le',
      '-',
    ],
    { maxBuffer: 8 * 1024 * 1024 }
  );
  assert.equal(p.status, 0, p.stderr?.toString() ?? p.error?.message);
  return measureLoop(p.stdout, target);
}
for (const [name, file] of Object.entries(manifest.files)) {
  const result = measure(root, name, file.pitchCorrection.targetHz);
  assert(
    result.pitchSpanCents < 35,
    `${name}: repeating pitch sweep ${result.pitchSpanCents} cents`
  );
  assert(result.rmsSpanDb < 1.5, `${name}: repeating envelope ${result.rmsSpanDb} dB`);
  console.log('PASS decoded circular-window steadiness', name, result);
  if (before) {
    const old = measure(resolve(before), name, file.pitchCorrection.targetHz);
    assert(old.pitchSpanCents > 200, 'prior PR loop must fail the pitch-cycling gate');
    assert(old.rmsSpanDb > 3, 'prior PR loop must fail the envelope-cycling gate');
    console.log('Prior PR regression correctly rejected', name, old);
  }
}
