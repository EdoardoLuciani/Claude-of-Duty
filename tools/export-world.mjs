#!/usr/bin/env node
/** Compile the authoritative JS world and cook Blender-decimated collision. */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Rng } from '../src/core/rng.js';
import { Assembler } from './worldgen/builder.js';
import { buildWorld } from './worldgen/build.js';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/config.js';
import { worldMetadata } from './worldgen/metadata.js';
import { buildCollision, exportBinary, loadGlb } from './worldgen/pack.js';
import { worldSourceHash } from './worldgen/source-hash.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  return match ? [match[1], match[2] ?? true] : [arg, true];
}));
const OUT = resolve(ROOT, String(args.out ?? 'public/models/world'));
const BLENDER = String(args.blender ?? process.env.BLENDER ?? 'blender');
const CACHE = resolve(ROOT, 'node_modules/.cache');
const LOCK = join(CACHE, 'claude-of-duty-world.lock');
const SEED = 0x5eed1234;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, data);
  renameSync(temporary, file);
}

async function withLock(fn) {
  mkdirSync(CACHE, { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, 'owner.json'), JSON.stringify({ pid: process.pid, started: Date.now() }));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const owner = JSON.parse(readFileSync(join(LOCK, 'owner.json'), 'utf8'));
        try { process.kill(owner.pid, 0); } catch (signalError) { stale = signalError.code === 'ESRCH'; }
      } catch {
        stale = Date.now() - started > 10000;
      }
      if (stale) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > 120000) throw new Error('[world] timed out waiting for export lock');
      await sleep(150);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

function run(command, commandArgs) {
  return new Promise((done, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? done() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function worldRng() {
  const root = new Rng(SEED);
  root.fork();
  root.fork();
  return root.fork();
}

function assetName(kind, data) {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
  return `level-${kind}.${hash}.glb.gz`;
}

async function compileWorld() {
  const temp = mkdtempSync(join(CACHE, 'world-procedural-'));
  const started = performance.now();
  const materialCache = new Map();
  const materials = {
    get(name, options = {}) {
      const key = `${name}|${!!options.vertexMasks}`;
      let material = materialCache.get(key);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ name, vertexColors: !!options.vertexMasks });
        materialCache.set(key, material);
      }
      return material;
    },
  };
  const A = new Assembler({ materials, rng: worldRng() });

  try {
    A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
    const buildings = buildWorld(A, A.rng);
    const visualRoot = new THREE.Group();
    visualRoot.name = 'world';
    A.finalize(visualRoot);
    A.releaseCache();

    const visualScene = new THREE.Scene();
    visualScene.add(visualRoot);
    const visualBuffer = Buffer.from(await new GLTFExporter().parseAsync(visualScene, { binary: true }));
    const visualStage = join(temp, 'visual.glb');
    const collisionStage = join(temp, 'collision-expanded.glb');
    writeFileSync(visualStage, visualBuffer);

    await run(BLENDER, [
      '--background', '--factory-startup',
      '--python', resolve(ROOT, 'tools/blender/cook-world-collision.py'), '--',
      '--visual', visualStage,
      '--out', collisionStage,
    ]);

    const collision = buildCollision(await loadGlb(collisionStage));
    const collisionBuffer = await exportBinary(collision.scene);
    const visualGzip = gzipSync(visualBuffer, { level: 9 });
    const collisionGzip = gzipSync(collisionBuffer, { level: 9 });
    const visualFile = assetName('visual', visualGzip);
    const collisionFile = assetName('collision', collisionGzip);
    const stats = { ...A.stats, collideTris: collision.collideTris };
    const metadata = worldMetadata(A, buildings, worldSourceHash(ROOT));
    const manifestData = JSON.stringify({
      ...metadata,
      assets: { visual: visualFile, collision: collisionFile },
      stats,
    });

    if (args.check) {
      const expected = [
        [join(OUT, visualFile), visualGzip],
        [join(OUT, collisionFile), collisionGzip],
        [join(OUT, 'level.json'), Buffer.from(manifestData)],
      ];
      for (const [file, data] of expected) {
        if (!existsSync(file) || !readFileSync(file).equals(data)) {
          throw new Error(`[world] committed asset is stale: ${file}`);
        }
      }
    } else {
      mkdirSync(OUT, { recursive: true });
      writeAtomic(join(OUT, visualFile), visualGzip);
      writeAtomic(join(OUT, collisionFile), collisionGzip);
      writeAtomic(join(OUT, 'level.json'), manifestData);
      for (const file of readdirSync(OUT)) {
        if (/^level-(visual|collision).*\.glb(?:\.gz)?$/.test(file) && file !== visualFile && file !== collisionFile) {
          rmSync(join(OUT, file));
        }
      }
    }

    console.log(
      `[world] ${args.check ? 'verified' : 'exported'} ${stats.drawCalls} draws / ${stats.instances} instances, ` +
      `${stats.collideTris} collision tris, ${(visualGzip.length / 1048576).toFixed(1)} + ` +
      `${(collisionGzip.length / 1048576).toFixed(1)} MiB in ${(performance.now() - started).toFixed(0)}ms`
    );
  } finally {
    A.dispose();
    for (const material of materialCache.values()) material.dispose();
    rmSync(temp, { recursive: true, force: true });
  }
}

await withLock(compileWorld);
await run(process.execPath, [
  resolve(ROOT, 'tools/validate-world-assets.mjs'),
  `--manifest=${join(OUT, 'level.json')}`,
]);
