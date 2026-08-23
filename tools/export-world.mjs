#!/usr/bin/env node
/** Compile the authoritative JS world and cook meshoptimizer collision. */
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
import { buildCollision } from './worldgen/pack.js';
import { worldSourceHash } from './worldgen/source-hash.js';
import { init } from '@recast-navigation/core';
import { generateSoloNavMeshData } from '@recast-navigation/generators';
import { NAVMESH_CONFIG } from '../src/ai/navmesh.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  return match ? [match[1], match[2] ?? true] : [arg, true];
}));
const OUT = resolve(ROOT, String(args.out ?? 'public/models/world'));
const CACHE = resolve(ROOT, 'node_modules/.cache');
const LOCK = join(CACHE, 'claude-of-duty-world.lock');
const SEED = 0x5eed1234;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        queueMicrotask(() => this.onloadend?.());
      });
    }
  };
}

const exportGlb = (scene) => new GLTFExporter()
  .parseAsync(scene, { binary: true })
  .then((value) => Buffer.from(value));

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

/** Navmesh assets are raw serialized Detour bytes, so they carry a `.bin` ext. */
function navmeshName(data) {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
  return `level-navmesh.${hash}.bin.gz`;
}

/** Bake the collision scene (already world-space, instances baked) into a soup. */
function bakeNavMeshSoup(scene) {
  scene.updateWorldMatrix(true, true);
  const verts = [];
  const local = new THREE.Matrix4();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const count = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < count; k++) {
      if (o.isInstancedMesh) {
        o.getMatrixAt(k, local);
        local.premultiply(o.matrixWorld);
      } else {
        local.copy(o.matrixWorld);
      }
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(local);
        verts.push(v.x, v.y, v.z);
      }
    }
  });
  const vertices = new Float32Array(verts);
  const indices = new Uint32Array((vertices.length / 9) * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { vertices, indices };
}

/** Build + serialize a Recast/Detour navmesh for the collision scene. Async (WASM). */
async function buildNavMesh(collisionScene) {
  await init();
  const { vertices, indices } = bakeNavMeshSoup(collisionScene);
  const res = generateSoloNavMeshData(vertices, indices, NAVMESH_CONFIG);
  if (!res.success || !res.navMeshData?.size) throw new Error('navmesh generation failed');
  return Buffer.from(res.navMeshData.toTypedArray());
}

async function compileWorld() {
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
    const [visualBuffer, collision] = await Promise.all([
      exportGlb(visualScene),
      buildCollision(visualScene),
    ]);
    const collisionBuffer = await exportGlb(collision.scene);
    const navmeshBytes = await buildNavMesh(collision.scene);
    const visualGzip = gzipSync(visualBuffer, { level: 9 });
    const collisionGzip = gzipSync(collisionBuffer, { level: 9 });
    const navmeshGzip = gzipSync(navmeshBytes, { level: 9 });
    const visualFile = assetName('visual', visualGzip);
    const collisionFile = assetName('collision', collisionGzip);
    const navmeshFile = navmeshName(navmeshGzip);
    const stats = { ...A.stats, collideTris: collision.collideTris };
    const metadata = worldMetadata(A, buildings, worldSourceHash(ROOT));
    const manifestData = JSON.stringify({
      ...metadata,
      assets: { visual: visualFile, collision: collisionFile, navmesh: navmeshFile },
      stats,
    });

    if (args.check) {
      const expected = [
        [join(OUT, visualFile), visualGzip],
        [join(OUT, collisionFile), collisionGzip],
        [join(OUT, navmeshFile), navmeshGzip],
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
      writeAtomic(join(OUT, navmeshFile), navmeshGzip);
      writeAtomic(join(OUT, 'level.json'), manifestData);
      for (const file of readdirSync(OUT)) {
        if (file !== visualFile && file !== collisionFile && file !== navmeshFile &&
            (/^level-(visual|collision).*\.glb(?:\.gz)?$/.test(file) || /^level-navmesh\..*\.bin\.gz$/.test(file))) {
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
  }
}

await withLock(compileWorld);
await run(process.execPath, [
  resolve(ROOT, 'tools/validate-world-assets.mjs'),
  `--manifest=${join(OUT, 'level.json')}`,
]);
