#!/usr/bin/env bun
/**
 * Stage Blender-authored soldiers. This script never runs Blender:
 * tools/build-assets.ts regenerates .cache/blender/soldiers/ first.
 *
 * Content hashing covers shared inputs and canonical products. Missing outputs
 * force a full restage; --force bypasses the cache. Keep the pid lock and atomic
 * writes: overlapping asset commands must never publish half-written files.
 * Runtime retains canonical RIG joints, FLOAT attributes and nine surface groups.
 */

import { readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RIG } from '../src/ai/rig.ts';
import { VARIANTS } from '../src/ai/soldier.ts';
import {
  loadCommittedSoldiers,
  soldierInputPaths,
  soldierProductPaths,
} from './blender/soldiers/export.ts';
import { withLock, writeAtomic } from './lib/lock.ts';
import { hashFiles, sourceClosure } from './lib/source-hash.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models');
// Lock lives outside public/ so the dev server never serves it and the watcher never
// sees it. mkdir is atomic, which makes it a usable mutex; ownership and an
// init grace period make the mutex safe (see withLock).
const LOCK_DIR = join(ROOT, 'node_modules', '.cache', 'claude-of-duty-models.lock');
const HASH_STAMP = join(ROOT, 'node_modules', '.cache', 'claude-of-duty-models.hash');
/** Overridable so tests can exercise the missing-owner grace period quickly. */
const LOCK_GRACE_MS = Number(process.env.MODELS_LOCK_GRACE_MS ?? 10000);

/* ====================================================================== */
/*  soldiers                                                              */
/* ====================================================================== */

function stageSoldier({
  name,
  glb,
  json,
  meta,
}: ReturnType<typeof loadCommittedSoldiers>[number]): void {
  writeAtomic(join(OUT, 'soldiers', `${name}.glb`), glb);
  writeAtomic(join(OUT, 'soldiers', `${name}.json`), json);
  console.log(
    `[models] staged ${name}: ${(meta.stats.triangles / 1000).toFixed(1)}k tris, ` +
      `${(glb.length / 1024).toFixed(0)} KB glb`
  );
}

function modelSourceHash(): string {
  const files = new Set([
    ...sourceClosure(ROOT, ['tools/export-models.ts']),
    ...[...soldierInputPaths(), ...soldierProductPaths()].map((file): string =>
      relative(ROOT, file)
    ),
  ]);
  return hashFiles(ROOT, [...files]);
}

function assertInputsStable(expected: string): void {
  if (modelSourceHash() !== expected)
    throw new Error('[models] inputs changed during staging; rerun bun tools/export-models.ts');
}

function outputsPresent(): boolean {
  const stems = Object.keys(VARIANTS).map((name): string => `soldiers/${name}`);
  return stems.every(
    (p): boolean => existsSync(join(OUT, `${p}.glb`)) && existsSync(join(OUT, `${p}.json`))
  );
}

/* ====================================================================== */
/*  main                                                                  */
/* ====================================================================== */

const FORCE = process.argv.includes('--force');
const tStart = performance.now();
console.log('[models] exporting to', OUT);

const lockOptions = { label: 'models', graceMs: LOCK_GRACE_MS, timeoutMs: 60000, pollMs: 200 };
await withLock(LOCK_DIR, lockOptions, async (): Promise<void> => {
  // Authored replacements must remove stale procedural outputs on cache hits.
  for (const id of ['lmg', 'smg', 'sniper', 'shotgun']) {
    for (const ext of ['glb', 'json'])
      rmSync(join(OUT, 'weapons', `${id}.${ext}`), { force: true });
  }
  const hash = modelSourceHash();
  const soldiers = loadCommittedSoldiers();
  assertInputsStable(hash);
  if (
    !FORCE &&
    outputsPresent() &&
    existsSync(HASH_STAMP) &&
    readFileSync(HASH_STAMP, 'utf8').trim() === hash
  ) {
    console.log(`[models] up to date (${hash})`);
    return;
  }
  rmSync(HASH_STAMP, { force: true });

  for (const product of soldiers) stageSoldier(product);

  // Bone order is load-bearing (agents bind the exported geometry to their own
  // RIG skeleton by index); assert it once at export time.
  {
    const { bones } = RIG.createSkeleton();
    const names = bones.map((b): string => b.name);
    const expected = RIG.names;
    if (names.join() !== expected.join()) {
      console.error('[models] skeleton bone order diverged from RIG — aborting');
      process.exit(1);
    }
    console.log(`[models] skeleton ok: ${names.length} bones in RIG order`);
  }
  assertInputsStable(hash);
  writeAtomic(HASH_STAMP, hash + '\n');
});

console.log(`[models] done in ${(performance.now() - tStart).toFixed(0)}ms`);
