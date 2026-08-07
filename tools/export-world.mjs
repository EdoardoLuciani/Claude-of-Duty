#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Rng } from '../src/core/rng.js';
import { Assembler } from '../src/world/builder.js';
import { buildWorld } from '../src/world/build.js';
import { LEVEL_YAW, LEVEL_TX, LEVEL_TZ, SPAWNS } from '../src/world/config.js';

// GLTFExporter expects the browser FileReader API when it reads a Blob back.
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models', 'world');
const SEED = 0x5eed1234;

const materialCache = new Map();
const materials = {
  get(name, opts = {}) {
    const key = `${name}|${!!opts.vertexMasks}`;
    let material = materialCache.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ name, vertexColors: !!opts.vertexMasks });
      materialCache.set(key, material);
    }
    return material;
  },
};

function worldRng() {
  const root = new Rng(SEED);
  root.fork(); // render
  root.fork(); // physics
  return root.fork(); // world
}

function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, data);
  renameSync(temporary, file);
}

function assetName(kind, data) {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
  return `level-${kind}.${hash}.glb.gz`;
}

const started = performance.now();
const A = new Assembler({ materials, rng: worldRng(), render: null });
A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
const buildings = buildWorld(A, A.rng);

const visualRoot = new THREE.Group();
visualRoot.name = 'world';
A.finalize(visualRoot, null);
A.releaseCache();

const collisionRoot = A.collisionRoot;
visualRoot.remove(collisionRoot);
collisionRoot.visible = true;
for (const mesh of collisionRoot.children) {
  mesh.visible = true;
  mesh.geometry.deleteAttribute('normal');
  mesh.geometry.deleteAttribute('uv');
  mesh.geometry.deleteAttribute('color');
}

const visualScene = new THREE.Scene();
visualScene.add(visualRoot);
const collisionScene = new THREE.Scene();
collisionScene.add(collisionRoot);

const exporter = new GLTFExporter();
const [visualBuffer, collisionBuffer] = await Promise.all([
  exporter.parseAsync(visualScene, { binary: true }),
  new GLTFExporter().parseAsync(collisionScene, { binary: true }),
]);
const visualGzip = gzipSync(Buffer.from(visualBuffer), { level: 9 });
const collisionGzip = gzipSync(Buffer.from(collisionBuffer), { level: 9 });
const visualFile = assetName('visual', visualGzip);
const collisionFile = assetName('collision', collisionGzip);

mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) {
  if (/^level-(visual|collision).*\.glb(?:\.gz)?$/.test(file)) rmSync(join(OUT, file));
}
writeAtomic(join(OUT, visualFile), visualGzip);
writeAtomic(join(OUT, collisionFile), collisionGzip);

const matrix = A.xform.clone();
const bounds = new THREE.Box3(
  new THREE.Vector3(-62, -2, -62),
  new THREE.Vector3(62, 26, 62)
).applyMatrix4(matrix);
const manifest = {
  version: 1,
  assets: { visual: visualFile, collision: collisionFile },
  transform: matrix.toArray(),
  bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  spawns: SPAWNS.map(([x, z, yaw, tag]) => ({
    position: new THREE.Vector3(x, 0, z).applyMatrix4(matrix).toArray(),
    yaw: yaw + LEVEL_YAW,
    tag,
  })),
  buildings: buildings.map(({ spec, floorY, roofY, top }) => ({ spec, floorY, roofY, top })),
  lights: { interiors: A.interiorLights.slice(0, 20), lamps: A.lampAnchors },
  stats: A.stats,
};
writeAtomic(join(OUT, 'level.json'), JSON.stringify(manifest));

console.log(
  `[world] exported ${(visualGzip.length / 1048576).toFixed(1)} MB visual + ` +
  `${(collisionGzip.length / 1048576).toFixed(1)} MB collision in ` +
  `${(performance.now() - started).toFixed(0)}ms`
);

A.dispose();
for (const material of materialCache.values()) material.dispose();
