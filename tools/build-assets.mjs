#!/usr/bin/env node
/**
 * Build every generated runtime asset, skipping steps whose inputs are unchanged.
 * Blender 5.2.2 and gltfpack 1.3 are needed only when a Blender step is stale;
 * `bun run build:ci` skips this script (code-only build, no models).
 *
 * Player arms run first, then the bandage, which re-saves player-arms.blend.
 * Every weapon loads that blend, so arm changes rebuild all weapons. The EXPS3
 * sight and soldiers are independent. The Node-only stages (procedural textures,
 * soldier/spent-hull staging, world validation) keep their own caches.
 *
 * Input hashes live in .cache/assets/, outside node_modules so `bun ci` keeps them.
 * Usage: node tools/build-assets.mjs [--force]
 * Env: BLENDER, GLTFPACK (tool paths), OW_ASSET_JOBS (concurrent Blender steps).
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL_COOKS } from '../build/models.mjs';
import { ASSET_ROOT as SOLDIERS, loadCommittedSoldiers } from './blender/soldiers/export.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'assets');
const BLENDER = process.env.BLENDER ?? 'blender';
const BLENDER_VERSION = 'Blender 5.2.2';
// Bump when step definitions change in a way that must rebuild existing outputs.
const RECIPE = 'assets-v1';
const FORCE = process.argv.includes('--force');
const CORES = availableParallelism();
const JOBS = Math.max(1, Number(process.env.OW_ASSET_JOBS) || Math.min(4, Math.floor(CORES / 4)));
const THREADS = String(Math.max(1, Math.floor(CORES / JOBS)));

const blender = (script) => [
  BLENDER,
  '-b',
  '-t',
  THREADS,
  '--python-exit-code',
  '1',
  '--python',
  script,
];
const node = (...args) => [process.execPath, ...args];
/** Hand-authored JSON beside the generated products; manifest.json is a product. */
const authoredJson = (dir) =>
  readdirSync(join(ROOT, dir))
    .filter((file) => file.endsWith('.json') && file !== 'manifest.json')
    .map((file) => `${dir}/${file}`);

// Weapon id (MODEL_COOKS key) -> Blender tool directories it imports.
const WEAPONS = {
  m4: ['m4'],
  mcx: ['mcx'],
  evolys: ['evolys'],
  ax338: ['ax338'],
  mpx: ['mpx', 'evolys'],
  p320: ['p320'],
  m590: ['m590'],
};
assert.deepEqual(
  Object.keys(MODEL_COOKS).sort(),
  [...Object.keys(WEAPONS), 'exps3'].sort(),
  'every registered cook needs a build step here'
);
const cooked = (id) => {
  const { directory, source, output } = MODEL_COOKS[id];
  return [`${directory}/${source}`, `${directory}/${output}`];
};

const STEPS = [
  {
    id: 'arms',
    inputs: [
      'tools/blender/player_arms.py',
      'tools/blender/player_bandage.py',
      'assets/player/arms/pose-reference.json',
    ],
    outputs: [
      'assets/player/arms/player-arms.blend',
      'public/models/player/arms.glb',
      'public/models/player/bandage.glb',
    ],
    commands: [blender('tools/blender/player_arms.py'), blender('tools/blender/player_bandage.py')],
  },
  ...Object.entries(WEAPONS).map(([id, tools]) => ({
    id,
    deps: ['arms'],
    inputs: [
      ...tools.map((tool) => `tools/blender/${tool}`),
      ...authoredJson(MODEL_COOKS[id].directory),
      'build/models.mjs',
    ],
    outputs: cooked(id),
    commands: [blender(`tools/blender/${tools[0]}/build.py`), node('build/models.mjs', id)],
  })),
  {
    id: 'exps3',
    inputs: [
      'tools/blender/exps3.py',
      'tools/blender/exps3_bake.py',
      ...authoredJson(MODEL_COOKS.exps3.directory),
      'build/models.mjs',
    ],
    outputs: cooked('exps3'),
    commands: [blender('tools/blender/exps3.py'), node('build/models.mjs', 'exps3')],
  },
  {
    id: 'soldiers',
    // The soldier manifest already records its source hash; reuse that check.
    fresh: () => {
      try {
        loadCommittedSoldiers();
        return true;
      } catch {
        return false;
      }
    },
    commands: [node('tools/blender/soldiers/export.mjs', '--output', SOLDIERS)],
  },
];
const byId = new Map(STEPS.map((step) => [step.id, step]));

function listFiles(path) {
  const abs = join(ROOT, path);
  if (!statSync(abs).isDirectory()) return [path];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.parentPath.includes('__pycache__'))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

function inputHash(step, depHashes) {
  const hash = createHash('sha256').update(`${RECIPE}\0${step.id}\0${depHashes.join('\0')}\0`);
  for (const path of step.inputs.flatMap(listFiles)) {
    // Git may check text out with CRLF; that alone must not trigger a Blender rebuild.
    const text = readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
    hash.update(path).update('\0').update(text).update('\0');
  }
  return hash.digest('hex');
}

let blenderChecked = false;
function checkBlender() {
  if (blenderChecked) return;
  blenderChecked = true;
  const result = spawnSync(BLENDER, ['--version'], { encoding: 'utf8' });
  if (result.error)
    throw new Error(
      `[assets] Blender not found (${BLENDER}). Install ${BLENDER_VERSION} or set BLENDER; ` +
        'use `bun run build:ci` for a code-only build.'
    );
  const version = result.stdout.split('\n')[0].trim();
  if (!version.startsWith(BLENDER_VERSION))
    console.warn(`[assets] expected ${BLENDER_VERSION}, found ${version}; outputs may differ`);
}

function runLogged(commands, log) {
  const fd = openSync(log, 'w');
  return commands.reduce(
    (previous, [command, ...args]) =>
      previous.then(
        (code) =>
          code ||
          new Promise((done) => {
            const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', fd, fd] });
            child.on('error', () => done(1));
            child.on('exit', (value) => done(value ?? 1));
          })
      ),
    Promise.resolve(0)
  );
}

let slots = JOBS;
const waiting = [];
const acquire = () =>
  slots > 0 ? (slots--, Promise.resolve()) : new Promise((go) => waiting.push(go));
const release = () => (waiting.length ? waiting.shift()() : slots++);

let failed = false;
const results = new Map();
/** Resolves to the step's input hash, or null when it (or a dependency) failed. */
function schedule(step) {
  if (!results.has(step.id))
    results.set(
      step.id,
      (async () => {
        const deps = await Promise.all((step.deps ?? []).map((id) => schedule(byId.get(id))));
        if (deps.includes(null)) return null;
        const hash = step.inputs ? inputHash(step, deps) : step.id;
        const stamp = join(CACHE, `${step.id}.sha256`);
        const fresh = step.fresh
          ? step.fresh()
          : existsSync(stamp) &&
            readFileSync(stamp, 'utf8') === hash &&
            step.outputs.every((file) => existsSync(join(ROOT, file)));
        if (fresh && !FORCE) {
          console.log(`[assets] ${step.id}: up to date`);
          return hash;
        }
        await acquire();
        try {
          if (failed) return null;
          checkBlender();
          rmSync(stamp, { force: true });
          const log = join(CACHE, `${step.id}.log`);
          console.log(`[assets] ${step.id}: building (log: ${relative(ROOT, log)})`);
          const start = performance.now();
          const code = await runLogged(step.commands, log);
          if (code !== 0) {
            failed = true;
            const tail = readFileSync(log, 'utf8').trimEnd().split('\n').slice(-30).join('\n');
            console.error(`[assets] ${step.id}: FAILED (exit ${code})\n${tail}`);
            return null;
          }
          writeFileSync(stamp, hash);
          console.log(
            `[assets] ${step.id}: built in ${((performance.now() - start) / 1000).toFixed(0)}s`
          );
          return hash;
        } finally {
          release();
        }
      })()
    );
  return results.get(step.id);
}

mkdirSync(CACHE, { recursive: true });
await Promise.all(STEPS.map(schedule));
if (failed) process.exit(1);

for (const file of ['export-proc-textures.mjs', 'export-models.mjs', 'validate-world-assets.mjs']) {
  const args = FORCE && file !== 'validate-world-assets.mjs' ? ['--force'] : [];
  const { status } = spawnSync(process.execPath, [join(ROOT, 'tools', file), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (status !== 0) process.exit(status ?? 1);
}
