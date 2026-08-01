#!/usr/bin/env node
/**
 * MODEL EXPORTER — turns the procedural model builders into proper GLB assets.
 *
 * The weapon and soldier meshes are authored as code (src/weapons/models/*,
 * src/ai/soldier.js) because that is how they were designed: parameterised
 * assemblies driven by published dimensions. Building them at every boot costs
 * ~0.5 s of CPU (weapons) plus a first-spawn hitch per soldier variant, so this
 * tool runs the SAME builders once, offline, and bakes the result into GLB
 * files that the game loads at runtime (src/core/models.js).
 *
 *   node tools/export-models.mjs          # export everything
 *   node tools/export-models.mjs --force  # ignore up-to-date files
 *
 * Output layout (served by vite from public/):
 *   public/models/weapons/{rifle,smg,pistol}.glb + .json   (mesh + rig metadata)
 *   public/models/soldiers/{vanguard,irregular,breacher}.glb + .json
 *
 * The pipeline is deterministic: soldiers draw from a fixed RNG seed so a
 * rebuild of an unchanged tree is byte-identical. Every invocation exports
 * ALL models — there is no mtime freshness check, because the builders share
 * inputs (parts.js, geometry.js, rig.js, geo.js, ...) that a per-file check
 * cannot see, and a stale GLB is worse than a rebuild. Writes go through a
 * temp file + rename so a reader never observes a half-written asset, and a
 * pid lock (node_modules/.cache) serialises concurrent invocations (the vite
 * dev watcher and the predev/prebuild hooks can overlap).
 *
 * Round-trip guarantees (verified in the loader):
 *  - positions/normals/uvs/colors are written as FLOAT accessors — lossless.
 *  - skinIndex/skinWeight survive (JOINTS_0/WEIGHTS_0).
 *  - material GROUPS on a soldier become one glTF primitive each and are
 *    re-merged into a single BufferGeometry with groups on load, so the game
 *    keeps its one-draw-call-per-material character.
 *  - the skeleton is exported in RIG bone order; the loader asserts it.
 *  - each mesh carries `userData.mat` (its material slot) via glTF extras.
 */

import { writeFileSync, mkdirSync, statSync, existsSync, renameSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// three's GLTFExporter reads Blobs back with FileReader, which Node lacks.
// Shim it over Blob.arrayBuffer(); the exporter assigns `onloadend` right
// after `readAsArrayBuffer` returns, so the microtask fires after it is set.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        queueMicrotask(() => this.onloadend?.());
      });
    }
  };
}

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

import { Rng } from '../src/core/rng.js';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { buildSmg } from '../src/weapons/models/smg.js';
import { buildPistol } from '../src/weapons/models/pistol.js';
import { buildSoldier, VARIANTS } from '../src/ai/soldier.js';
import { RIG } from '../src/ai/rig.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models');
// Lock lives outside public/ so vite never serves it and the watcher never
// sees it. mkdir is atomic, which makes it a usable mutex.
const LOCK_DIR = join(ROOT, 'node_modules', '.cache', 'claude-of-duty-models.lock');
const LOCK_PID = join(LOCK_DIR, 'pid');
const LOCK_TIMEOUT_MS = 60000;

/** Fixed seed so exports are reproducible. */
const SEED = 0x5eed1234;

/** A materials stub for the builders: geometry-only export, real materials are
 *  resolved at runtime against the exported slot names. */
const stubMaterials = {
  get: (key) => new THREE.MeshStandardMaterial({ name: key, metalness: 0.4, roughness: 0.6 }),
  glass: () => new THREE.MeshStandardMaterial({ name: 'glass', metalness: 0, roughness: 0.05 }),
};

const exporter = new GLTFExporter();

/** Write through a temp file + atomic rename: readers never see partial data. */
function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

async function writeGLB(scene, file) {
  const buffer = await exporter.parseAsync(scene, { binary: true });
  writeAtomic(file, Buffer.from(buffer));
}

function writeJSON(obj, file) {
  writeAtomic(file, JSON.stringify(obj, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serialise exporter runs. mkdir(LOCK_DIR) is atomic; a lock whose pid is no
 * longer alive is stale and gets stolen. Waits up to LOCK_TIMEOUT_MS, then
 * fails loudly rather than writing interleaved assets.
 */
async function withLock(fn) {
  const t0 = Date.now();
  mkdirSync(dirname(LOCK_DIR), { recursive: true }); // ensure .cache exists
  for (;;) {
    try {
      mkdirSync(LOCK_DIR); // non-recursive: atomic, throws EEXIST on contention
      writeFileSync(LOCK_PID, String(process.pid));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let alive = true;
      try {
        const pid = Number(readFileSync(LOCK_PID, 'utf8'));
        if (Number.isFinite(pid) && pid > 0) process.kill(pid, 0);
      } catch {
        alive = false; // unreadable pid file or dead process — stale lock
      }
      if (!alive) {
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - t0 > LOCK_TIMEOUT_MS) {
        throw new Error(`[models] exporter lock held for >${LOCK_TIMEOUT_MS / 1000}s — remove ${LOCK_DIR}`);
      }
      await sleep(200);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}

/* ====================================================================== */
/*  weapons                                                               */
/* ====================================================================== */

/**
 * Optic descriptors (the `opticGlass` node) are plain data with centre/lens/
 * aperture fields, but the model files attach them in different shapes; reduce
 * to exactly the fields the viewmodel reads.
 */
function serializeOptic(v) {
  if (!v) return null;
  return {
    center: v.center ?? [0, 0, 0],
    lensZ: v.lensZ ?? 0,
    apertureR: v.apertureR ?? 0.01,
    tubeR: v.tubeR ?? 0.015,
    len: v.len ?? 0.05,
  };
}

/** nodes are all plain data except `opticGlass` / `slideGeom` assemblies. */
function serializeNodes(nodes) {
  const out = {};
  for (const [k, v] of Object.entries(nodes)) {
    if (k === 'opticGlass') out[k] = serializeOptic(v);
    else if (v && typeof v === 'object' && (v.center || v.lensZ !== undefined)) out[k] = serializeOptic(v);
    else out[k] = v;
  }
  return out;
}

function buildWeaponScene(id, builder) {
  const model = builder();
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = `${id}-model`;
  scene.add(root);

  const addAssembly = (asm, parent, name) => {
    const map = asm.build(); // merge per material, exactly like the viewmodel did
    let tris = 0;
    for (const [matKey, geo] of map) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: matKey }));
      mesh.name = `${name}-${matKey}`;
      mesh.userData.mat = matKey; // exported as extras, read back on load
      parent.add(mesh);
      tris += geo.getIndex() ? geo.getIndex().count / 3 : geo.getAttribute('position').count / 3;
    }
    return tris;
  };

  const body = new THREE.Group();
  body.name = `${id}-body`;
  root.add(body);
  let tris = addAssembly(model.body, body, `${id}-body`);

  const moving = {};
  for (const [key, asm] of Object.entries(model.moving)) {
    const g = new THREE.Group();
    g.name = `${id}-${key}`;
    root.add(g);
    tris += addAssembly(asm, g, `${id}-${key}`);
    moving[key] = true;
  }

  const meta = {
    id: model.id,
    label: model.label,
    fxClass: model.fxClass,
    nodes: serializeNodes(model.nodes),
    shell: model.shell,
    magSize: model.magSize,
  };
  return { scene, meta, tris };
}

async function exportWeapon(id, builder) {
  const glb = join(OUT, 'weapons', `${id}.glb`);
  const json = join(OUT, 'weapons', `${id}.json`);
  const t0 = performance.now();
  const { scene, meta, tris } = buildWeaponScene(id, builder);
  await writeGLB(scene, glb);
  writeJSON(meta, json);
  const kb = statSync(glb).size / 1024;
  console.log(`[models] ${id}: ${(tris / 1000).toFixed(1)}k tris, ${kb.toFixed(0)} KB glb in ${(performance.now() - t0).toFixed(0)}ms`);
}

/* ====================================================================== */
/*  soldiers                                                              */
/* ====================================================================== */

function buildSoldierScene(name) {
  const rng = new Rng(SEED);
  const built = buildSoldier(name, { rng, materials: stubMaterials });
  const { bones, skeleton, root: rootBone } = RIG.createSkeleton();

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = `${name}-model`;
  scene.add(root);
  root.add(rootBone);

  const placeholders = (built.slots ?? built.materialNames).map(
    (slot) => new THREE.MeshStandardMaterial({ name: slot })
  );
  const mesh = new THREE.SkinnedMesh(built.geometry, placeholders);
  mesh.name = `${name}-body`;
  mesh.bind(skeleton);
  root.add(mesh);
  scene.updateMatrixWorld(true);

  const meta = {
    name,
    slots: built.slots,
    weapon: {
      muzzle: built.weapon.muzzle,
      foregrip: built.weapon.foregrip,
      magBottom: built.weapon.magBottom,
      ejection: built.weapon.ejection,
      stockTop: built.weapon.stockTop,
    },
    stats: built.stats,
    variant: built.variant,
  };
  return { scene, meta };
}

async function exportSoldier(name) {
  const glb = join(OUT, 'soldiers', `${name}.glb`);
  const json = join(OUT, 'soldiers', `${name}.json`);
  const t0 = performance.now();
  const { scene, meta } = buildSoldierScene(name);
  await writeGLB(scene, glb);
  writeJSON(meta, json);
  const kb = statSync(glb).size / 1024;
  console.log(
    `[models] ${name}: ${(meta.stats.triangles / 1000).toFixed(1)}k tris, ${kb.toFixed(0)} KB glb ` +
      `in ${(performance.now() - t0).toFixed(0)}ms`
  );
}

/* ====================================================================== */
/*  main                                                                  */
/* ====================================================================== */

const tStart = performance.now();
console.log('[models] exporting to', OUT);

await withLock(async () => {
  await exportWeapon('rifle', buildRifle);
  await exportWeapon('smg', buildSmg);
  await exportWeapon('pistol', buildPistol);

  for (const name of Object.keys(VARIANTS)) await exportSoldier(name);

  // Bone order is load-bearing (agents bind the exported geometry to their own
  // RIG skeleton by index); assert it once at export time.
  {
    const { bones } = RIG.createSkeleton();
    const names = bones.map((b) => b.name);
    const expected = RIG.names;
    if (names.join() !== expected.join()) {
      console.error('[models] skeleton bone order diverged from RIG — aborting');
      process.exit(1);
    }
    console.log(`[models] skeleton ok: ${names.length} bones in RIG order`);
  }
});

console.log(`[models] done in ${(performance.now() - tStart).toFixed(0)}ms`);
