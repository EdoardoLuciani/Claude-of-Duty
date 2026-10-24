#!/usr/bin/env node
/** Offline, explicit edits only. Requires the owner's cleared local libraries. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const music = resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Usage: node tools/prepare-physical-foley.mjs /path/to/Music');
const recipes = JSON.parse(readFileSync(new URL('./physical-foley-recipes.json', import.meta.url)));
const output = join(root, 'src/audio/samples/foley');
mkdirSync(output, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, input) => {
  const p = spawnSync(command, args, { input, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(p.status, 0, p.stderr?.toString());
  return p.stdout;
};
const ff = (args, input) => run('ffmpeg', ['-nostdin', '-v', 'error', ...args], input);
const decodedSources = new Map();
const manifest = {
  format: 'mono 48000 Hz Opus, 96 kbps VBR',
  rights:
    'Owner explicitly cleared public redistribution of these edited material, boot, body and equipment assets. Original masters remain private. Commercial-derived media retain their own terms, not the code licence. Retain applicable entitlement/licence records.',
  sources: {},
  files: {},
};
const urls = [];
for (const [kind, recipe] of Object.entries(recipes.banks)) {
  const paths = [];
  for (const [index, cut] of recipe.cuts.entries()) {
    const source = recipes.sources[cut.source];
    assert(source && !isAbsolute(source) && !source.split('/').includes('..'));
    const path = join(music, source);
    let decoded = decodedSources.get(source);
    if (!decoded) {
      const probe = JSON.parse(
        run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path])
      );
      const channels = probe.streams[0].channels;
      assert(channels === 1 || channels === 2, `${source}: select mono/stereo source explicitly`);
      const bytes = ff(['-i', path, '-ar', '48000', '-f', 'f32le', '-']);
      const mono = Buffer.alloc(bytes.length / channels);
      for (let i = 0; i < mono.length / 4; i++) {
        const left = bytes.readFloatLE(i * channels * 4);
        const right = channels === 2 ? bytes.readFloatLE((i * 2 + 1) * 4) : left;
        mono.writeFloatLE((left + right) * 0.5, i * 4);
      }
      decoded = { mono, stereo: bytes, channels };
      decodedSources.set(source, decoded);
      manifest.sources[cut.source] = { path: source, sha256: hash(readFileSync(path)), channels };
    }
    const start = Math.round(cut.start * 48000),
      frames = Math.round(cut.duration * 48000);
    assert(
      start >= 0 && (start + frames) * 4 <= decoded.mono.length,
      `${kind}: cut exceeds source`
    );
    const crop = decoded.mono.subarray(start * 4, (start + frames) * 4);
    let monoEnergy = 0,
      sourceEnergy = 0;
    for (let i = 0; i < frames; i++) {
      monoEnergy += crop.readFloatLE(i * 4) ** 2;
      for (let c = 0; c < decoded.channels; c++)
        sourceEnergy +=
          decoded.stereo.readFloatLE(((start + i) * decoded.channels + c) * 4) ** 2 /
          decoded.channels;
    }
    const downmixLossDb = 10 * Math.log10(monoEnergy / sourceEnergy);
    assert(downmixLossDb > -6, `${kind}: excessive cancellation; select a different crop/source`);
    const pcm = ff(
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
        `${recipe.filter},afade=t=in:d=0.001,afade=t=out:st=${cut.duration - 0.035}:d=0.035`,
        '-f',
        'f32le',
        '-',
      ],
      crop
    );
    let peak = 0,
      sum = 0,
      max20 = 0;
    for (let i = 0; i < pcm.length / 4; i++) {
      const x = pcm.readFloatLE(i * 4);
      assert(Number.isFinite(x));
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
      if (i >= 960) sum -= pcm.readFloatLE((i - 960) * 4) ** 2;
      max20 = Math.max(max20, sum / 960);
    }
    assert(max20 > 1e-9, `${kind}: silent cut`);
    const level = Math.min(
      10 ** (recipe.target20Db / 20) / Math.sqrt(max20),
      10 ** (-9 / 20) / peak
    );
    const delivery = ff(
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
        `volume=${level}`,
        '-map_metadata',
        '-1',
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
    const name = `${kind}-${index + 1}`;
    writeFileSync(join(output, name + '.opus'), delivery);
    const final = ff([
      '-i',
      join(output, name + '.opus'),
      '-ar',
      '48000',
      '-ac',
      '1',
      '-f',
      'f32le',
      '-',
    ]);
    let decodedPeak = 0;
    for (let i = 0; i < final.length; i += 4)
      decodedPeak = Math.max(decodedPeak, Math.abs(final.readFloatLE(i)));
    assert(decodedPeak < 0.5, `${name}: codec overshoot exceeds headroom`);
    manifest.files[name] = {
      ...cut,
      filter: recipe.filter,
      target20Db: recipe.target20Db,
      level,
      downmixLossDb,
      duration: final.length / 4 / 48000,
      decodedPeak,
      sha256: hash(delivery),
    };
    paths.push(`    new URL('./samples/foley/${name}.opus', import.meta.url).href,`);
  }
  urls.push(`  '${kind}': [\n${paths.join('\n')}\n  ],`);
}
writeFileSync(join(output, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
  join(root, 'src/audio/foley-urls.ts'),
  `// Generated by tools/prepare-physical-foley.mjs; edits and source hashes accompany the assets.\nexport const FOLEY_URLS = {\n${urls.join('\n')}\n} as const;\nexport type FoleyKind = keyof typeof FOLEY_URLS;\n`
);
console.log(
  `${Object.keys(manifest.files).length} assets; ${Object.values(manifest.files).reduce((n, f) => n + f.duration * 48000 * 4, 0)} decoded bytes; ${relative(root, output)}`
);
