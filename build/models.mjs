#!/usr/bin/env node
/** Explicit runtime-model regeneration; ordinary builds use committed GLBs. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GLTFPACK_VERSION = 'gltfpack 1.3';
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
  '10',
  '-tj',
  '1',
];
// Opt assets in here after validating their adapters and visual/animation fidelity.
// Simplification is model-specific, never a blanket default for all models.
export const MODEL_COOKS = {
  exps3: {
    directory: 'assets/attachments/eotech-exps3-0',
    source: 'exps3-0.glb',
    output: 'exps3-0.runtime.glb',
    // The P320 error limit clips the rounded optical opening on this smaller asset.
    flags: ['-si', '0.50', '-se', '0.0002', '-sp'],
  },
  p320: {
    directory: 'assets/weapons/p320-compact',
    source: 'p320-compact.glb',
    output: 'p320-compact.runtime.glb',
    flags: ['-si', '0.50', '-se', '0.001', '-sp'],
  },
};

export function cookModel(
  { input, output, flags = [] },
  encoder = process.env.GLTFPACK ?? 'gltfpack'
) {
  input = resolve(input);
  output = resolve(output);
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
    execFileSync(encoder, ['-i', input, '-o', cooked, ...GLTFPACK_FLAGS, ...flags], {
      stdio: 'inherit',
    });
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(cooked, output);
    console.log(`Cooked ${input} -> ${output} (${statSync(output).size} bytes)`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [id, directory] = process.argv.slice(2);
  assert(process.argv.length <= 4, 'usage: npm run models:cook -- [model-id [asset-directory]]');
  const ids = id ? [id] : Object.keys(MODEL_COOKS);
  for (const name of ids) {
    assert(
      Object.hasOwn(MODEL_COOKS, name),
      `unknown model ${name}; available: ${Object.keys(MODEL_COOKS).join(', ')}`
    );
    const model = MODEL_COOKS[name],
      dir = resolve(directory ?? join(ROOT, model.directory));
    cookModel({
      input: join(dir, model.source),
      output: join(dir, model.output),
      flags: model.flags,
    });
  }
}
