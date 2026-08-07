#!/usr/bin/env node
/**
 * WORLD EXPORTER — bakes the deterministic procedural level into runtime GLBs.
 *
 * The builders remain the authoring source during this migration, but they no
 * longer run in the browser. Runtime receives a render GLB, a deliberately
 * low-poly collision GLB, and a JSON gameplay manifest.
 */
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Rng } from '../src/core/rng.js';
import { Assembler } from '../src/world/builder.js';
import { buildWorld } from '../src/world/build.js';
import { STREET, ALLEYS } from '../src/world/layout.js';
import {
  LEVEL_YAW,
  LEVEL_TX,
  LEVEL_TZ,
  SPAWNS,
} from '../src/world/config.js';
import { encodeGLB, withAssetLock, writeAtomic, writeJsonAtomic } from './lib/assets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models', 'world');
const VISUAL = join(OUT, 'level-visual.glb');
const COLLISION = join(OUT, 'level-collision.glb');
const MANIFEST = join(OUT, 'level.json');
const VISUAL_GZIP = `${VISUAL}.gz`;
const COLLISION_GZIP = `${COLLISION}.gz`; 
const SEED = 0x5eed1234;

const materialCache = new Map();
const materials = {
  get(name, opts = {}) {
    const key = `${name}|${JSON.stringify(opts)}`;
    let mat = materialCache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ name, vertexColors: !!opts.vertexMasks });
      materialCache.set(key, mat);
    }
    return mat;
  },
};

function worldRng() {
  // Deterministic engine init consumes one root fork in render and one in
  // physics before world receives its own stream.
  const root = new Rng(SEED);
  root.fork();
  root.fork();
  return root.fork();
}

function preserveInstancedState(root) {
  root.traverse((o) => {
    if (!o.isInstancedMesh) return;
    // EXT_mesh_gpu_instancing stores decomposed TRS values. Their recomposition
    // is visually equivalent but not float32-identical, which moves occasional
    // TAA edge samples. Preserve the original authored matrices as GLB extras
    // and restore them after load for a pixel-stable migration.
    o.userData.owMatrices = Array.from(o.instanceMatrix.array);
  });
}

function preserveAuthoredNormals(root) {
  const seen = new Set();
  root.traverse((o) => {
    const geometry = o.geometry;
    if (!geometry || seen.has(geometry)) return;
    seen.add(geometry);
    const normal = geometry.getAttribute('normal');
    if (!normal) return;
    let needsPreserve = false;
    for (let i = 0; i < normal.count; i++) {
      const x = normal.getX(i), y = normal.getY(i), z = normal.getZ(i);
      if (Math.abs(Math.hypot(x, y, z) - 1) > 0.0005) { needsPreserve = true; break; }
    }
    // glTF correctly requires NORMAL to be unit length. Keep the authored values
    // in a custom accessor and restore them after load so the migration remains
    // pixel-compatible with the old shader interpolation.
    if (needsPreserve) geometry.setAttribute('_ow_normal', normal);
  });
}

function sceneSummary(root) {
  const out = { meshes: 0, instancedMeshes: 0, instances: 0, triangles: 0, missingPalette: [] };
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    out.meshes++;
    const geo = o.geometry;
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const count = o.isInstancedMesh ? o.count : 1;
    if (o.isInstancedMesh) {
      out.instancedMeshes++;
      out.instances += count;
    }
    out.triangles += tris * count;
    if (!o.userData?.palette && !o.userData?.surface) out.missingPalette.push(o.name);
  });
  return out;
}

async function parseGLB(buffer) {
  const loader = new GLTFLoader();
  return loader.parseAsync(buffer.slice(0), '');
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) throw new Error(`[world] round-trip ${label}: ${actual} != ${expected}`);
}

function meshList(root) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes.push(o); });
  return meshes;
}

function assertArray(label, a, b) {
  assertEqual(`${label} length`, b?.length, a?.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) throw new Error(`[world] round-trip ${label}[${i}]: ${b[i]} != ${a[i]}`);
  }
}

function validateMeshData(label, sourceRoot, loadedRoot, collision = false) {
  const source = meshList(sourceRoot);
  const loaded = meshList(loadedRoot);
  assertEqual(`${label} mesh count`, loaded.length, source.length);
  for (let i = 0; i < source.length; i++) {
    const a = source[i], b = loaded[i];
    assertArray(`${label}[${i}] position`, a.geometry.attributes.position.array, b.geometry.attributes.position.array);
    const ai = a.geometry.index?.array, bi = b.geometry.index?.array;
    if (ai || bi) assertArray(`${label}[${i}] index`, ai, bi);
    if (collision) continue;
    for (const key of ['uv', 'color']) {
      const aa = a.geometry.getAttribute(key), bb = b.geometry.getAttribute(key);
      if (aa || bb) assertArray(`${label}[${i}] ${key}`, aa?.array, bb?.array);
    }
    const loadedNormal = b.geometry.getAttribute('_ow_normal') ?? b.geometry.getAttribute('normal');
    assertArray(`${label}[${i}] normal`, a.geometry.attributes.normal.array, loadedNormal.array);
    if (a.isInstancedMesh) {
      assertArray(`${label}[${i}] instance matrix`, a.instanceMatrix.array, b.userData.owMatrices);
      const ac = a.instanceColor?.array, bc = b.instanceColor?.array;
      if (ac || bc) assertArray(`${label}[${i}] instance color`, ac, bc);
    }
  }
}

async function validateRoundTrip(sourceVisual, sourceCollision, visualBuffer, collisionBuffer) {
  const [visual, collision] = await Promise.all([parseGLB(visualBuffer), parseGLB(collisionBuffer)]);
  const sv = sceneSummary(sourceVisual);
  const lv = sceneSummary(visual.scene);
  const sc = sceneSummary(sourceCollision);
  const lc = sceneSummary(collision.scene);

  for (const key of ['meshes', 'instancedMeshes', 'instances', 'triangles']) {
    assertEqual(`visual ${key}`, lv[key], sv[key]);
  }
  for (const key of ['meshes', 'triangles']) assertEqual(`collision ${key}`, lc[key], sc[key]);
  if (lv.missingPalette.length) {
    throw new Error(`[world] visual meshes lost palette metadata: ${lv.missingPalette.slice(0, 5).join(', ')}`);
  }
  if (lc.missingPalette.length) {
    throw new Error(`[world] collision meshes lost surface metadata: ${lc.missingPalette.slice(0, 5).join(', ')}`);
  }
  validateMeshData('visual', sourceVisual, visual.scene);
  validateMeshData('collision', sourceCollision, collision.scene, true);
  return { visual: lv, collision: lc };
}

async function exportWorld() {
const t0 = performance.now();
console.log('[world] exporting to', OUT);

const A = new Assembler({ materials, rng: worldRng(), render: null });
A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
const infos = buildWorld(A, A.rng);
const root = new THREE.Group();
root.name = 'world';
A.finalize(root, null);
A.releaseCache();

// Collision is a separate, authored proxy tree. Never make the visual GLB the
// physics source: its hundreds of thousands of decorative triangles would make
// character sweeps and nav sampling needlessly expensive.
const collisionRoot = A.collisionRoot;
root.remove(collisionRoot);
collisionRoot.visible = true;
for (const mesh of collisionRoot.children) {
  mesh.visible = true;
  // StaticWorld computes geometric normals itself. Removing render-only vertex
  // channels keeps the dedicated collision asset compact without changing one
  // query result.
  mesh.geometry.deleteAttribute('normal');
  mesh.geometry.deleteAttribute('uv');
  mesh.geometry.deleteAttribute('color');
}

preserveAuthoredNormals(root);
preserveInstancedState(root);

const visualScene = new THREE.Scene();
visualScene.name = 'world-visual';
visualScene.add(root);
const collisionScene = new THREE.Scene();
collisionScene.name = 'world-collision';
collisionScene.add(collisionRoot);

const [visualBuffer, collisionBuffer] = await Promise.all([
  encodeGLB(visualScene),
  encodeGLB(collisionScene, { onlyVisible: false }),
]);
const validated = await validateRoundTrip(root, collisionRoot, visualBuffer, collisionBuffer);

// Use the Assembler's quaternion-composed matrix verbatim. Reconstructing the
// same yaw with makeRotationY differs in the last float64 bits, which is enough
// to move an antialiased minimap line by one subpixel.
const matrix = A.xform.clone();
const bounds = new THREE.Box3(
  new THREE.Vector3(-62, -2, -62),
  new THREE.Vector3(62, 26, 62)
).applyMatrix4(matrix);
const manifest = {
  version: 2,
  seed: SEED,
  transform: {
    yaw: LEVEL_YAW,
    translation: [LEVEL_TX, 0, LEVEL_TZ],
    matrix: matrix.toArray(),
  },
  bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  spawns: SPAWNS.map(([x, z, yaw, tag]) => ({
    position: new THREE.Vector3(x, 0, z).applyMatrix4(matrix).toArray(),
    yaw: yaw + LEVEL_YAW,
    tag,
  })),
  buildings: infos.map((info) => ({
    spec: info.spec,
    floorY: info.floorY,
    roofY: info.roofY,
    top: info.top,
  })),
  lights: {
    interiors: A.interiorLights.slice(0, 20),
    lamps: A.lampAnchors,
  },
  queries: { street: STREET, alleys: ALLEYS },
  stats: A.stats,
  roundTrip: validated,
};

const visualBytes = Buffer.from(visualBuffer);
const collisionBytes = Buffer.from(collisionBuffer);
writeAtomic(VISUAL, visualBytes);
writeAtomic(COLLISION, collisionBytes);
// GLB's float buffers compress extremely well. Runtime explicitly inflates
// these files with DecompressionStream, reducing the default transfer by ~6x
// while retaining a byte-lossless raw GLB fallback for older browsers.
writeAtomic(VISUAL_GZIP, gzipSync(visualBytes, { level: 9 }));
writeAtomic(COLLISION_GZIP, gzipSync(collisionBytes, { level: 9 }));
writeJsonAtomic(MANIFEST, manifest);

console.log(
  `[world] ${(validated.visual.triangles / 1000).toFixed(0)}k rendered tris, ` +
  `${validated.visual.instances} instances, ${(validated.collision.triangles / 1000).toFixed(1)}k collision tris`
);
console.log(
  `[world] visual ${(statSync(VISUAL).size / 1048576).toFixed(1)} MB raw / ` +
  `${(statSync(VISUAL_GZIP).size / 1048576).toFixed(1)} MB transfer, collision ` +
  `${(statSync(COLLISION_GZIP).size / 1048576).toFixed(1)} MB transfer, ` +
  `${(performance.now() - t0).toFixed(0)}ms including round-trip validation`
);

A.dispose();
for (const mat of materialCache.values()) mat.dispose();
}

await withAssetLock(ROOT, 'world', exportWorld);
