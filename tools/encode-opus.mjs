import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit offline authoring command, never part of normal startup/build.
// Usage: node tools/encode-opus.mjs <external-master-directory> [output-directory]
const root = fileURLToPath(new URL('../', import.meta.url));
const samples = resolve(root, 'src/audio/samples');
const masterDirectory = process.argv[2] ?? process.env.AUDIO_MASTER_DIR;
assert(masterDirectory, 'Provide the external WAV master directory; see docs/audio-delivery.md');
const masters = resolve(masterDirectory);
const output = resolve(process.argv[3] ?? samples);
const source = readFileSync(resolve(root, 'src/audio/samples.ts'), 'utf8');
const names = [...source.matchAll(/new URL\(['"]\.\/samples\/([a-z0-9-]+)\.opus['"]/g)].map(
  (m) => m[1]
);
assert.equal(names.length, 40, 'Expected the complete runtime bank');
assert.equal(new Set(names).size, names.length, 'Duplicate runtime asset');
mkdirSync(output, { recursive: true });
let inputBytes = 0,
  outputBytes = 0;
for (const name of names) {
  const input = resolve(masters, name + '.wav');
  const target = resolve(output, name + '.opus');
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', input], {
      encoding: 'utf8',
    })
  ).streams[0];
  assert([1, 2].includes(probe.channels), 'Preserve mono/stereo layout');
  assert.equal(Number(probe.sample_rate), 48000, 'Masters must retain their authored rate');
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-i',
      input,
      '-map_metadata',
      '-1',
      '-c:a',
      'libopus',
      '-sample_fmt',
      'flt',
      '-application',
      'audio',
      '-b:a',
      probe.channels === 2 ? '256000' : '128000',
      '-vbr',
      'on',
      '-compression_level',
      '10',
      '-frame_duration',
      '20',
      '-ar',
      '48000',
      target,
    ],
    { stdio: 'inherit' }
  );
  inputBytes += statSync(input).size;
  outputBytes += statSync(target).size;
  console.log(`${name}: ${statSync(input).size} → ${statSync(target).size} bytes`);
}
console.log(
  JSON.stringify(
    {
      files: names.length,
      inputBytes,
      outputBytes,
      savedPercent: 100 * (1 - outputBytes / inputBytes),
      note: 'Local licensed derivatives only; no normalization/gain changes. Do not upload without rights clearance.',
    },
    null,
    2
  )
);
