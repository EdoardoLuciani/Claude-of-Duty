/** Blender soldier authoring and a Blender-free reader for the generated products. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { REVISION } from 'three';

import { VARIANTS } from '../../../src/ai/soldier.ts';
import { isRecord } from '../../../src/core/guards.ts';
import type { SoldierMetadata } from '../../../src/core/model-metadata.ts';
import { cookSoldier, validateMetadata } from './cook.ts';
import { soldierReference } from './reference.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const ASSET_ROOT = path.join(ROOT, 'assets/soldiers');
export const DEFAULT_SEED = 0x5eed1234;
export const SOURCE_INPUTS = Object.freeze([
  'tools/blender/soldiers/build.py',
  'tools/blender/soldiers/reference.ts',
  'tools/blender/soldiers/cook.ts',
  'tools/blender/soldiers/export.ts',
  'src/ai/rig.ts',
  'src/ai/soldier.ts',
  'src/ai/textures.ts', // CLOTH_TILE is the only external material calibration.
  'src/core/guards.ts',
  'src/core/model-metadata.ts',
  'tools/lib/export-glb.ts',
]);
interface SoldierManifest {
  version: number;
  seed: number;
  inputHash: string;
  blenderVersion: string;
  threeRevision: string;
  files: Record<string, string>;
}
interface SoldierProduct {
  name: string;
  glb: Buffer;
  json: Buffer;
  meta: SoldierMetadata;
}
const NAMES = Object.keys(VARIANTS);
export const BLENDER_VERSION = '5.2.2';
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
// Git may check text out with CRLF; unchanged source/JSON must not require Blender.
export const canonicalText = (bytes: Buffer): Buffer =>
  Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));

/** Absolute paths for the parent's cache dependency list; no file access or spawn. */
export function soldierInputPaths(root = ROOT): string[] {
  return SOURCE_INPUTS.map((file): string => path.join(root, file));
}

/** Runtime inputs only: normal builds neither read nor hash the large .blend files. */
export function soldierProductPaths(directory = ASSET_ROOT): string[] {
  return [
    'manifest.json',
    ...NAMES.flatMap((name): string[] => [`${name}.glb`, `${name}.json`]),
  ].map((file): string => path.join(directory, file));
}

/** LF source text + portable relative names + Three revision, never computed float JSON. */
export function soldierInputHash(root = ROOT): string {
  const hash = createHash('sha256').update(`soldiers-v1\0three:${REVISION}\0`);
  for (const file of SOURCE_INPUTS)
    hash
      .update(file)
      .update('\0')
      .update(canonicalText(fs.readFileSync(path.join(root, file))))
      .update('\0');
  return hash.digest('hex');
}

export function validateGLB(glb: unknown): asserts glb is Buffer {
  assert(Buffer.isBuffer(glb) && glb.length >= 12, 'GLB header');
  assert.equal(glb.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.equal(glb.readUInt32LE(4), 2, 'GLB version');
  assert.equal(glb.readUInt32LE(8), glb.length, 'GLB length');
  assert.equal(glb.length % 4, 0, 'GLB alignment');
}

/** Missing/stale/corrupt products fail; this reader never invokes Blender. */
export function loadCommittedSoldiers(directory = ASSET_ROOT): SoldierProduct[] {
  try {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')
    );
    assert(isRecord(manifest), 'soldier manifest object');
    assert.equal(manifest.version, 1, 'manifest version');
    assert(
      typeof manifest.seed === 'number' &&
        Number.isInteger(manifest.seed) &&
        manifest.seed >= 0 &&
        manifest.seed <= 0xffffffff,
      'manifest uint32 seed'
    );
    assert.equal(manifest.inputHash, soldierInputHash(), 'stale source input hash');
    assert.equal(manifest.blenderVersion, BLENDER_VERSION, 'manifest Blender version');
    assert.equal(manifest.threeRevision, REVISION, 'manifest Three revision');
    const files = NAMES.flatMap((name): string[] =>
      ['blend', 'glb', 'json'].map((ext): string => `${name}.${ext}`)
    );
    assert(isRecord(manifest.files), 'soldier manifest files');
    const products = manifest.files;
    assert.deepEqual(
      Object.keys(manifest.files).sort(),
      files.sort(),
      'complete exact soldier catalog'
    );
    for (const hash of Object.values(products))
      assert(typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'product SHA256');
    return NAMES.map((name): SoldierProduct => {
      const glb = fs.readFileSync(path.join(directory, `${name}.glb`));
      const json = canonicalText(fs.readFileSync(path.join(directory, `${name}.json`)));
      assert.equal(sha256(glb), products[`${name}.glb`], `${name} GLB hash`);
      assert.equal(sha256(json), products[`${name}.json`], `${name} metadata hash`);
      validateGLB(glb);
      const meta: unknown = JSON.parse(json.toString('utf8'));
      validateMetadata(meta, name);
      return { name, glb, json, meta };
    });
  } catch (cause) {
    throw new Error(
      `Invalid committed soldiers in ${directory}: ${cause instanceof Error ? cause.message : String(cause)}. Regenerate: bun tools/blender/soldiers/export.ts --output ${directory}`,
      { cause }
    );
  }
}

function run(blender: string, args: string[]): string {
  const result = spawnSync(blender, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Blender failed: ${result.error?.message ?? `exit ${result.status}`}\n${result.stderr ?? ''}\n${result.stdout ?? ''}`
    );
  }
  return result.stdout;
}

function atomicWrite(file: string, bytes: string | Uint8Array): void {
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** All variants are staged before publication. Only this explicit API needs Blender. */
export async function exportSoldiers({
  output,
  seed = DEFAULT_SEED,
  blender = process.env.BLENDER ?? 'blender',
}: {
  output: string | undefined;
  seed?: number | undefined;
  blender?: string | undefined;
}): Promise<SoldierManifest> {
  assert(typeof output === 'string' && path.isAbsolute(output), '--output must be absolute');
  assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'seed must be uint32');
  fs.mkdirSync(output, { recursive: true });
  const marker = path.join(output, 'manifest.json');
  // A failed authoring attempt must not leave a success marker for the new family.
  fs.rmSync(marker, { force: true });
  let temporary: string | undefined;
  try {
    const version = run(blender, ['--version']).split('\n')[0].trim();
    assert(
      /^Blender 5\.2\.2(?:\s|$)/.test(version),
      `requires Blender ${BLENDER_VERSION}; got ${version}`
    );
    const inputHash = soldierInputHash();
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cod-soldiers-'));
    const reference = path.join(temporary, 'reference.json');
    fs.writeFileSync(reference, JSON.stringify(soldierReference()));
    const manifest: SoldierManifest = {
      version: 1,
      seed,
      inputHash,
      blenderVersion: BLENDER_VERSION,
      threeRevision: REVISION,
      files: {},
    };
    for (const name of NAMES) {
      const directory = path.join(temporary, name);
      run(blender, [
        '-b',
        '--factory-startup',
        '-t',
        '2',
        '--python-exit-code',
        '1',
        '--python',
        path.join(ROOT, SOURCE_INPUTS[0]),
        '--',
        '--reference',
        reference,
        '--output',
        directory,
        '--variant',
        name,
        '--seed',
        String(seed),
      ]);
      const data: unknown = JSON.parse(
        fs.readFileSync(path.join(directory, `${name}.mesh.json`), 'utf8')
      );
      assert(isRecord(data), 'authoring payload object');
      assert.equal(data.name, name, 'authoring variant');
      assert.equal(data.seed, seed, 'authoring seed');
      const { glb, meta } = await cookSoldier(data);
      validateGLB(glb);
      fs.writeFileSync(path.join(directory, `${name}.glb`), glb);
      // Preserve canonical metadata bytes (no trailing newline).
      fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(meta, null, 2));
      for (const ext of ['blend', 'glb', 'json']) {
        const file = `${name}.${ext}`;
        manifest.files[file] = sha256(fs.readFileSync(path.join(directory, file)));
      }
    }
    assert.equal(soldierInputHash(), inputHash, 'sources changed during authoring; regenerate');
    for (const name of NAMES) {
      for (const ext of ['blend', 'glb', 'json']) {
        const file = `${name}.${ext}`;
        atomicWrite(path.join(output, file), fs.readFileSync(path.join(temporary, name, file)));
      }
    }
    atomicWrite(marker, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } catch (error) {
    fs.rmSync(marker, { force: true });
    throw error;
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { output: { type: 'string' }, seed: { type: 'string' }, blender: { type: 'string' } },
  });
  if (values.seed && !/^(?:0x[\da-f]+|\d+)$/i.test(values.seed))
    throw new Error('--seed must be uint32');
  const manifest = await exportSoldiers({
    output: values.output,
    seed: values.seed === undefined ? DEFAULT_SEED : Number(values.seed),
    blender: values.blender,
  });
  console.log(
    JSON.stringify({
      output: values.output,
      inputHash: manifest.inputHash,
      files: Object.keys(manifest.files),
    })
  );
}
