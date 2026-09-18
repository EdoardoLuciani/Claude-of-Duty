#!/usr/bin/env node
/**
 * Bake soldier PBR tiles and FX atlases to PNG so boot does not spend ~1 s
 * on CPU noise. Runtime loads public/models/proc/; a live bake remains if
 * the files are missing.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { Rng } from '../src/core/rng.js';
import { SoldierMaterials } from '../src/ai/textures.js';
import { buildDecalAtlas, buildParticleAtlas } from '../src/fx/atlas.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models', 'proc');
const STAMP = join(ROOT, 'node_modules', '.cache', 'claude-of-duty-proc.hash');
const SEED = 0x5eed1234;
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  return match ? [match[1], match[2] ?? true] : [arg, true];
}));

const INPUTS = [
  'tools/export-proc-textures.mjs',
  'src/ai/textures.js',
  'src/fx/atlas.js',
  'src/fx/noise.js',
  'src/core/rng.js',
];

function sourceHash() {
  const hash = createHash('sha256');
  for (const file of INPUTS) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(ROOT, file)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function writePng(file, data, size) {
  const png = new PNG({ width: size, height: size });
  png.data.set(data);
  writeFileSync(file, PNG.sync.write(png));
}

function cacheReady(hash) {
  if (args.force) return false;
  if (!existsSync(STAMP) || readFileSync(STAMP, 'utf8').trim() !== hash) return false;
  const manPath = join(OUT, 'manifest.json');
  if (!existsSync(manPath)) return false;
  try {
    const man = JSON.parse(readFileSync(manPath, 'utf8'));
    for (const name of man.sets ?? []) {
      for (const kind of ['albedo', 'orm', 'normal']) {
        if (!existsSync(join(OUT, `ai-${name}-${kind}.png`))) return false;
      }
    }
    for (const name of man.details ?? []) {
      if (!existsSync(join(OUT, `ai-detail-${name}.png`))) return false;
    }
    for (const size of [512, 1024]) {
      if (!existsSync(join(OUT, `fx-particles-${size}.png`))) return false;
      for (const kind of ['albedo', 'normal', 'orm']) {
        if (!existsSync(join(OUT, `fx-decals-${size}-${kind}.png`))) return false;
      }
    }
  } catch {
    return false;
  }
  return true;
}

const hash = sourceHash();
if (cacheReady(hash)) {
  console.log(`[proc] up to date (${hash})`);
  process.exit(0);
}

const t0 = performance.now();
rmSync(STAMP, { force: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const rng = new Rng(SEED);
const mats = new SoldierMaterials(rng.fork(), {
  size: 512,
  anisotropy: 8,
  camo: ['arid', 'woodland', 'urban'],
});
const sets = Object.keys(mats.sets);
const details = Object.keys(mats.details);
for (const name of sets) {
  const set = mats.sets[name];
  writePng(join(OUT, `ai-${name}-albedo.png`), set.albedo.image.data, 512);
  writePng(join(OUT, `ai-${name}-orm.png`), set.orm.image.data, 512);
  writePng(join(OUT, `ai-${name}-normal.png`), set.normal.image.data, 512);
}
for (const name of details) {
  writePng(join(OUT, `ai-detail-${name}.png`), mats.details[name].image.data, 512);
}

for (const size of [512, 1024]) {
  const fxRng = new Rng(SEED);
  const particles = buildParticleAtlas(fxRng.fork(), size);
  const decals = buildDecalAtlas(fxRng.fork(), size);
  writePng(join(OUT, `fx-particles-${size}.png`), particles.texture.image.data, size);
  writePng(join(OUT, `fx-decals-${size}-albedo.png`), decals.albedo.image.data, size);
  writePng(join(OUT, `fx-decals-${size}-normal.png`), decals.normal.image.data, size);
  writePng(join(OUT, `fx-decals-${size}-orm.png`), decals.orm.image.data, size);
}

const manifest = { sets, details, camoStats: mats.camoStats };
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
mkdirSync(dirname(STAMP), { recursive: true });
writeFileSync(STAMP, hash + '\n');
console.log(
  `[proc] ${sets.length} soldier sets + ${details.length} details + fx 512/1024 in ` +
    `${(performance.now() - t0).toFixed(0)}ms (${hash})`
);
