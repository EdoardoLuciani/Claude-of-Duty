#!/usr/bin/env node
/** Validate committed runtime world assets without regenerating them. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { PALETTE } from '../src/world/palette.js';
import { SURFACE_NAMES } from '../src/physics/surfaces.js';
import { worldSourceHash } from './worldgen/source-hash.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? true] : [arg, true];
  })
);
const manifestPath = resolve(ROOT, String(args.manifest ?? 'public/models/world/level.json'));
const errors = [];
const paletteKeys = new Set(Object.keys(PALETTE));
const surfaces = new Set(SURFACE_NAMES);

const fail = (message) => errors.push(message);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function requireArray(value, length, label) {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) {
    fail(`${label} must be an array${length === undefined ? '' : ` of length ${length}`}`);
    return false;
  }
  return true;
}

function requireVector(value, label) {
  if (!requireArray(value, 3, label)) return false;
  if (!value.every(finite)) {
    fail(`${label} must contain only finite numbers`);
    return false;
  }
  return true;
}

function parseGlbGzip(file, kind) {
  if (!file) return null;
  if (!existsSync(file)) {
    fail(`${kind} asset does not exist: ${file}`);
    return null;
  }

  let compressed;
  let glb;
  try {
    compressed = readFileSync(file);
    glb = gunzipSync(compressed);
  } catch (error) {
    fail(`${kind} asset is not a readable gzip stream: ${error.message}`);
    return null;
  }

  const hashMatch = basename(file).match(/\.([a-f0-9]{12})\.glb\.gz$/);
  if (!hashMatch) {
    fail(`${kind} filename must contain a 12-character content hash: ${basename(file)}`);
  } else {
    const actual = createHash('sha256').update(compressed).digest('hex').slice(0, 12);
    if (actual !== hashMatch[1]) {
      fail(`${kind} filename hash is ${hashMatch[1]}, but its content hash is ${actual}`);
    }
  }

  if (glb.length < 20 || glb.toString('ascii', 0, 4) !== 'glTF') {
    fail(`${kind} asset is not a binary glTF file`);
    return null;
  }
  if (glb.readUInt32LE(4) !== 2) fail(`${kind} GLB version must be 2`);
  if (glb.readUInt32LE(8) !== glb.length) {
    fail(`${kind} GLB header length does not match the decompressed file length`);
  }

  const jsonLength = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > glb.length) {
    fail(`${kind} GLB has no valid leading JSON chunk`);
    return null;
  }

  try {
    const text = glb.toString('utf8', 20, 20 + jsonLength).replace(/[\u0000 ]+$/, '');
    return { json: JSON.parse(text), compressedBytes: compressed.length, glbBytes: glb.length };
  } catch (error) {
    fail(`${kind} GLB JSON is invalid: ${error.message}`);
    return null;
  }
}

function accessorCount(gltf, index, label) {
  const count = gltf.accessors?.[index]?.count;
  if (!Number.isInteger(count) || count < 0) {
    fail(`${label} references an invalid accessor ${index}`);
    return 0;
  }
  return count;
}

function primitiveTriangles(gltf, primitive, label) {
  if (primitive.mode !== undefined && primitive.mode !== 4) {
    fail(`${label} must use TRIANGLES mode`);
    return 0;
  }
  const count = primitive.indices !== undefined
    ? accessorCount(gltf, primitive.indices, `${label}.indices`)
    : accessorCount(gltf, primitive.attributes?.POSITION, `${label}.POSITION`);
  if (count % 3 !== 0) fail(`${label} has ${count} vertices/indices, which is not divisible by three`);
  return count / 3;
}

function inspectVisual(asset) {
  if (!asset) return null;
  const gltf = asset.json;
  let drawCalls = 0;
  let staticTris = 0;
  let instTris = 0;
  let instances = 0;

  for (let nodeIndex = 0; nodeIndex < (gltf.nodes?.length ?? 0); nodeIndex++) {
    const node = gltf.nodes[nodeIndex];
    if (node.mesh === undefined) continue;
    drawCalls++;
    const label = `visual node ${node.name ?? nodeIndex}`;
    const palette = node.extras?.palette;
    if (!paletteKeys.has(palette)) fail(`${label} has unknown or missing palette "${palette}"`);
    if (node.extras?.collision !== false) fail(`${label} must carry extras.collision=false`);
    if (node.extras?.owLodDist !== undefined && (!finite(node.extras.owLodDist) || node.extras.owLodDist <= 0)) {
      fail(`${label} has an invalid owLodDist`);
    }

    const mesh = gltf.meshes?.[node.mesh];
    if (!mesh) {
      fail(`${label} references missing mesh ${node.mesh}`);
      continue;
    }
    let triangles = 0;
    for (let i = 0; i < (mesh.primitives?.length ?? 0); i++) {
      triangles += primitiveTriangles(gltf, mesh.primitives[i], `${label} primitive ${i}`);
    }

    const attrs = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (attrs) {
      const counts = Object.entries(attrs).map(([name, index]) =>
        accessorCount(gltf, index, `${label} instance ${name}`)
      );
      const count = counts[0] ?? 0;
      if (!count || counts.some((value) => value !== count)) {
        fail(`${label} has inconsistent GPU instance accessor counts`);
      }
      instances += count;
      instTris += triangles * count;
    } else {
      staticTris += triangles;
    }
  }

  if (!drawCalls) fail('visual GLB contains no mesh nodes');
  return { drawCalls, staticTris, instTris, instances };
}

function inspectCollision(asset) {
  if (!asset) return null;
  const gltf = asset.json;
  let meshes = 0;
  let collideTris = 0;

  for (let nodeIndex = 0; nodeIndex < (gltf.nodes?.length ?? 0); nodeIndex++) {
    const node = gltf.nodes[nodeIndex];
    if (node.mesh === undefined) continue;
    meshes++;
    const label = `collision node ${node.name ?? nodeIndex}`;
    const surface = node.extras?.surface;
    if (!surfaces.has(surface)) fail(`${label} has unknown or missing surface "${surface}"`);
    const mesh = gltf.meshes?.[node.mesh];
    if (!mesh) {
      fail(`${label} references missing mesh ${node.mesh}`);
      continue;
    }
    let triangles = 0;
    for (let i = 0; i < (mesh.primitives?.length ?? 0); i++) {
      triangles += primitiveTriangles(gltf, mesh.primitives[i], `${label} primitive ${i}`);
    }
    const attrs = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (attrs) {
      const counts = Object.entries(attrs).map(([name, index]) =>
        accessorCount(gltf, index, `${label} instance ${name}`)
      );
      const count = counts[0] ?? 0;
      if (!count || counts.some((value) => value !== count)) {
        fail(`${label} has inconsistent GPU instance accessor counts`);
      }
      collideTris += triangles * count;
    } else {
      collideTris += triangles;
    }
  }

  if (!meshes) fail('collision GLB contains no mesh nodes');
  return { meshes, collideTris };
}

function compareStat(stats, actual, key) {
  if (!finite(stats?.[key]) || stats[key] < 0) {
    fail(`manifest stats.${key} must be a non-negative finite number`);
  } else if (actual && stats[key] !== actual[key]) {
    fail(`manifest stats.${key} is ${stats[key]}, but the GLB contains ${actual[key]}`);
  }
}

if (!existsSync(manifestPath)) {
  console.error(`[world:validate] manifest does not exist: ${manifestPath}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`[world:validate] cannot parse ${manifestPath}: ${error.message}`);
  process.exit(1);
}

if (manifest.version !== 1 && manifest.version !== 2) {
  fail(`unsupported manifest version ${manifest.version}`);
}
if (manifest.version === 2) {
  const expectedSourceHash = worldSourceHash(ROOT);
  if (manifest.sourceHash !== expectedSourceHash) {
    fail(`manifest sourceHash is ${manifest.sourceHash ?? '<missing>'}, expected ${expectedSourceHash}; run npm run world`);
  }
}
if (!manifest.assets || typeof manifest.assets !== 'object') fail('manifest.assets is required');

const manifestDir = dirname(manifestPath);
const resolveAsset = (kind) => {
  const name = manifest.assets?.[kind];
  if (typeof name !== 'string' || !name || basename(name) !== name) {
    fail(`manifest.assets.${kind} must be a filename in the manifest directory`);
    return null;
  }
  return join(manifestDir, name);
};

if (requireArray(manifest.transform, 16, 'manifest.transform') && !manifest.transform.every(finite)) {
  fail('manifest.transform must contain only finite numbers');
}
if (!manifest.bounds || typeof manifest.bounds !== 'object') {
  fail('manifest.bounds is required');
} else if (
  requireVector(manifest.bounds.min, 'manifest.bounds.min') &&
  requireVector(manifest.bounds.max, 'manifest.bounds.max')
) {
  for (let i = 0; i < 3; i++) {
    if (manifest.bounds.min[i] > manifest.bounds.max[i]) fail(`manifest bounds are inverted on axis ${i}`);
  }
}

const spawnIds = new Set();
if (!Array.isArray(manifest.spawns) || manifest.spawns.length === 0) {
  fail('manifest.spawns must be a non-empty array');
} else {
  manifest.spawns.forEach((spawn, index) => {
    requireVector(spawn?.position, `manifest.spawns[${index}].position`);
    if (!finite(spawn?.yaw)) fail(`manifest.spawns[${index}].yaw must be finite`);
    if (manifest.version === 2) requireVector(spawn?.forward, `manifest.spawns[${index}].forward`);
    const id = spawn?.id ?? spawn?.tag;
    if (typeof id !== 'string' || !id.trim()) fail(`manifest.spawns[${index}] needs a non-empty id/tag`);
    else if (spawnIds.has(id)) fail(`duplicate spawn id/tag "${id}"`);
    else spawnIds.add(id);
  });
}

const buildingIds = new Set();
if (!Array.isArray(manifest.buildings)) {
  fail('manifest.buildings must be an array');
} else {
  manifest.buildings.forEach((building, index) => {
    const id = building?.id ?? building?.spec?.id;
    if (typeof id !== 'string' || !id) fail(`manifest.buildings[${index}] needs an id`);
    else if (buildingIds.has(id)) fail(`duplicate building id "${id}"`);
    else buildingIds.add(id);
  });
}

if (manifest.version === 1) {
  if (!manifest.lights || !Array.isArray(manifest.lights.interiors) || !Array.isArray(manifest.lights.lamps)) {
    fail('manifest.lights must contain interiors and lamps arrays');
  } else {
    for (const kind of ['interiors', 'lamps']) {
      manifest.lights[kind].forEach((light, index) => {
        if (![light?.x, light?.y, light?.z].every(finite)) {
          fail(`manifest.lights.${kind}[${index}] needs finite x/y/z coordinates`);
        }
      });
    }
  }
} else {
  if (!Array.isArray(manifest.lights)) fail('manifest.lights must be an array in version 2');
  else manifest.lights.forEach((light, index) => {
    requireVector(light?.position, `manifest.lights[${index}].position`);
    requireVector(light?.color, `manifest.lights[${index}].color`);
    if (!['interior', 'street'].includes(light?.kind)) fail(`manifest.lights[${index}] has invalid kind`);
    if (![light?.range, light?.priority, light?.day, light?.night].every(finite)) {
      fail(`manifest.lights[${index}] has invalid runtime settings`);
    }
  });
  if (!Array.isArray(manifest.volumes)) fail('manifest.volumes must be an array in version 2');
  const street = manifest.query?.street;
  if (!street || !['halfWidth', 'kerb', 'walkH', 'zMin', 'zMax'].every((key) => finite(street[key]))) {
    fail('manifest.query.street is invalid');
  }
  if (!Array.isArray(manifest.query?.alleys)) fail('manifest.query.alleys must be an array');
  else manifest.query.alleys.forEach((alley, index) => {
    if (!Array.isArray(alley?.rect) || alley.rect.length !== 4 || !alley.rect.every(finite)) {
      fail(`manifest.query.alleys[${index}].rect must contain four finite numbers`);
    }
  });
}

const visualAsset = parseGlbGzip(resolveAsset('visual'), 'visual');
const collisionAsset = parseGlbGzip(resolveAsset('collision'), 'collision');
const visual = inspectVisual(visualAsset);
const collision = inspectCollision(collisionAsset);
const actual = visual && collision ? { ...visual, collideTris: collision.collideTris } : null;
for (const key of ['staticTris', 'instTris', 'instances', 'drawCalls', 'collideTris']) {
  compareStat(manifest.stats, actual, key);
}

if (errors.length) {
  for (const message of errors) console.error(`[world:validate] ${message}`);
  console.error(`[world:validate] failed with ${errors.length} error${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}

const compressedMiB = ((visualAsset.compressedBytes + collisionAsset.compressedBytes) / 1048576).toFixed(1);
console.log(
  `[world:validate] ok — ${visual.drawCalls} draws, ${visual.instances} instances, ` +
  `${collision.collideTris} collision tris, ${compressedMiB} MiB compressed`
);
