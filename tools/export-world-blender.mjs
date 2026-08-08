#!/usr/bin/env node
/** Export runtime world assets from assets/world/world.blend. */
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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
  return match ? [match[1], match[2] ?? true] : [arg, true];
}));
const SOURCE = resolve(ROOT, String(args.source ?? 'assets/world/world.blend'));
const SOURCE_META = resolve(ROOT, String(args.metadata ?? 'assets/world/world.meta.json'));
const OUT = resolve(ROOT, String(args.out ?? 'public/models/world'));
const BLENDER = String(args.blender ?? process.env.BLENDER ?? 'blender');
const CACHE = resolve(ROOT, 'node_modules/.cache');
const LOCK = join(CACHE, 'claude-of-duty-world-blender.lock');
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
      if (Date.now() - started > 120000) throw new Error('[world:blender] timed out waiting for export lock');
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

async function loadGlb(file) {
  const buffer = readFileSync(file);
  const array = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new GLTFLoader().parseAsync(array, `${dirname(file)}/`);
}

function runtimeVisualData(source) {
  const data = {
    surface: source.surface,
    palette: source.palette,
    collision: false,
  };
  if (source.castShadow !== undefined) data.castShadow = source.castShadow;
  if (source.receiveShadow !== undefined) data.receiveShadow = source.receiveShadow;
  if (source.owLodDist !== undefined) data.owLodDist = source.owLodDist;
  if (source.owNoPrepass !== undefined) data.owNoPrepass = source.owNoPrepass;
  return data;
}

function triangleCount(geometry) {
  return (geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3;
}

function buildVisual(gltf) {
  gltf.scene.updateWorldMatrix(true, true);
  const meshes = [];
  gltf.scene.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });

  const groups = new Map();
  const staticGroups = new Map();
  for (const mesh of meshes) {
    const group = mesh.userData.cod_instance_group;
    if (group) {
      (groups.get(group) ?? groups.set(group, []).get(group)).push(mesh);
    } else {
      const data = runtimeVisualData(mesh.userData);
      const key = JSON.stringify(data);
      (staticGroups.get(key) ?? staticGroups.set(key, { data, meshes: [] }).get(key)).meshes.push(mesh);
    }
  }

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);
  const stats = { staticTris: 0, instTris: 0, instances: 0, drawCalls: 0 };

  for (const { data, meshes: sources } of staticGroups.values()) {
    const parts = sources.map((source) => source.geometry.clone().applyMatrix4(source.matrixWorld));
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!geometry) throw new Error(`[world:blender] could not merge static palette ${data.palette}`);
    const mesh = new THREE.Mesh(geometry, sources[0].material);
    mesh.name = `world_${data.palette}`;
    mesh.userData = data;
    mesh.castShadow = mesh.userData.castShadow !== false;
    mesh.receiveShadow = mesh.userData.receiveShadow !== false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    stats.staticTris += triangleCount(geometry);
    stats.drawCalls++;
    if (parts.length > 1) for (const part of parts) part.dispose();
  }

  for (const [groupName, members] of groups) {
    members.sort((a, b) => a.userData.cod_instance_index - b.userData.cod_instance_index);
    const first = members[0];
    if (members.some((mesh) => mesh.geometry !== first.geometry)) {
      throw new Error(`[world:blender] instance group ${groupName} does not share one geometry`);
    }
    for (let i = 0; i < members.length; i++) {
      if (members[i].userData.cod_instance_index !== i) {
        throw new Error(`[world:blender] instance group ${groupName} has non-contiguous indices`);
      }
    }
    const mesh = new THREE.InstancedMesh(first.geometry, first.material, members.length);
    mesh.name = groupName.replace(/\.\d{3}$/, '');
    mesh.userData = runtimeVisualData(first.userData);
    mesh.castShadow = mesh.userData.castShadow !== false;
    mesh.receiveShadow = mesh.userData.receiveShadow !== false;
    mesh.matrixAutoUpdate = false;
    let hasColor = false;
    const colors = new Float32Array(members.length * 3);
    for (let i = 0; i < members.length; i++) {
      mesh.setMatrixAt(i, members[i].matrixWorld);
      const color = members[i].userData.cod_instance_color;
      if (color) hasColor = true;
      colors[i * 3] = color?.[0] ?? 1;
      colors[i * 3 + 1] = color?.[1] ?? 1;
      colors[i * 3 + 2] = color?.[2] ?? 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (hasColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.computeBoundingSphere();
    mesh.updateMatrix();
    root.add(mesh);
    const triangles = triangleCount(first.geometry);
    stats.instTris += triangles * members.length;
    stats.instances += members.length;
    stats.drawCalls++;
  }
  return { scene, stats };
}

function buildCollision(gltf) {
  gltf.scene.updateWorldMatrix(true, true);
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'world_collision';
  scene.add(root);
  const material = new THREE.MeshBasicMaterial({ name: 'collision', visible: false });
  let collideTris = 0;
  gltf.scene.traverse((source) => {
    if (!source.isMesh) return;
    const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
    for (const attribute of ['normal', 'uv', 'uv1', 'color', 'tangent']) geometry.deleteAttribute(attribute);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = source.name;
    mesh.userData.surface = source.userData.surface;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    collideTris += triangleCount(geometry);
  });
  return { scene, collideTris };
}

async function exportBinary(scene) {
  const value = await new GLTFExporter().parseAsync(scene, { binary: true });
  return Buffer.from(value);
}

function assetName(kind, data) {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
  return `level-${kind}.${hash}.glb.gz`;
}

async function exportWorld() {
  if (!existsSync(SOURCE)) throw new Error(`[world:blender] source does not exist: ${SOURCE}`);
  if (!existsSync(SOURCE_META)) throw new Error(`[world:blender] metadata does not exist: ${SOURCE_META}`);
  const temp = mkdtempSync(join(CACHE, 'world-blender-'));
  const started = performance.now();
  try {
    await run(BLENDER, [
      '--background', SOURCE,
      '--python', resolve(ROOT, 'tools/blender/export-world.py'), '--',
      '--out', temp,
      '--metadata', SOURCE_META,
    ]);
    const [visualInput, collisionInput] = await Promise.all([
      loadGlb(join(temp, 'visual-expanded.glb')),
      loadGlb(join(temp, 'collision-expanded.glb')),
    ]);
    const visual = buildVisual(visualInput);
    const collision = buildCollision(collisionInput);
    const [visualBuffer, collisionBuffer] = await Promise.all([
      exportBinary(visual.scene),
      exportBinary(collision.scene),
    ]);
    const visualGzip = gzipSync(visualBuffer, { level: 9 });
    const collisionGzip = gzipSync(collisionBuffer, { level: 9 });
    const visualFile = assetName('visual', visualGzip);
    const collisionFile = assetName('collision', collisionGzip);
    const metadata = JSON.parse(readFileSync(join(temp, 'metadata.json'), 'utf8'));
    const manifest = {
      ...metadata,
      assets: { visual: visualFile, collision: collisionFile },
      stats: { ...visual.stats, collideTris: collision.collideTris },
    };

    const manifestData = JSON.stringify(manifest);
    if (args.check) {
      const expected = [
        [join(OUT, visualFile), visualGzip],
        [join(OUT, collisionFile), collisionGzip],
        [join(OUT, 'level.json'), Buffer.from(manifestData)],
      ];
      for (const [file, data] of expected) {
        if (!existsSync(file) || !readFileSync(file).equals(data)) {
          throw new Error(`[world:blender] committed asset is stale: ${file}`);
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
      `[world:blender] ${args.check ? 'verified' : 'exported'} ${visual.stats.drawCalls} draws / ${visual.stats.instances} instances, ` +
      `${collision.collideTris} collision tris, ${(visualGzip.length / 1048576).toFixed(1)} + ` +
      `${(collisionGzip.length / 1048576).toFixed(1)} MiB in ${(performance.now() - started).toFixed(0)}ms`
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

await withLock(exportWorld);
await run(process.execPath, [
  resolve(ROOT, 'tools/validate-world-assets.mjs'),
  `--manifest=${join(OUT, 'level.json')}`,
]);
