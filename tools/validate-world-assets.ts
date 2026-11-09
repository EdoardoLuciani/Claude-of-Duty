#!/usr/bin/env bun
/** Validate generated runtime world assets without regenerating them. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { createLadderDescriptors } from '../src/ai/ladder.ts';
import type { ExpectedNav } from '../src/ai/nav-format.ts';
import { unpackNav, NAV_VERSION } from '../src/ai/nav-format.ts';
import { isRecord } from '../src/core/guards.ts';
import type { WorldLadder } from '../src/core/model-metadata.ts';
import { SURFACE_NAMES } from '../src/physics/surfaces.ts';
import { PALETTE } from '../src/world/palette.ts';
import { worldSourceHash } from './worldgen/source-hash.ts';

type JsonObject = Record<string, unknown>;
interface GlbAsset {
  json: JsonObject;
  compressedBytes: number;
  glbBytes: number;
}
interface VisualStats {
  drawCalls: number;
  staticTris: number;
  instTris: number;
  instances: number;
}
interface CollisionStats {
  meshes: number;
  collideTris: number;
}
type AssetStats = VisualStats & Pick<CollisionStats, 'collideTris'>;
function object(value: unknown): JsonObject | undefined {
  return isRecord(value) ? value : undefined;
}
function array(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
function indexed(value: unknown, index: unknown): JsonObject | undefined {
  return typeof index === 'number' ? object(array(value)?.[index]) : undefined;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function describe(value: unknown): string {
  return isRecord(value) || Array.isArray(value)
    ? (JSON.stringify(value) ?? '<unserializable>')
    : String(value);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((arg): [string, string | boolean] => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [match[1], match[2] ?? true] : [arg, true];
  })
);
const manifestPath = resolve(ROOT, String(args.manifest ?? 'public/models/world/level.json'));
const errors: string[] = [];
const paletteKeys: ReadonlySet<unknown> = new Set(Object.keys(PALETTE));
const surfaces: ReadonlySet<unknown> = new Set(SURFACE_NAMES);

const fail = (message: string): number => errors.push(message);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function requireArray(
  value: unknown,
  length: number | undefined,
  label: string
): value is unknown[] {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) {
    fail(`${label} must be an array${length === undefined ? '' : ` of length ${length}`}`);
    return false;
  }
  return true;
}

function requireVector(value: unknown, label: string): value is number[] {
  if (!requireArray(value, 3, label)) return false;
  if (!value.every(finite)) {
    fail(`${label} must contain only finite numbers`);
    return false;
  }
  return true;
}

function parseGlbGzip(file: string | null, kind: string): GlbAsset | null {
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
    fail(`${kind} asset is not a readable gzip stream: ${errorMessage(error)}`);
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
    const json: unknown = JSON.parse(text);
    if (!isRecord(json)) throw new Error('expected a glTF object');
    return { json, compressedBytes: compressed.length, glbBytes: glb.length };
  } catch (error) {
    fail(`${kind} GLB JSON is invalid: ${errorMessage(error)}`);
    return null;
  }
}

function accessorCount(gltf: JsonObject, index: unknown, label: string): number {
  const count = indexed(gltf.accessors, index)?.count;
  if (!finite(count) || !Number.isInteger(count) || count < 0) {
    fail(`${label} references an invalid accessor ${String(index)}`);
    return 0;
  }
  return count;
}

function primitiveTriangles(gltf: JsonObject, value: unknown, label: string): number {
  const primitive = object(value);
  if (!primitive) {
    fail(`${label} is invalid`);
    return 0;
  }
  if (primitive.mode !== undefined && primitive.mode !== 4) {
    fail(`${label} must use TRIANGLES mode`);
    return 0;
  }
  const count =
    primitive.indices !== undefined
      ? accessorCount(gltf, primitive.indices, `${label}.indices`)
      : accessorCount(gltf, object(primitive.attributes)?.POSITION, `${label}.POSITION`);
  if (count % 3 !== 0)
    fail(`${label} has ${count} vertices/indices, which is not divisible by three`);
  return count / 3;
}

function inspectVisual(asset: GlbAsset | null): VisualStats | null {
  if (!asset) return null;
  const gltf = asset.json;
  let drawCalls = 0;
  let staticTris = 0;
  let instTris = 0;
  let instances = 0;

  for (let nodeIndex = 0; nodeIndex < (array(gltf.nodes)?.length ?? 0); nodeIndex++) {
    const node = indexed(gltf.nodes, nodeIndex);
    if (!node) {
      fail(`invalid glTF node ${nodeIndex}`);
      continue;
    }
    const extras = object(node.extras);
    if (node.mesh === undefined) continue;
    drawCalls++;
    const label = `visual node ${describe(node.name ?? nodeIndex)}`;
    const palette = extras?.palette;
    if (!paletteKeys.has(palette))
      fail(`${label} has unknown or missing palette "${String(palette)}"`);
    if (extras?.collision !== false) fail(`${label} must carry extras.collision=false`);
    if (extras?.owLodDist !== undefined && (!finite(extras!.owLodDist) || extras!.owLodDist <= 0)) {
      fail(`${label} has an invalid owLodDist`);
    }

    const mesh = indexed(gltf.meshes, node.mesh);
    if (!mesh) {
      fail(`${label} references missing mesh ${describe(node.mesh)}`);
      continue;
    }
    const primitives = array(mesh.primitives);
    if (!primitives) {
      fail(`${label} primitives must be an array`);
      continue;
    }
    let triangles = 0;
    for (let i = 0; i < primitives.length; i++) {
      triangles += primitiveTriangles(gltf, primitives[i], `${label} primitive ${i}`);
    }

    const attrs = object(object(node.extensions)?.EXT_mesh_gpu_instancing)?.attributes;
    if (attrs) {
      if (!isRecord(attrs)) {
        fail(`${label} has invalid GPU instance attributes`);
        continue;
      }
      const counts = Object.entries(attrs).map(([name, index]): number =>
        accessorCount(gltf, index, `${label} instance ${name}`)
      );
      const count = counts[0] ?? 0;
      if (!count || counts.some((value): boolean => value !== count)) {
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

function inspectCollision(asset: GlbAsset | null): CollisionStats | null {
  if (!asset) return null;
  const gltf = asset.json;
  let meshes = 0;
  let collideTris = 0;

  for (let nodeIndex = 0; nodeIndex < (array(gltf.nodes)?.length ?? 0); nodeIndex++) {
    const node = indexed(gltf.nodes, nodeIndex);
    if (!node) {
      fail(`invalid glTF node ${nodeIndex}`);
      continue;
    }
    const extras = object(node.extras);
    if (node.mesh === undefined) continue;
    meshes++;
    const label = `collision node ${describe(node.name ?? nodeIndex)}`;
    const surface = extras?.surface;
    if (!surfaces.has(surface))
      fail(`${label} has unknown or missing surface "${String(surface)}"`);
    if (!surfaces.has(extras?.ballisticSurface))
      fail(`${label} has missing or invalid ballisticSurface`);
    if (!finite(extras?.sheetThickness) || extras!.sheetThickness < 0) {
      fail(`${label} must declare a non-negative sheetThickness`);
    }
    const mesh = indexed(gltf.meshes, node.mesh);
    if (!mesh) {
      fail(`${label} references missing mesh ${describe(node.mesh)}`);
      continue;
    }
    const primitives = array(mesh.primitives);
    if (!primitives) {
      fail(`${label} primitives must be an array`);
      continue;
    }
    let triangles = 0;
    for (let i = 0; i < primitives.length; i++) {
      const primitive = indexed(primitives, i);
      if (!primitive) {
        fail(`${label} primitive ${i} is invalid`);
        continue;
      }
      triangles += primitiveTriangles(gltf, primitive, `${label} primitive ${i}`);
      const solid = indexed(gltf.accessors, object(primitive.attributes)?._SOLID);
      const position = indexed(gltf.accessors, object(primitive.attributes)?.POSITION);
      if (!solid || solid.type !== 'SCALAR' || solid.count !== position?.count) {
        fail(`${label} primitive ${i} must preserve per-vertex solid IDs`);
      }
    }
    const attrs = object(object(node.extensions)?.EXT_mesh_gpu_instancing)?.attributes;
    if (attrs) {
      if (!isRecord(attrs)) {
        fail(`${label} has invalid GPU instance attributes`);
        continue;
      }
      const counts = Object.entries(attrs).map(([name, index]): number =>
        accessorCount(gltf, index, `${label} instance ${name}`)
      );
      const count = counts[0] ?? 0;
      if (!count || counts.some((value): boolean => value !== count)) {
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

function compareStat(stats: unknown, actual: AssetStats | null, key: keyof AssetStats): void {
  const value = object(stats)?.[key];
  if (!finite(value) || value < 0) {
    fail(`manifest stats.${key} must be a non-negative finite number`);
  } else if (actual && value !== actual[key]) {
    fail(`manifest stats.${key} is ${value}, but the GLB contains ${actual[key]}`);
  }
}

if (!existsSync(manifestPath)) {
  console.error(`[world:validate] manifest does not exist: ${manifestPath}`);
  process.exit(1);
}

let manifest: JsonObject;
try {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!isRecord(parsed)) throw new Error('expected a manifest object');
  manifest = parsed;
} catch (error) {
  console.error(`[world:validate] cannot parse ${manifestPath}: ${errorMessage(error)}`);
  process.exit(1);
}

if (manifest.version !== 1 && manifest.version !== 2) {
  fail(`unsupported manifest version ${String(manifest.version)}`);
}
if (manifest.version === 2) {
  const expectedSourceHash = worldSourceHash(ROOT);
  if (manifest.sourceHash !== expectedSourceHash) {
    fail(
      `manifest sourceHash is ${describe(manifest.sourceHash ?? '<missing>')}, expected ${expectedSourceHash}; run bun run world`
    );
  }
}
if (!manifest.assets || typeof manifest.assets !== 'object') fail('manifest.assets is required');

const manifestDir = dirname(manifestPath);
const resolveAsset = (kind: string): string | null => {
  const name = object(manifest.assets)?.[kind];
  if (typeof name !== 'string' || !name || basename(name) !== name) {
    fail(`manifest.assets.${kind} must be a filename in the manifest directory`);
    return null;
  }
  return join(manifestDir, name);
};

if (
  requireArray(manifest.transform, 16, 'manifest.transform') &&
  !manifest.transform.every(finite)
) {
  fail('manifest.transform must contain only finite numbers');
}
const bounds = object(manifest.bounds);
if (!bounds) {
  fail('manifest.bounds is required');
} else if (
  requireVector(bounds.min, 'manifest.bounds.min') &&
  requireVector(bounds.max, 'manifest.bounds.max')
) {
  for (let i = 0; i < 3; i++) {
    if (bounds.min[i] > bounds.max[i]) fail(`manifest bounds are inverted on axis ${i}`);
  }
}

const spawnIds = new Set<string>();
const intelMarkers = object(object(manifest.WORLD)?.MARKERS)?.INTEL;
if (!Array.isArray(intelMarkers) || intelMarkers.length !== 14) {
  fail(
    `WORLD.MARKERS.INTEL must contain 14 authored points, found ${array(intelMarkers)?.length ?? 0}`
  );
} else {
  const intelIds = new Set<string>();
  intelMarkers.forEach((value: unknown, index: number): void => {
    const marker = object(value);
    requireVector(marker?.position, `WORLD.MARKERS.INTEL[${index}].position`);
    if (typeof marker?.id !== 'string' || !marker.id.trim()) {
      fail(`WORLD.MARKERS.INTEL[${index}] needs a non-empty id`);
    } else if (intelIds.has(marker.id)) fail(`duplicate intel marker "${marker.id}"`);
    else intelIds.add(marker.id);
  });
}

if (!Array.isArray(manifest.spawns) || manifest.spawns.length === 0) {
  fail('manifest.spawns must be a non-empty array');
} else {
  manifest.spawns.forEach((value: unknown, index: number): void => {
    const spawn = object(value);
    requireVector(spawn?.position, `manifest.spawns[${index}].position`);
    if (!finite(spawn?.yaw)) fail(`manifest.spawns[${index}].yaw must be finite`);
    if (manifest.version === 2) requireVector(spawn?.forward, `manifest.spawns[${index}].forward`);
    const id = spawn?.id ?? spawn?.tag;
    if (typeof id !== 'string' || !id.trim())
      fail(`manifest.spawns[${index}] needs a non-empty id/tag`);
    else if (spawnIds.has(id)) fail(`duplicate spawn id/tag "${id}"`);
    else spawnIds.add(id);
  });
}

const buildingIds = new Set<string>();
if (!Array.isArray(manifest.buildings)) {
  fail('manifest.buildings must be an array');
} else {
  manifest.buildings.forEach((value: unknown, index: number): void => {
    const building = object(value);
    const id = building?.id ?? object(building?.spec)?.id;
    if (typeof id !== 'string' || !id) fail(`manifest.buildings[${index}] needs an id`);
    else if (buildingIds.has(id)) fail(`duplicate building id "${id}"`);
    else buildingIds.add(id);
  });
}

const legacyLights = object(manifest.lights);
if (manifest.version === 1) {
  if (
    !manifest.lights ||
    !Array.isArray(legacyLights?.interiors) ||
    !Array.isArray(legacyLights?.lamps)
  ) {
    fail('manifest.lights must contain interiors and lamps arrays');
  } else {
    for (const kind of ['interiors', 'lamps']) {
      array(legacyLights?.[kind])!.forEach((value: unknown, index: number): void => {
        const light = object(value);
        if (![light?.x, light?.y, light?.z].every(finite)) {
          fail(`manifest.lights.${kind}[${index}] needs finite x/y/z coordinates`);
        }
      });
    }
  }
} else {
  if (!Array.isArray(manifest.lights)) fail('manifest.lights must be an array in version 2');
  else
    manifest.lights.forEach((value: unknown, index: number): void => {
      const light = object(value);
      requireVector(light?.position, `manifest.lights[${index}].position`);
      requireVector(light?.color, `manifest.lights[${index}].color`);
      if (typeof light?.kind !== 'string' || !['interior', 'street'].includes(light.kind))
        fail(`manifest.lights[${index}] has invalid kind`);
      if (![light?.range, light?.priority, light?.day, light?.night].every(finite)) {
        fail(`manifest.lights[${index}] has invalid runtime settings`);
      }
    });
  if (!Array.isArray(manifest.volumes)) fail('manifest.volumes must be an array in version 2');
  const query = object(manifest.query);
  const street = object(query?.street);
  if (
    !street ||
    !['halfWidth', 'kerb', 'walkH', 'zMin', 'zMax'].every((key): boolean => finite(street[key]))
  ) {
    fail('manifest.query.street is invalid');
  }
  if (!Array.isArray(query?.alleys)) fail('manifest.query.alleys must be an array');
  else
    array(query?.alleys)!.forEach((value: unknown, index: number): void => {
      const alley = object(value);
      if (!Array.isArray(alley?.rect) || alley.rect.length !== 4 || !alley.rect.every(finite)) {
        fail(`manifest.query.alleys[${index}].rect must contain four finite numbers`);
      }
    });
}

async function parseNavGzip(
  file: string | null
): Promise<{ compressedBytes: number; bake: Awaited<ReturnType<typeof unpackNav>> } | null> {
  if (!file) return null;
  if (!existsSync(file)) {
    fail(`nav asset does not exist: ${file}`);
    return null;
  }
  let compressed;
  let raw;
  try {
    compressed = readFileSync(file);
    raw = gunzipSync(compressed);
  } catch (error) {
    fail(`nav asset is not a readable gzip stream: ${errorMessage(error)}`);
    return null;
  }
  const hashMatch = basename(file).match(/\.([a-f0-9]{12})\.bin\.gz$/);
  if (!hashMatch) {
    fail(`nav filename must contain a 12-character content hash: ${basename(file)}`);
  } else {
    const actual = createHash('sha256').update(compressed).digest('hex').slice(0, 12);
    if (actual !== hashMatch[1]) {
      fail(`nav filename hash is ${hashMatch[1]}, but its content hash is ${actual}`);
    }
  }
  try {
    const navigation = object(manifest.navigation);
    if (
      navigation?.version !== NAV_VERSION ||
      typeof navigation.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(navigation.sha256)
    )
      throw new Error('missing navigation binding');
    const expected: ExpectedNav = { sha256: navigation.sha256 };
    if (manifest.sourceHash !== undefined) {
      if (typeof manifest.sourceHash !== 'string') throw new Error('invalid source hash');
      expected.sourceHash = manifest.sourceHash;
    }
    const collisionAsset = object(manifest.assets)?.collision;
    if (collisionAsset !== undefined) {
      if (typeof collisionAsset !== 'string') throw new Error('invalid collision asset');
      expected.collisionAsset = collisionAsset;
    }
    const bake = await unpackNav(raw, expected);
    const volumes = manifest.volumes;
    if (
      !Array.isArray(volumes) ||
      !volumes.every(
        (v: unknown): v is WorldLadder =>
          isRecord(v) &&
          v.kind === 'ladder' &&
          finite(v.x) &&
          finite(v.z) &&
          finite(v.y0) &&
          finite(v.y1) &&
          finite(v.radius) &&
          finite(v.nx) &&
          finite(v.nz)
      )
    )
      throw new Error('Invalid ladder volume');
    if (JSON.stringify(bake.meta.ladders) !== JSON.stringify(createLadderDescriptors(volumes)))
      throw new Error('authored ladder binding mismatch');
    if (
      bake.components.size !== navigation.polygons ||
      bake.points.length !== navigation.coverPoints ||
      new Set(bake.components.values()).size !== navigation.components
    )
      fail('nav statistics disagree');
    if (!bake.components.size || !bake.points.length) fail('nav bake is empty');
    return { compressedBytes: compressed.length, bake };
  } catch (error) {
    fail(`nav bake is invalid: ${errorMessage(error)}`);
    return null;
  }
}

const visualAsset = parseGlbGzip(resolveAsset('visual'), 'visual');
const collisionAsset = parseGlbGzip(resolveAsset('collision'), 'collision');
const navAsset = await parseNavGzip(resolveAsset('nav'));
const visual = inspectVisual(visualAsset);
const collision = inspectCollision(collisionAsset);
const actual = visual && collision ? { ...visual, collideTris: collision.collideTris } : null;
for (const key of ['staticTris', 'instTris', 'instances', 'drawCalls', 'collideTris'] as const) {
  compareStat(manifest.stats, actual, key);
}

if (errors.length) {
  for (const message of errors) console.error(`[world:validate] ${message}`);
  console.error(
    `[world:validate] failed with ${errors.length} error${errors.length === 1 ? '' : 's'}`
  );
  process.exit(1);
}

const compressedMiB = (
  (visualAsset!.compressedBytes +
    collisionAsset!.compressedBytes +
    (navAsset?.compressedBytes ?? 0)) /
  1048576
).toFixed(1);
console.log(
  `[world:validate] ok — ${visual!.drawCalls} draws, ${visual!.instances} instances, ` +
    `${collision!.collideTris} collision tris, ${compressedMiB} MiB compressed` +
    (navAsset ? `, nav ${navAsset.bake.components.size} polygons` : '')
);
