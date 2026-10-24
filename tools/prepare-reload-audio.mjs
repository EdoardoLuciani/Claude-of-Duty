#!/usr/bin/env node
/** #337 recorded handling. Usage: node tools/prepare-reload-audio.mjs /path/to/Music */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert(process.argv[2], 'Pass the local Music directory; no audio is downloaded');
const root = resolve(process.argv[2]);
const output = fileURLToPath(new URL('../src/audio/samples/reloads/', import.meta.url));
const gun = (name) => `BOOM Library - Gun Handling/${name}`;
const mech = (name) => `BOOM ONE Update/Update 24-02/GUNS/MECHANISM/${name}_B00M_ONE.wav`;
const bag = (name) =>
  `BOOM ONE Update/Update 24-03/OBJECTS/BAG/OBJBag_Tactical Gear ${name}_B00M_ONE.wav`;
const latch =
  'Boom One Update/Update 23-12/EQUIPMENT/TACTICAL/EQUIPTact_Ammo Box Latch Opening Short_B00M_ONE.wav';
// [family, source, [start/duration crops], optional recorded overlay]. No synthesis.
const recipes = [
  [
    'ar-out',
    gun('M16/M16 Mag Out 01.wav'),
    [
      [1.14, 0.14],
      [6.6, 0.16],
      [9.38, 0.18],
    ],
  ],
  [
    'ar-in',
    gun('M16/M16 Mag In 01.wav'),
    [
      [4.01, 0.19],
      [6.47, 0.19],
      [10.01, 0.19],
    ],
  ],
  [
    'ar-charge',
    gun('M16/M16 Charging Handle 01.wav'),
    [
      [0.5, 0.045],
      [3.84, 0.045],
    ],
  ],
  [
    'ar-close',
    gun('M16/M16 Charging Handle 01.wav'),
    [
      [1.23, 0.2],
      [6.43, 0.18],
      [11.21, 0.18],
    ],
  ],
  [
    'pistol-out',
    gun('Walther P99/Walther P99 Mag Out Normal 01.wav'),
    [
      [0.59, 0.2],
      [3.59, 0.23],
      [8.38, 0.2],
    ],
  ],
  [
    'pistol-in',
    gun('Walther P99/Walther P99 Mag In Normal 01.wav'),
    [
      [6.87, 0.18],
      [12.49, 0.18],
      [15.23, 0.18],
    ],
  ],
  [
    'pistol-close',
    gun('Walther P99/Walther P99 Slide Snap 01.wav'),
    [
      [2.22, 0.18],
      [5.34, 0.18],
      [11.57, 0.18],
    ],
  ],
  [
    'smg-out',
    gun('HK MP5/HK MP5 Mag Out 01.wav'),
    [
      [0.33, 0.15],
      [3.33, 0.18],
      [6.11, 0.16],
    ],
  ],
  [
    'smg-in',
    gun('HK MP5/HK MP5 Mag In 01.wav'),
    [
      [2.28, 0.23],
      [4.87, 0.2],
      [8.22, 0.21],
    ],
  ],
  [
    'smg-close',
    gun('HK MP5/HK MP5 Cocking Handle Release 01.wav'),
    [
      [0.31, 0.17],
      [3.76, 0.17],
      [4.87, 0.17],
    ],
  ],
  [
    'sniper-out',
    gun('HK G36/HK G36 Mag Out 01.wav'),
    [
      [1.2, 0.25],
      [7.01, 0.18],
      [10.8, 0.2],
    ],
  ],
  [
    'sniper-in',
    gun('HK G36/HK G36 Mag In 01.wav'),
    [
      [0.58, 0.18],
      [9.94, 0.18],
      [14.66, 0.2],
    ],
  ],
  [
    'bolt-open',
    gun('Remington 700/Remington 700 Bolt Action Normal 01.wav'),
    [
      [0.7, 0.45],
      [4.57, 0.43],
      [8.93, 0.52],
    ],
  ],
  [
    'bolt-close',
    gun('Remington 700/Remington 700 Bolt Action Quick 01.wav'),
    [
      [0.81, 0.25],
      [3.76, 0.24],
      [6.49, 0.24],
    ],
  ],
  // AX338 empty reload has only 61.2 ms between charge and forward release.
  [
    'bolt-charge',
    gun('Remington 700/Remington 700 Bolt Action Normal 01.wav'),
    [
      [0.7, 0.055],
      [4.57, 0.055],
    ],
  ],
  [
    'pump',
    gun('Pumpgun/Pumpgun Reload 01.wav'),
    [
      [0.09, 0.33],
      [1.85, 0.36],
      [3.72, 0.34],
    ],
  ],
  // Empty-reload pump/return beats are 47.5 ms apart: split recorded contacts.
  [
    'pump-open',
    gun('Pumpgun/Pumpgun Reload 01.wav'),
    [
      [0.1, 0.045],
      [1.9, 0.045],
    ],
  ],
  [
    'pump-close',
    gun('Pumpgun/Pumpgun Reload 01.wav'),
    [
      [0.34, 0.12],
      [2.12, 0.12],
      [3.99, 0.12],
    ],
  ],
  [
    'shell-in',
    mech('GUNMech_Remington 870 Shotgun Load'),
    [
      [0.76, 0.18],
      [3.1, 0.23],
      [5.56, 0.18],
    ],
  ],
  [
    'gear',
    bag('Vest Handle'),
    [
      [0.17, 0.22],
      [0.78, 0.19],
      [6.06, 0.25],
    ],
  ],
  [
    'pouch-out',
    bag('Backpack Small Take Out 01'),
    [
      [0.51, 0.3],
      [2.32, 0.3],
      [3.98, 0.3],
    ],
    [
      latch,
      [
        [0.2, 0.14],
        [2.12, 0.16],
        [3.91, 0.18],
      ],
      0.2,
    ],
  ],
  [
    'pouch-in',
    bag('Backpack Small Stow Heavy'),
    [
      [0.53, 0.25],
      [2.23, 0.25],
      [5.91, 0.25],
    ],
    [
      bag('Vest Belt Clip'),
      [
        [0.24, 0.12],
        [1.72, 0.12],
        [3.18, 0.12],
      ],
      0.25,
    ],
  ],
];
function run(command, args, input) {
  const result = spawnSync(command, args, { input, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
const ffmpeg = (args, input) =>
  run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], input);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const masters = new Map();
function crop(source, start, duration) {
  const path = join(root, source);
  if (!masters.has(source)) {
    const info = JSON.parse(
      run('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=channels:format_tags=comment',
        '-of',
        'json',
        path,
      ])
    );
    const channels = info.streams[0].channels;
    assert(channels === 1 || channels === 2, `${source}: unsupported source layout`);
    masters.set(source, {
      channels,
      description: info.format.tags?.comment ?? '',
      sourceSha256: hash(readFileSync(path)),
    });
  }
  const master = masters.get(source);
  const raw = ffmpeg([
    '-i',
    path,
    '-map',
    '0:a:0',
    '-af',
    `atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000`,
    '-f',
    'f32le',
    '-',
  ]);
  const pcm = Buffer.alloc(raw.length / master.channels);
  let originalEnergy = 0,
    monoEnergy = 0;
  for (let n = 0; n < pcm.length / 4; n++) {
    const left = raw.readFloatLE(n * master.channels * 4);
    const right = master.channels === 2 ? raw.readFloatLE(n * 8 + 4) : left;
    const mono = (left + right) * 0.5; // explicit average; no +3 dB downmix boost
    pcm.writeFloatLE(mono, n * 4);
    originalEnergy += (left * left + right * right) * 0.5;
    monoEnergy += mono * mono;
  }
  const downmixLossDb =
    10 * Math.log10(Math.max(1e-20, originalEnergy) / Math.max(1e-20, monoEnergy));
  assert(downmixLossDb < 6, `${source}: stereo cancellation needs review, not blind downmix`);
  return { pcm, provenance: { source, ...master, start, duration, downmixLossDb } };
}
const manifest = {
  authoring:
    'prepare-reload-audio.mjs; recorded-only source crops/overlays, explicit mono average, 48 kHz, 96 kb/s Opus; no header gain',
  publication:
    'Owner confirmed public redistribution of selected edited #337 samples and mixed gameplay captures, and explicitly approved recorded pouch/latch/charging donors for EVOLYS. Masters remain outside the repository; media do not inherit the code licence.',
  files: {},
};
mkdirSync(output, { recursive: true });
for (const [kind, source, crops, overlay] of recipes) {
  crops.forEach(([start, duration], i) => {
    const name = `${kind}-${i + 1}`;
    const main = crop(source, start, duration);
    const layers = [{ ...main.provenance, level: 1 }];
    if (overlay) {
      const extra = crop(overlay[0], ...overlay[1][i]);
      const level = overlay[2];
      for (let n = 0; n < Math.min(main.pcm.length, extra.pcm.length); n += 4)
        main.pcm.writeFloatLE(main.pcm.readFloatLE(n) + extra.pcm.readFloatLE(n) * level, n);
      layers.push({ ...extra.provenance, level });
    }
    const filter = `highpass=f=80,lowpass=f=11000,afade=t=in:d=0.002,afade=t=out:st=${duration - 0.02}:d=0.02`;
    // Preserve the first bank's single-pass mono conversion byte-for-byte.
    const pcm =
      !overlay && main.provenance.channels === 1
        ? ffmpeg([
            '-i',
            join(root, source),
            '-map',
            '0:a:0',
            '-af',
            `atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,${filter}`,
            '-ac',
            '1',
            '-f',
            'f32le',
            '-',
          ])
        : ffmpeg(
            [
              '-f',
              'f32le',
              '-ar',
              '48000',
              '-ac',
              '1',
              '-i',
              '-',
              '-af',
              filter,
              '-f',
              'f32le',
              '-',
            ],
            main.pcm
          );
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
    const target20Db = kind === 'gear' ? -29 : -19;
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
      layers,
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
