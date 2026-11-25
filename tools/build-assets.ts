#!/usr/bin/env bun
/**
 * Build every generated runtime asset, skipping steps whose inputs are unchanged.
 * Blender and gltfpack are needed only when a Blender step is stale.
 * OW_SKIP_ASSETS=1 (`bun run build:ci`) skips Blender/model assets, but builds the world.
 *
 * Player arms run first, then the bandage, which re-saves player-arms.blend.
 * Every weapon loads that blend, so arm changes rebuild all weapons. Then weapons,
 * independent attachments, interaction props, the spent hull and soldiers share one bounded pool.
 * The Bun stages (procedural textures, soldier staging, world generation) keep their own caches.
 *
 * Input hashes live in .cache/assets/, outside node_modules so `bun ci` keeps them.
 * Usage: bun tools/build-assets.ts [--force]   Env: BLENDER, GLTFPACK tool paths.
 */
import { spawn, spawnSync, type StdioOptions } from 'node:child_process';
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
  writeSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REVISION } from 'three';

import {
  GLTFPACK_VERSION,
  MODEL_COOKS,
  authoredDirectory,
  isModelId,
  modelCookBaseFlags,
  type ModelId,
} from '../build/models.ts';

interface AssetStep {
  id: string;
  inputs: string[];
  outputs: string[];
  salt?: string[];
  commands: Array<[string, ...string[]]>;
}
import {
  ASSET_ROOT as SOLDIERS,
  BLENDER_VERSION,
  SOURCE_INPUTS as SOLDIER_INPUTS,
  canonicalText,
  soldierProductPaths,
} from './blender/soldiers/export.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'assets');
const BLENDER = process.env.BLENDER ?? 'blender';
// Bump when step definitions change in a way that must rebuild existing outputs.
const RECIPE = 'assets-v1';
const FORCE = process.argv.includes('--force');
const CORES = availableParallelism();
const JOBS = Math.max(1, Math.min(4, Math.floor(CORES / 4)));
const THREADS = String(Math.max(1, Math.floor(CORES / JOBS)));

const blender = (script: string): [string, ...string[]] => [
  BLENDER,
  '-b',
  '-t',
  THREADS,
  '--python-exit-code',
  '1',
  '--python',
  script,
];
const bun = (...args: string[]): [string, ...string[]] => [process.execPath, ...args];

const ARMS: AssetStep = {
  id: 'arms',
  inputs: ['tools/blender/player_arms'],
  outputs: [
    '.cache/blender/player/arms/player-arms.blend',
    'public/models/player/arms.glb',
    'public/models/player/bandage.glb',
  ],
  commands: [
    blender('tools/blender/player_arms/build.py'),
    blender('tools/blender/player_arms/bandage.py'),
  ],
};

export const SOLDIER_STEP: AssetStep = {
  id: 'soldiers',
  inputs: [...SOLDIER_INPUTS],
  salt: [REVISION],
  outputs: soldierProductPaths().map((file): string => relative(ROOT, file)),
  commands: [bun('tools/blender/soldiers/export.ts', '--output', SOLDIERS)],
};

const SPENT_HULL_STEP: AssetStep = {
  id: 'spent-hull',
  inputs: ['tools/blender/spent_hull', 'src/core/three-guards.ts'],
  salt: [REVISION],
  outputs: [
    '.cache/blender/fx/spent-hull/spent12g.blend',
    '.cache/blender/fx/spent-hull/spent12g.glb',
    'public/models/fx/spent12g.glb',
  ],
  commands: [blender('tools/blender/spent_hull/build.py'), bun('tools/blender/spent_hull/cook.ts')],
};

const STANDALONE_TOOLS: Partial<Record<ModelId, string[]>> = {
  intel_case: ['tools/blender/intel_case'],
  ammo_pickup: ['tools/blender/ammo_pickup'],
  m67: ['tools/blender/m67'],
  srd762ti: ['tools/blender/suppressor', 'tools/blender/can.py'],
  suppressor9mm: ['tools/blender/suppressor9mm', 'tools/blender/can.py'],
  suppressor338: ['tools/blender/suppressor338', 'tools/blender/can.py'],
  suppressor12g: ['tools/blender/suppressor12g', 'tools/blender/can.py'],
  acog: [
    'tools/blender/acog',
    'tools/blender/mcx/primitives.py',
    'tools/blender/mcx/materials.py',
    'tools/blender/mcx/export.py',
    'tools/blender/mcx/finishes.py',
  ],
  scope: ['tools/blender/scope'],
  rmr: ['tools/blender/rmr'],
  exps3: ['tools/blender/exps3'],
  tor_mini: ['tools/blender/tor_mini'],
  field_radio: ['tools/blender/field_radio/build.py'],
};

/** One Blender build plus its gltfpack cook for a MODEL_COOKS entry. */
function cookStep(id: ModelId, salt: string[]): AssetStep {
  const { directory, source, output } = MODEL_COOKS[id];
  const authored = authoredDirectory(id);
  // Weapons also depend on the shared review-arm baker and hand calibration helper.
  const tools = STANDALONE_TOOLS[id] ?? [
    `tools/blender/${id}`,
    'tools/blender/review_hands.py',
    'tools/blender/hand-reference.ts',
  ];
  return {
    id,
    inputs:
      id === 'field_radio'
        ? tools
        : [
            ...tools,
            ...(id === 'm67' || id === 'ammo_pickup' || id === 'intel_case'
              ? []
              : ['tools/blender/picatinny.py']),
            ...(authored ? [`${authored}/hand-reference.json`] : []),
          ],
    // Only this model's cook settings, so one profile edit rebuilds one model.
    salt: [...salt, JSON.stringify(MODEL_COOKS[id]), ...modelCookBaseFlags(id), GLTFPACK_VERSION],
    // The editable .blend is used by authoring and attachment-fit checks.
    outputs: [
      `${directory}/${source}`,
      output,
      `${directory}/${source.replace(/\.glb$/, '.blend')}`,
    ],
    commands: [
      blender(tools[0].endsWith('.py') ? tools[0] : `${tools[0]}/build.py`),
      bun('build/models.ts', id),
    ],
  };
}

function listFiles(path: string): string[] {
  const abs = join(ROOT, path);
  if (!statSync(abs).isDirectory()) return [path];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter(
      (entry): boolean =>
        entry.isFile() && !entry.name.endsWith('.md') && !entry.parentPath.includes('__pycache__')
    )
    .map((entry): string => relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

function inputHash(step: AssetStep): string {
  const hash = createHash('sha256').update(
    [RECIPE, BLENDER_VERSION, step.id, ...(step.salt ?? [])].join('\0')
  );
  for (const path of step.inputs.flatMap(listFiles)) {
    const bytes = readFileSync(join(ROOT, path));
    // Normalize text checkouts without decoding the binary Blender dependencies.
    hash
      .update(path)
      .update('\0')
      .update(path.endsWith('.blend') ? bytes : canonicalText(bytes))
      .update('\0');
  }
  return hash.digest('hex');
}

let blenderChecked = false;
function checkBlender(): void {
  if (blenderChecked) return;
  const result = spawnSync(BLENDER, ['--version'], { encoding: 'utf8' });
  if (result.error)
    throw new Error(
      `[assets] Blender not found (${BLENDER}). Install Blender ${BLENDER_VERSION} or set ` +
        'BLENDER; use `bun run build:ci` for a code-only build.'
    );
  const version = result.stdout.split('\n')[0].trim();
  // Cache stamps key on the pinned version, so another Blender must not write products.
  if (!version.startsWith(`Blender ${BLENDER_VERSION}`))
    throw new Error(`[assets] expected Blender ${BLENDER_VERSION}, found ${version}`);
  blenderChecked = true;
}

const run = ([command, ...args]: [string, ...string[]], stdio: StdioOptions): Promise<number> =>
  new Promise((done): void => {
    const child = spawn(command, args, { cwd: ROOT, stdio });
    child.on('error', (): void => done(1));
    child.on('exit', (code): void => done(code ?? 1));
  });

let failed = false;
async function build(step: AssetStep): Promise<void> {
  const hash = inputHash(step);
  const stamp = join(CACHE, `${step.id}.sha256`);
  if (
    !FORCE &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8') === hash &&
    step.outputs.every((file): boolean => existsSync(join(ROOT, file)))
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
    for (const command of step.commands) {
      const python = command.indexOf('--python');
      const label =
        python >= 0
          ? `Blender ${command[python + 1]}`
          : command[1] === 'build/models.ts'
            ? 'gltfpack cook'
            : (command[1] ?? command[0]);
      const prefix = `[assets] ${step.id}: ${label}`;
      const started = `${prefix}: starting`;
      console.log(started);
      writeSync(fd, `${started}\n`);
      const commandStart = performance.now();
      code = await run(command, ['ignore', fd, fd]);
      const elapsed = ((performance.now() - commandStart) / 1000).toFixed(2);
      const finished = `${prefix}: ${code ? `FAILED (exit ${code})` : 'finished'} in ${elapsed}s`;
      console.log(finished);
      writeSync(fd, `${finished}\n`);
      if (code) break;
    }
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
async function pool(steps: AssetStep[]): Promise<void> {
  const queue = [...steps];
  await Promise.all(
    Array.from({ length: JOBS }, async (): Promise<void> => {
      while (!failed) {
        const step = queue.shift();
        if (!step) break;
        await build(step);
      }
    })
  );
}

const stage = (file: string, ...args: string[]): Promise<number> =>
  run(bun(join(ROOT, 'tools', file), ...args), 'inherit');
// Importing recipes must not launch asset builds or exit the caller.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const force = FORCE ? ['--force'] : [];
  // The Bun world build is independent of Blender assets; run it alongside.
  const stages = [stage('export-world.ts', ...force)];
  if (!process.env.OW_SKIP_ASSETS) {
    mkdirSync(CACHE, { recursive: true });
    // Weapons load the arms blend, so they wait for it and hash its inputs.
    await build(ARMS);
    if (!failed) {
      const armsHash = inputHash(ARMS);
      await pool([
        ...Object.keys(MODEL_COOKS)
          .filter(isModelId)
          .filter((id): boolean => !Object.hasOwn(STANDALONE_TOOLS, id))
          .map((id): AssetStep => cookStep(id, [armsHash])),
        ...Object.keys(STANDALONE_TOOLS)
          .filter(isModelId)
          .map((id): AssetStep => cookStep(id, [])),
        SOLDIER_STEP,
        SPENT_HULL_STEP,
      ]);
    }
    if (!failed)
      stages.push(stage('export-proc-textures.ts', ...force), stage('export-models.ts', ...force));
  }
  const codes = await Promise.all(stages);
  process.exit(failed ? 1 : (codes.find(Boolean) ?? 0));
}
