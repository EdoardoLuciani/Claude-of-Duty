#!/usr/bin/env bun
/**
 * Stage Blender-authored soldiers and generate the offline spent hull. This script
 * never runs Blender: tools/build-assets.ts regenerates assets/soldiers/ first.
 *
 * Content hashing covers shared inputs and canonical products. Missing outputs
 * force a full restage; --force bypasses the cache. Keep the pid lock and atomic
 * writes: overlapping asset commands must never publish half-written files.
 * Runtime retains canonical RIG joints, FLOAT attributes and nine surface groups.
 */

import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, renameSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RIG } from '../src/ai/rig.ts';
import { VARIANTS } from '../src/ai/soldier.ts';
import { isRecord } from '../src/core/guards.ts';
import {
  loadCommittedSoldiers,
  soldierInputPaths,
  soldierProductPaths,
} from './blender/soldiers/export.ts';
import { exportGlb } from './lib/export-glb.ts';
import { buildSpentHull } from './lib/spent-hull.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models');
// Lock lives outside public/ so the dev server never serves it and the watcher never
// sees it. mkdir is atomic, which makes it a usable mutex; ownership and an
// init grace period make the mutex safe (see withLock).
const LOCK_DIR = join(ROOT, 'node_modules', '.cache', 'claude-of-duty-models.lock');
const LOCK_OWNER = join(LOCK_DIR, 'owner.json');
const HASH_STAMP = join(ROOT, 'node_modules', '.cache', 'claude-of-duty-models.hash');
const LOCK_TIMEOUT_MS = 60000;
/** How long a lock with no owner.json is presumed to be initialising.
 *  Overridable so tests can exercise the grace path quickly. */
const LOCK_GRACE_MS = Number(process.env.MODELS_LOCK_GRACE_MS ?? 10000);

/** Write through a temp file + atomic rename: readers never see partial data. */
function writeAtomic(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r): void => {
    setTimeout(r, ms);
  });

/** A pid is conclusively stale only when ESRCH says it is gone; EPERM means
 *  alive-but-inaccessible, which must keep waiting. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return isRecord(err) && err.code === 'EPERM';
  }
}

/**
 * Serialise exporter runs.
 *
 * Protocol: mkdir(LOCK_DIR) is the atomic claim; the winner then writes
 * owner.json `{ pid, token, createdAt }`. Contenders never delete a lock
 * immediately:
 *  - no owner.json  -> the winner is between mkdir and owner.json; treat the
 *    lock as active for LOCK_GRACE_MS before declaring it crashed mid-init
 *  - owner pid alive -> wait
 *  - owner pid ESRCH -> conclusively stale, steal
 * On release the owner removes the lock ONLY if owner.json still carries its
 * own token, so a late-releasing old owner cannot delete a replacement owner's
 * freshly-created lock.
 */
async function withLock(fn: () => Promise<void>): Promise<void> {
  const token = `${process.pid}-${randomUUID()}`;
  const t0 = Date.now();
  mkdirSync(dirname(LOCK_DIR), { recursive: true }); // ensure .cache exists
  for (;;) {
    try {
      mkdirSync(LOCK_DIR); // non-recursive: atomic, throws EEXIST on contention
      writeFileSync(LOCK_OWNER, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
      break;
    } catch (err) {
      if (!isRecord(err) || err.code !== 'EEXIST') throw err;
      // Contention: is the incumbent conclusively dead?
      let owner: unknown = null;
      try {
        owner = JSON.parse(readFileSync(LOCK_OWNER, 'utf8'));
      } catch {
        owner = null; // missing or half-written owner.json
      }
      const waitingMs = Date.now() - t0;
      const pid =
        isRecord(owner) &&
        typeof owner.pid === 'number' &&
        Number.isSafeInteger(owner.pid) &&
        owner.pid > 0
          ? owner.pid
          : null;
      const stale = pid === null ? waitingMs > LOCK_GRACE_MS : !pidAlive(pid);
      if (stale) {
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      if (waitingMs > LOCK_TIMEOUT_MS) {
        throw new Error(
          `[models] exporter lock held for >${LOCK_TIMEOUT_MS / 1000}s by pid ${pid ?? '<unknown>'} — remove ${LOCK_DIR}`
        );
      }
      await sleep(200);
    }
  }
  try {
    return await fn();
  } finally {
    // Release only our own lock: if a contender stole it after we died (or a
    // new owner took over), the token will not match and the lock must stay.
    try {
      const own: unknown = JSON.parse(readFileSync(LOCK_OWNER, 'utf8'));
      if (isRecord(own) && own.token === token) rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch {
      /* lock already gone or replaced */
    }
  }
}

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
  const files = [
    'tools/export-models.ts',
    'tools/lib/export-glb.ts',
    'tools/lib/spent-hull.ts',
    'src/weapons/geometry.ts',
    'src/weapons/defs.ts',
    'src/weapons/mathx.ts',
    ...soldierInputPaths().map((file): string => relative(ROOT, file)),
    ...soldierProductPaths().map((file): string => relative(ROOT, file)),
    'src/core/rng.ts',
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(ROOT, file)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function assertInputsStable(expected: string): void {
  if (modelSourceHash() !== expected)
    throw new Error('[models] inputs changed during staging; rerun bun run models');
}

function outputsPresent(): boolean {
  const stems = Object.keys(VARIANTS).map((name): string => `soldiers/${name}`);
  return (
    existsSync(join(OUT, 'fx/spent12g.glb')) &&
    stems.every(
      (p): boolean => existsSync(join(OUT, `${p}.glb`)) && existsSync(join(OUT, `${p}.json`))
    )
  );
}

/* ====================================================================== */
/*  main                                                                  */
/* ====================================================================== */

const FORCE = process.argv.includes('--force');
const tStart = performance.now();
console.log('[models] exporting to', OUT);

await withLock(async (): Promise<void> => {
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
  const hull = buildSpentHull();
  writeAtomic(join(OUT, 'fx/spent12g.glb'), await exportGlb(hull));
  hull.geometry.dispose();
  hull.material.dispose();

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
