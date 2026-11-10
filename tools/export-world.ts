#!/usr/bin/env bun
/** Compile the authoritative JS world and cook meshoptimizer collision. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

import * as THREE from 'three';

import { buildWorld } from '#worldgen/build';
import { Assembler } from '#worldgen/builder';
import { worldMetadata } from '#worldgen/metadata';
import { bakeNav } from '#worldgen/nav-bake';

import { NAV_VERSION } from '../src/ai/nav-format.ts';
import { isRecord } from '../src/core/guards.ts';
import type { MaterialOptions } from '../src/materials/index.ts';
import { exportGlb } from './lib/export-glb.ts';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/level/config.ts';
import { buildCollision } from './worldgen/pack.ts';
import { worldSourceHash } from './worldgen/source-hash.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: { out: { type: 'string' }, force: { type: 'boolean' }, check: { type: 'boolean' } },
});
const OUT = resolve(ROOT, String(args.out ?? 'public/models/world'));
const CACHE = resolve(ROOT, 'node_modules/.cache');
const LOCK = join(CACHE, 'claude-of-duty-world.lock');
const sleep = (ms: number): Promise<void> =>
  new Promise((done): void => {
    setTimeout(done, ms);
  });

function writeAtomic(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, data);
  renameSync(temporary, file);
}

async function withLock(fn: () => Promise<void>): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(LOCK);
      writeFileSync(
        join(LOCK, 'owner.json'),
        JSON.stringify({ pid: process.pid, started: Date.now() })
      );
      break;
    } catch (error) {
      if (!isRecord(error) || error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const owner: unknown = JSON.parse(readFileSync(join(LOCK, 'owner.json'), 'utf8'));
        if (
          !isRecord(owner) ||
          typeof owner.pid !== 'number' ||
          !Number.isSafeInteger(owner.pid) ||
          owner.pid <= 0
        )
          throw new Error('invalid lock owner');
        try {
          process.kill(owner.pid, 0);
        } catch (signalError) {
          stale = isRecord(signalError) && signalError.code === 'ESRCH';
        }
      } catch {
        stale = Date.now() - started > 10000;
      }
      if (stale) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > 120000)
        throw new Error('[world] timed out waiting for export lock');
      await sleep(150);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

function run(command: string, commandArgs: string[]): Promise<void> {
  return new Promise((done, reject): void => {
    const child = spawn(command, commandArgs, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code): void =>
      code === 0 ? done() : reject(new Error(`${command} exited with ${code}`))
    );
  });
}

function assetName(kind: string, data: Uint8Array, ext = 'glb.gz'): string {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
  return `level-${kind}.${hash}.${ext}`;
}

function cacheReady(): boolean {
  if (args.force || args.check) return false;
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(OUT, 'level.json'), 'utf8'));
    if (
      !isRecord(manifest) ||
      manifest.sourceHash !== worldSourceHash(ROOT) ||
      !isRecord(manifest.assets)
    )
      return false;
    const assets = manifest.assets;
    return ['visual', 'collision', 'nav'].every((kind): boolean => {
      const file = assets[kind];
      return typeof file === 'string' && existsSync(join(OUT, file));
    });
  } catch {
    return false;
  }
}

async function compileWorld(): Promise<void> {
  const started = performance.now();
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  const materials = {
    get(name: string, options: MaterialOptions = {}): THREE.MeshStandardMaterial {
      const key = `${name}|${!!options.vertexMasks}`;
      let material = materialCache.get(key);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ name, vertexColors: !!options.vertexMasks });
        materialCache.set(key, material);
      }
      return material;
    },
  };
  const A = new Assembler({ materials });

  try {
    A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
    const buildings = buildWorld(A);
    const visualRoot = new THREE.Group();
    visualRoot.name = 'world';
    // Keep collision/nav on the canonical buckets, independent of visual compaction.
    const collisionSource = new THREE.Scene();
    A.finalize(visualRoot, collisionSource);
    A.releaseCache();

    const visualScene = new THREE.Scene();
    visualScene.add(visualRoot);
    const [visualBuffer, collision] = await Promise.all([
      exportGlb(visualScene),
      buildCollision(collisionSource),
    ]);
    const collisionBuffer = await exportGlb(collision.scene);
    const visualGzip = gzipSync(visualBuffer, { level: 9 });
    const collisionGzip = gzipSync(collisionBuffer, { level: 9 });
    const visualFile = assetName('visual', visualGzip);
    const collisionFile = assetName('collision', collisionGzip);
    const stats = { ...A.stats, collideTris: collision.collideTris };
    const metadata = worldMetadata(A, buildings, worldSourceHash(ROOT));
    const navBounds = new THREE.Box3(
      new THREE.Vector3().fromArray(metadata.bounds.min),
      new THREE.Vector3().fromArray(metadata.bounds.max)
    );
    const nav = await bakeNav(
      collision.scene,
      navBounds,
      { sourceHash: metadata.sourceHash, collisionAsset: collisionFile },
      metadata.volumes
    );
    const navGzip = gzipSync(Buffer.from(nav.buffer), { level: 9 });
    const navFile = assetName('nav', navGzip, 'bin.gz');
    const manifestData =
      JSON.stringify(
        {
          ...metadata,
          assets: { visual: visualFile, collision: collisionFile, nav: navFile },
          navigation: {
            version: NAV_VERSION,
            sha256: createHash('sha256').update(nav.buffer).digest('hex'),
            polygons: nav.polygons,
            components: nav.components,
            coverPoints: nav.coverCount,
          },
          stats,
        },
        null,
        2
      ) + '\n';

    if (args.check) {
      const expected: Array<[string, Buffer]> = [
        [join(OUT, visualFile), visualGzip],
        [join(OUT, collisionFile), collisionGzip],
        [join(OUT, navFile), navGzip],
        [join(OUT, 'level.json'), Buffer.from(manifestData)],
      ];
      for (const [file, data] of expected) {
        if (!existsSync(file) || !readFileSync(file).equals(data)) {
          throw new Error(`[world] generated asset is stale: ${file}`);
        }
      }
    } else {
      mkdirSync(OUT, { recursive: true });
      writeAtomic(join(OUT, visualFile), visualGzip);
      writeAtomic(join(OUT, collisionFile), collisionGzip);
      writeAtomic(join(OUT, navFile), navGzip);
      writeAtomic(join(OUT, 'level.json'), manifestData);
      for (const file of readdirSync(OUT)) {
        if (
          /^level-(visual|collision)\./.test(file) &&
          file !== visualFile &&
          file !== collisionFile
        ) {
          rmSync(join(OUT, file));
        }
        if (file.startsWith('level-nav.') && file !== navFile) rmSync(join(OUT, file));
      }
    }

    console.log(
      `[world] ${args.check ? 'verified' : 'exported'} ${stats.drawCalls} draws / ${stats.instances} instances, ` +
        `${stats.collideTris} collision tris, ${(visualGzip.length / 1048576).toFixed(1)} + ` +
        `${(collisionGzip.length / 1048576).toFixed(1)} MiB, nav ${nav.polygons} polygons / ` +
        `${nav.components} components / ${nav.coverCount} cover (bvh ${nav.bvhMs.toFixed(0)}ms + ` +
        `bake ${nav.bakeMs.toFixed(0)}ms) in ` +
        `${(performance.now() - started).toFixed(0)}ms`
    );
  } finally {
    A.dispose();
    for (const material of materialCache.values()) material.dispose();
  }
}

await withLock(async (): Promise<void> => {
  if (cacheReady()) console.log('[world] up to date');
  else await compileWorld();
  await run(process.execPath, [
    resolve(ROOT, 'tools/validate-world-assets.ts'),
    `--manifest=${join(OUT, 'level.json')}`,
  ]);
});
