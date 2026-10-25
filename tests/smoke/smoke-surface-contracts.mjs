/** Explicit surface metadata is strict; only unlabelled mesh/material names are inferred. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';

import { parseWorldManifest } from '../../src/core/model-metadata.ts';
import { StaticWorld, bakeMesh } from '../../src/physics/bvh.ts';
import { Collider, PhysicsSystem } from '../../src/physics/index.ts';
import {
  SURFACE,
  SURFACE_NAMES,
  guessSurface,
  isSurfaceName,
  parseSurfaceName,
  surfaceIndex,
  surfaceName,
} from '../../src/physics/surfaces.ts';

for (const [index, name] of SURFACE_NAMES.entries()) {
  assert.equal(isSurfaceName(name), true);
  assert.equal(parseSurfaceName(name), name);
  assert.equal(surfaceIndex(name), index);
  assert.equal(surfaceIndex(index), index);
  assert.equal(surfaceName(index), name);
}
for (const invalid of ['metla', 'metal_panel', '', 'constructor', '__proto__', null, {}, NaN]) {
  assert.equal(isSurfaceName(invalid), false);
  assert.throws(() => parseSurfaceName(invalid), /invalid surface/);
  assert.throws(() => surfaceIndex(invalid), /invalid surface/);
}
for (const invalid of [-1, 0.5, SURFACE_NAMES.length, Infinity, undefined])
  assert.throws(() => surfaceIndex(invalid), /invalid surface/);
assert.equal(guessSurface('steel_panel'), SURFACE.metal);
assert.equal(guessSurface('xyz', SURFACE.wood), SURFACE.wood);

const geometry = new BoxGeometry();
const material = new MeshBasicMaterial();
material.name = 'steel_panel';
const mesh = new Mesh(geometry, material);
const group = new Group();
group.add(mesh);
const physics = new PhysicsSystem();
const world = physics.staticWorld;
assert.equal(bakeMesh(mesh).uniformSurface, SURFACE.metal, 'inference remains supported');
for (const invalid of ['metla', null, 0.5, -1, Infinity]) {
  assert.throws(() => physics.addStatic(mesh, invalid), /invalid surface/);
  assert.equal(world.objects.length, 0, 'rejection cannot register a collider');
}
mesh.userData.surface = 'metla';
assert.throws(() => physics.addStatic(mesh), /invalid surface/);
assert.throws(() => physics.addStaticGroup(group), /invalid surface/);
mesh.userData.surface = 'wood';
material.userData.surface = 'metla';
assert.throws(() => physics.addStatic(mesh), /invalid surface/);
delete mesh.userData.surface;
geometry.clearGroups();
for (const invalid of ['metla', 'metal_panel', 0.5, null]) {
  material.userData.surface = invalid;
  assert.throws(
    () => physics.addStatic(mesh),
    /invalid surface/,
    'ungrouped metadata is explicit too'
  );
}
material.userData.surface = 'fabric';
assert.equal(bakeMesh(mesh).uniformSurface, SURFACE.fabric);
delete material.userData.surface;
assert.equal(bakeMesh(mesh).uniformSurface, SURFACE.metal, 'ungrouped material names still infer');
mesh.userData.surface = 'wood';
// Group material names intentionally still resolve independently when no override is supplied.
assert.equal(bakeMesh(mesh, 'wood').uniformSurface, SURFACE.wood);

const id = physics.addStatic(mesh, 'glass', { ballisticSurface: 'metal' });
assert.equal(world.objects[id].surface, SURFACE.glass);
assert.equal(world.objects[id].ballisticSurface, SURFACE.metal);
world.removeObject(id);
mesh.userData.ballisticSurface = 'metla';
assert.throws(() => physics.addStatic(mesh, 'wood'), /invalid surface/);
delete mesh.userData.ballisticSurface;
assert.equal(physics.addStatic(mesh, 'wood'), id, 'failed validation must not consume a free slot');
assert.throws(
  () => physics.addStatic(mesh, 'wood', { ballisticSurface: 'metla' }),
  /invalid surface/
);
assert.throws(() => new Collider({ surface: 'metla' }), /invalid surface/);
assert.throws(() => new Collider({ ballisticSurface: 'metla' }), /invalid surface/);
assert.equal(new Collider({ surface: 'wood' }).ballisticSurfaceIndex, SURFACE.wood);
assert.equal(new Collider({}).surfaceIndex, SURFACE.flesh, 'omission keeps the actor default');

const raw = new StaticWorld();
const triangles = new Float32Array(9);
const rawId = raw.addTriangles(triangles, 1, 'wood');
raw.removeObject(rawId);
assert.throws(() => raw.addTriangles(triangles, 1, 'metla'), /invalid surface/);
assert.equal(
  raw.addTriangles(triangles, 1, 'wood'),
  rawId,
  'raw validation preserves free handles'
);
const manifest = JSON.parse(
  readFileSync(new URL('../../public/models/world/level.json', import.meta.url), 'utf8')
);
// Query alley labels are authoring names (e.g. gravel), not explicit collision finishes.
assert.deepEqual(parseWorldManifest(manifest).query.alleys, manifest.query.alleys);
geometry.dispose();
material.dispose();
console.log(
  'surface contracts: canonical IDs, strict metadata, intentional inference and no partial registration'
);
