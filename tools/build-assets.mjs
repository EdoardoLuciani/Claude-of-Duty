#!/usr/bin/env node
/**
 * Build every generated runtime asset, skipping steps whose inputs are unchanged.
 * Blender 5.2.2 and gltfpack 1.3 are needed only when a Blender step is stale.
 * OW_SKIP_ASSETS=1 (`bun run build:ci`) builds nothing and only validates the world.
 *
 * Player arms run first, then the bandage, which re-saves player-arms.blend.
 * Every weapon loads that blend, so arm changes rebuild all weapons. The EXPS3
 * sight and soldiers are independent. The Node-only stages (procedural textures,
 * soldier/spent-hull staging, world validation) keep their own caches.
 *
 * Input hashes live in .cache/assets/, outside node_modules so `bun ci` keeps them.
 * Usage: node tools/build-assets.mjs [--force]   Env: BLENDER, GLTFPACK tool paths.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
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

import { REVISION } from 'three';

import { GLTFPACK_FLAGS, GLTFPACK_VERSION, MODEL_COOKS } from '../build/models.mjs';
import {
  ASSET_ROOT as SOLDIERS,
  BLENDER_VERSION,
  SOURCE_INPUTS as SOLDIER_INPUTS,
  canonicalText,
} from './blender/soldiers/export.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'assets');
const BLENDER = process.env.BLENDER ?? 'blender';
// Bump when step definitions change in a way that must rebuild existing outputs.
const RECIPE = 'assets-v1';
const FORCE = process.argv.includes('--force');
const CORES = availableParallelism();
const JOBS = Math.max(1, Math.min(4, Math.floor(CORES / 4)));
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

const ARMS = {
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
};

const SOLDIER_STEP = {
  id: 'soldiers',
  inputs: [...SOLDIER_INPUTS],
  salt: [REVISION],
  outputs: ['assets/soldiers/manifest.json'],
  commands: [node('tools/blender/soldiers/export.mjs', '--output', SOLDIERS)],
};

// Blender tool directories a weapon imports beyond its own tools/blender/<id>/.
const EXTRA_TOOLS = { mpx: ['evolys'] };

/** One Blender build plus its gltfpack cook for a MODEL_COOKS entry. */
function cookStep(id, salt) {
  const { directory, source, output } = MODEL_COOKS[id];
  const standalone = id === 'exps3';
  const tools = standalone
    ? ['tools/blender/exps3.py', 'tools/blender/exps3_bake.py']
    : [id, ...(EXTRA_TOOLS[id] ?? [])].map((tool) => `tools/blender/${tool}`);
  return {
    id,
    inputs: [...tools, ...authoredJson(directory)],
    // Only this model's cook settings, so one profile edit rebuilds one model.
    salt: [...salt, JSON.stringify(MODEL_COOKS[id]), ...GLTFPACK_FLAGS, GLTFPACK_VERSION],
    outputs: [`${directory}/${source}`, output],
    commands: [
      blender(standalone ? tools[0] : `tools/blender/${id}/build.py`),
      node('build/models.mjs', id),
    ],
  };
}

function listFiles(path) {
  const abs = join(ROOT, path);
  if (!statSync(abs).isDirectory()) return [path];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && !entry.name.endsWith('.md') && !entry.parentPath.includes('__pycache__')
    )
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

function inputHash(step) {
  const hash = createHash('sha256').update([RECIPE, step.id, ...(step.salt ?? [])].join('\0'));
  for (const path of step.inputs.flatMap(listFiles))
    // CRLF checkouts alone must not trigger a Blender rebuild.
    hash
      .update(path)
      .update('\0')
      .update(canonicalText(readFileSync(join(ROOT, path))))
      .update('\0');
  return hash.digest('hex');
}

let blenderChecked = false;
function checkBlender() {
  if (blenderChecked) return;
  blenderChecked = true;
  const result = spawnSync(BLENDER, ['--version'], { encoding: 'utf8' });
  if (result.error)
    throw new Error(
      `[assets] Blender not found (${BLENDER}). Install Blender ${BLENDER_VERSION} or set ` +
        'BLENDER; use `bun run build:ci` for a code-only build.'
    );
  const version = result.stdout.split('\n')[0].trim();
  if (!version.startsWith(`Blender ${BLENDER_VERSION}`))
    console.warn(
      `[assets] expected Blender ${BLENDER_VERSION}, found ${version}; outputs may differ`
    );
}

const run = ([command, ...args], stdio) =>
  new Promise((done) => {
    const child = spawn(command, args, { cwd: ROOT, stdio });
    child.on('error', () => done(1));
    child.on('exit', (code) => done(code ?? 1));
  });

let failed = false;
async function build(step) {
  const hash = inputHash(step);
  const stamp = join(CACHE, `${step.id}.sha256`);
  if (
    !FORCE &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8') === hash &&
    step.outputs.every((file) => existsSync(join(ROOT, file)))
  ) {
    console.log(`[assets] ${step.id}: up to date`);
    return;
  }
  checkBlender();
  rmSync(stamp, { force: true });
  const log = join(CACHE, `${step.id}.log`);
  console.log(`[assets] ${step.id}: building (log: ${relative(ROOT, log)})`);
  const start = performance.now();
  const fd = openSync(log, 'w');
  let code = 0;
  try {
    for (const command of step.commands) if ((code = await run(command, ['ignore', fd, fd]))) break;
  } finally {
    closeSync(fd);
  }
  if (code) {
    failed = true;
    const tail = readFileSync(log, 'utf8').trimEnd().split('\n').slice(-30).join('\n');
    console.error(`[assets] ${step.id}: FAILED (exit ${code})\n${tail}`);
    return;
  }
  writeFileSync(stamp, hash);
  console.log(`[assets] ${step.id}: built in ${((performance.now() - start) / 1000).toFixed(0)}s`);
}

/** Build steps on JOBS workers; stops starting new steps after a failure. */
async function pool(steps) {
  const queue = [...steps];
  await Promise.all(
    Array.from({ length: JOBS }, async () => {
      while (queue.length && !failed) await build(queue.shift());
    })
  );
}

const stage = (file, ...args) => run(node(join(ROOT, 'tools', file), ...args), 'inherit');
const force = FORCE ? ['--force'] : [];
// The world check is independent of every generated asset; run it alongside.
const stages = [stage('validate-world-assets.mjs')];
if (!process.env.OW_SKIP_ASSETS) {
  mkdirSync(CACHE, { recursive: true });
  // Weapons load the arms blend, so they wait for it and hash its inputs.
  await pool([ARMS, cookStep('exps3', []), SOLDIER_STEP]);
  if (!failed) {
    const armsHash = inputHash(ARMS);
    await pool(
      Object.keys(MODEL_COOKS)
        .filter((id) => id !== 'exps3')
        .map((id) => cookStep(id, [armsHash]))
    );
  }
  if (!failed)
    stages.push(stage('export-proc-textures.mjs', ...force), stage('export-models.mjs', ...force));
}
const codes = await Promise.all(stages);
process.exit(failed ? 1 : (codes.find(Boolean) ?? 0));
