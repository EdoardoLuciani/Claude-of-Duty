#!/usr/bin/env bun
/** Shared gltfpack cook for generated runtime models. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
export const GLTFPACK_VERSION = 'gltfpack 1.3';
// Up to four asset workers cook concurrently; leave each a share of the CPUs.
const ENCODING_THREADS = Math.max(1, Math.floor(availableParallelism() / 4));
// Preserve named mechanics and authored timing. Float positions/UVs avoid
// dequantization wrapper nodes and texture-transform clones in the runtime.
export const GLTFPACK_FLAGS = [
  '-kn',
  '-ke',
  '-ac',
  '-af',
  '0',
  '-vpf',
  '-vp',
  '14',
  '-vtf',
  '-vt',
  '16',
  '-vn',
  '8',
  '-ar',
  '16',
  '-at',
  '24',
  '-as',
  '24',
  '-cc',
  '-tu',
  '-tq',
  '8',
];
// Opt assets in here after validating their adapters and visual/animation fidelity.
// Simplification is model-specific, never a blanket default for all models.
// `output` is repo-relative; runtime-mounted weapons/attachments are served from public/.
const attachment = (
  directory: string,
  source: string,
  runtime: string,
  flags: string[] = []
): { directory: string; source: string; output: string; flags: string[] } => ({
  directory: `assets/attachments/${directory}`,
  source,
  output: `public/models/attachments/${runtime}.runtime.glb`,
  flags,
});
export const MODEL_COOKS = {
  suppressor12g: attachment('12g-suppressor', 'suppressor12g.glb', 'suppressor12g'),
  suppressor9mm: attachment('compact-9mm', 'suppressor9mm.glb', 'suppressor9mm'),
  suppressor338: attachment('suppressor-338', 'suppressor338.glb', 'suppressor338'),
  srd762ti: attachment('sig-srd762ti', 'suppressor.glb', 'srd762ti'),
  acog: attachment('trijicon-acog', 'acog.glb', 'acog'),
  scope: attachment('schmidt-bender-pm-ii', 'scope.glb', 'scope'),
  rmr: attachment('trijicon-rmr', 'rmr.glb', 'rmr'),
  m67: {
    directory: 'assets/weapons/m67',
    source: 'm67.glb',
    output: 'public/models/weapons/m67.runtime.glb',
    flags: [],
  },
  m590: {
    directory: 'assets/weapons/m590',
    source: 'm590.glb',
    output: 'public/models/weapons/m590.runtime.glb',
    flags: ['-si', '0.50', '-se', '0.0002', '-sp', '-vc', '16'],
  },
  m4: {
    directory: 'assets/weapons/m4a1-block-ii',
    source: 'm4a1-block-ii.glb',
    output: 'public/models/weapons/m4a1-block-ii.runtime.glb',
    flags: ['-noq', '-vc', '16', '-kv'],
  },
  mcx: {
    directory: 'assets/weapons/mcx-virtus',
    source: 'mcx-virtus.glb',
    output: 'public/models/weapons/mcx-virtus.runtime.glb',
    flags: ['-si', '0.65', '-se', '0.0002', '-sp', '-vc', '16'],
  },
  evolys: {
    directory: 'assets/weapons/fn-evolys-762',
    source: 'fn-evolys-762.glb',
    output: 'public/models/weapons/fn-evolys-762.runtime.glb',
    flags: [],
  },
  ax338: {
    directory: 'assets/weapons/ax338',
    source: 'ax338.glb',
    output: 'public/models/weapons/ax338.runtime.glb',
    flags: ['-vc', '16', '-vp', '16'],
  },
  mpx: {
    directory: 'assets/weapons/sig-mpx',
    source: 'mpx.glb',
    output: 'public/models/weapons/mpx.runtime.glb',
    flags: ['-km', '-vc', '16', '-si', '0.7', '-se', '0.0002', '-sp'],
  },
  // Preserve the small aperture, screw slots and pressure-pad silhouettes.
  tor_mini: attachment('steiner-tor-mini', 'tor-mini.glb', 'laser'),
  // The P320 error limit clips the rounded optical opening on this smaller asset.
  exps3: attachment('eotech-exps3-0', 'exps3-0.glb', 'exps3', [
    '-si',
    '0.50',
    '-se',
    '0.0002',
    '-sp',
  ]),
  p320: {
    directory: 'assets/weapons/p320-compact',
    source: 'p320-compact.glb',
    output: 'public/models/weapons/p320-compact.runtime.glb',
    flags: ['-si', '0.50', '-se', '0.001', '-sp'],
  },
};

export type ModelId = keyof typeof MODEL_COOKS;

export function isModelId(value: string): value is ModelId {
  return Object.hasOwn(MODEL_COOKS, value);
}

function cookModel(input: string, output: string, flags: string[]): void {
  const encoder = process.env.GLTFPACK ?? 'gltfpack';
  assert.notEqual(input, output, 'never overwrite the native authoring export');
  assert.equal(extname(output), '.glb', 'runtime output must be a self-contained GLB');
  const version = execFileSync(encoder, ['-v'], { encoding: 'utf8' }).trim();
  assert.equal(
    version,
    GLTFPACK_VERSION,
    'use the pinned native gltfpack build with BasisU support'
  );
  const scratch = mkdtempSync(join(tmpdir(), 'model-cook-'));
  try {
    const cooked = join(scratch, basename(output));
    // Scheduling is machine-local, not part of the output-affecting cache flags.
    execFileSync(
      encoder,
      ['-i', input, '-o', cooked, ...GLTFPACK_FLAGS, '-tj', String(ENCODING_THREADS), ...flags],
      { stdio: 'inherit' }
    );
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(cooked, output);
    console.log(`Cooked ${input} -> ${output} (${statSync(output).size} bytes)`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [id, directory] = process.argv.slice(2);
  assert(process.argv.length <= 4, 'usage: bun run models:cook -- [model-id [asset-directory]]');
  const ids = id ? [id] : Object.keys(MODEL_COOKS);
  for (const name of ids) {
    assert(
      isModelId(name),
      `unknown model ${name}; available: ${Object.keys(MODEL_COOKS).join(', ')}`
    );
    const model = MODEL_COOKS[name];
    const dir = resolve(directory ?? join(ROOT, model.directory));
    cookModel(
      join(dir, model.source),
      directory ? join(dir, basename(model.output)) : join(ROOT, model.output),
      model.flags
    );
  }
}
