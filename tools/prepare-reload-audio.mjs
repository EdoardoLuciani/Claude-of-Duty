#!/usr/bin/env node
/** #337 first slice. Usage: node tools/prepare-reload-audio.mjs /path/to/Music */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert(process.argv[2], 'Pass the local Music directory; no audio is downloaded');
const root = resolve(process.argv[2], 'BOOM Library - Gun Handling');
const output = fileURLToPath(new URL('../src/audio/samples/reloads/', import.meta.url));
const recipes = [
  [
    'ar-out',
    'M16/M16 Mag Out 01.wav',
    [
      [1.14, 0.14],
      [6.6, 0.16],
      [9.38, 0.18],
    ],
  ],
  [
    'ar-in',
    'M16/M16 Mag In 01.wav',
    [
      [4.01, 0.19],
      [6.47, 0.19],
      [10.01, 0.19],
    ],
  ],
  [
    'ar-charge',
    'M16/M16 Charging Handle 01.wav',
    [
      [0.5, 0.045],
      [3.84, 0.045],
    ],
  ],
  [
    'ar-close',
    'M16/M16 Charging Handle 01.wav',
    [
      [1.23, 0.2],
      [6.43, 0.18],
      [11.21, 0.18],
    ],
  ],
  [
    'pistol-out',
    'Walther P99/Walther P99 Mag Out Normal 01.wav',
    [
      [0.59, 0.2],
      [3.59, 0.23],
      [8.38, 0.2],
    ],
  ],
  [
    'pistol-in',
    'Walther P99/Walther P99 Mag In Normal 01.wav',
    [
      [6.87, 0.18],
      [12.49, 0.18],
      [15.23, 0.18],
    ],
  ],
  [
    'pistol-close',
    'Walther P99/Walther P99 Slide Snap 01.wav',
    [
      [2.22, 0.18],
      [5.34, 0.18],
      [11.57, 0.18],
    ],
  ],
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
  authoring: 'prepare-reload-audio.mjs; mono source crops, 48 kHz, 96 kb/s Opus; no header gain',
  publication:
    'Owner explicitly confirmed public redistribution of selected edited #337 samples and mixed gameplay captures in the implementation session. Masters remain outside the repository; commercial media do not inherit the code licence.',
  files: {},
};
mkdirSync(output, { recursive: true });
for (const [kind, source, crops] of recipes) {
  const path = join(root, source);
  const sourceSha256 = hash(readFileSync(path));
  crops.forEach(([start, duration], i) => {
    const name = `${kind}-${i + 1}`;
    // Selected 01 masters are mono; do not apply a stereo downmix/boost.
    const filter = `atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,highpass=f=80,lowpass=f=11000,afade=t=in:d=0.002,afade=t=out:st=${duration - 0.02}:d=0.02`;
    const pcm = ffmpeg([
      '-i',
      path,
      '-map',
      '0:a:0',
      '-af',
      filter,
      '-ac',
      '1',
      '-f',
      'f32le',
      '-',
    ]);
    let peak = 0,
      sum = 0,
      maximum = 0;
    for (let n = 0; n < pcm.length / 4; n++) {
      const x = pcm.readFloatLE(n * 4);
      assert(Number.isFinite(x));
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
      if (n >= 960) sum -= pcm.readFloatLE((n - 960) * 4) ** 2;
      maximum = Math.max(maximum, sum / 960);
    }
    assert(maximum > 1e-8, `${name}: silent crop`);
    const target20Db = -19;
    const level = Math.min(10 ** (target20Db / 20) / Math.sqrt(maximum), 10 ** (-8 / 20) / peak);
    const data = ffmpeg(
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
    const destination = join(output, name + '.opus');
    writeFileSync(destination, data);
    const decoded = ffmpeg(['-i', destination, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']);
    let decodedPeak = 0;
    for (let n = 0; n < decoded.length; n += 4)
      decodedPeak = Math.max(decodedPeak, Math.abs(decoded.readFloatLE(n)));
    assert(decodedPeak < 0.5, `${name}: codec overshoot`);
    manifest.files[name] = {
      source,
      sourceSha256,
      start,
      duration: decoded.length / 4 / 48000,
      filter,
      target20Db,
      level,
      decodedPeak,
      bytes: data.length,
      sha256: hash(data),
    };
    console.log(
      `${name}: ${data.length} bytes, ${(20 * Math.log10(decodedPeak)).toFixed(1)} dBFS peak`
    );
  });
}
writeFileSync(join(output, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
