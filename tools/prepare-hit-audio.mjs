#!/usr/bin/env node
/** Offline #473 authoring. Usage: node tools/prepare-hit-audio.mjs /path/to/Music */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Pass the local audio-library root; no audio is downloaded');
const output = fileURLToPath(new URL('../src/audio/samples/hits/', import.meta.url));
const files = new Map();
function scan(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) scan(path);
    else files.set(item.name, files.has(item.name) ? null : path);
  }
}
scan(root);
mkdirSync(output, { recursive: true });
const source = (name, start, duration, filter, level = 1) => ({
  name,
  start,
  duration,
  filter,
  level,
});
const vest = (start) =>
  source('OBJBag_Tactical Gear Vest Hit_B00M_ONE.wav', start, 0.24, 'highpass=f=90,lowpass=f=5000');
const plate = (start) =>
  source(
    'BLLTImpt_Bullet Impact Metal Plate Cal .223 MS_B00M_ONE.wav',
    start,
    0.11,
    'highpass=f=380,lowpass=f=4300',
    0.45
  );
const ceramic = (start) =>
  source(
    'CERMBrk_Ceramic Breaks Intense Short_B00M_ONE.wav',
    start,
    0.33,
    'highpass=f=700,lowpass=f=7200',
    0.8
  );
const recipes = [
  ...[54425, 54426, 54431, 54432].map((number, i) => ({
    name: `flesh-${i + 1}`,
    target20Db: -18,
    layers: [
      source(
        `BulletImpactFlesh_BW.${number}.wav`,
        number === 54425 ? 0.016 : 0,
        0.32,
        'highpass=f=85,lowpass=f=7200'
      ),
    ],
  })),
  ...[0, 1, 2].map((i) => ({
    name: `armour-${i + 1}`,
    target20Db: -18,
    layers: [vest([0.145, 1.805, 3.605][i]), plate([0.095, 3.585, 7.085][i])],
  })),
  ...[0, 1, 2].map((i) => ({
    name: `break-${i + 1}`,
    target20Db: -16,
    layers: [
      vest([0.145, 1.805, 3.605][i]),
      plate([0.095, 3.585, 7.085][i]),
      ceramic([0.145, 2.245, 4.375][i]),
    ],
  })),
];
function ffmpeg(args, input) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], {
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
const hash = (data) => createHash('sha256').update(data).digest('hex');
const manifest = {
  authoring: 'prepare-hit-audio.mjs; audio-only mono, 48 kHz, 96 kb/s Opus; no header gain',
  publication:
    'Owner confirmed public redistribution clearance in the #473 implementation session. Original libraries remain separately licensed, not covered by the code licence. No original masters are shipped.',
  files: {},
};
for (const recipe of recipes) {
  const args = [],
    filters = [];
  recipe.layers.forEach((layer, i) => {
    const path = files.get(layer.name);
    assert(path, `Missing or ambiguous source: ${layer.name}`);
    args.push('-i', path);
    // Explicit stereo average, not FFmpeg's +3 dB equal-power downmix.
    filters.push(
      `[${i}:a:0]atrim=start=${layer.start}:duration=${layer.duration},asetpts=PTS-STARTPTS,pan=mono|c0=0.5*c0+0.5*c1,aresample=48000,${layer.filter},afade=t=in:d=0.001,afade=t=out:st=${layer.duration - 0.035}:d=0.035,volume=${layer.level}[s${i}]`
    );
  });
  filters.push(
    `${recipe.layers.map((_, i) => `[s${i}]`).join('')}amix=inputs=${recipe.layers.length}:normalize=0:duration=longest[out]`
  );
  const pcm = ffmpeg([
    ...args,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-f',
    'f32le',
    '-',
  ]);
  let peak = 0,
    sum = 0,
    maximum = 0;
  const window = 960; // 20 ms at 48 kHz, not whole-file silence-dependent normalization.
  for (let i = 0; i < pcm.length / 4; i++) {
    const x = pcm.readFloatLE(i * 4);
    assert(Number.isFinite(x));
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
    if (i >= window) sum -= pcm.readFloatLE((i - window) * 4) ** 2;
    maximum = Math.max(maximum, sum / window);
  }
  assert(maximum > 1e-8, `${recipe.name}: silent authoring result`);
  // Match short-event energy while retaining at least 8 dB peak headroom.
  const level = Math.min(
    10 ** (recipe.target20Db / 20) / Math.sqrt(maximum),
    10 ** (-8 / 20) / peak
  );
  const delivery = ffmpeg(
    [
      '-f',
      'f32le',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-i',
      '-',
      '-map_metadata',
      '-1',
      '-af',
      `volume=${level}`,
      '-c:a',
      'libopus',
      '-b:a',
      '96k',
      '-vbr',
      'on',
      '-application',
      'audio',
      '-fflags',
      '+bitexact',
      '-f',
      'opus',
      '-',
    ],
    pcm
  );
  const path = join(output, recipe.name + '.opus');
  writeFileSync(path, delivery);
  const decoded = ffmpeg(['-i', path, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']);
  let decodedPeak = 0;
  for (let i = 0; i < decoded.length; i += 4)
    decodedPeak = Math.max(decodedPeak, Math.abs(decoded.readFloatLE(i)));
  assert(decodedPeak < 0.5, `${recipe.name}: codec overshoot compromises headroom`);
  manifest.files[recipe.name] = {
    target20Db: recipe.target20Db,
    level,
    duration: decoded.length / 4 / 48000,
    decodedPeak,
    sha256: hash(delivery),
    layers: recipe.layers.map((layer) => ({
      ...layer,
      sourceSha256: hash(readFileSync(files.get(layer.name))),
    })),
  };
  console.log(
    `${recipe.name}: ${(20 * Math.log10(decodedPeak)).toFixed(1)} dBFS decoded peak, ${delivery.length} bytes`
  );
}
writeFileSync(join(output, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
