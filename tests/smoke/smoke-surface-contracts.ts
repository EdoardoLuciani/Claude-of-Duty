/** Authored surface metadata is strict; only unlabelled mesh/material names are inferred. */
import assert from 'node:assert/strict';

import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';

import { bakeMesh } from '../../src/physics/bvh.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { SURFACE } from '../../src/physics/surfaces.ts';

const geometry = new BoxGeometry();
const material = new MeshBasicMaterial();
material.name = 'steel_panel';
const mesh = new Mesh(geometry, material);
const physics = new PhysicsSystem();
const world = physics.staticWorld;
assert.equal(bakeMesh(mesh)?.uniformSurface, SURFACE.metal, 'material names infer a surface');

mesh.userData.surface = 'metla';
assert.throws((): unknown => physics.addStatic(mesh), /invalid surface/);
mesh.userData.surface = 'wood';
material.userData.surface = 'metla';
assert.throws((): unknown => physics.addStatic(mesh), /invalid surface/);
assert.equal(world.objects.length, 0, 'rejection cannot register a collider');
delete mesh.userData.surface;
geometry.clearGroups();
material.userData.surface = 'fabric';
assert.equal(bakeMesh(mesh)?.uniformSurface, SURFACE.fabric, 'explicit metadata beats the name');
delete material.userData.surface;

const id = physics.addStatic(mesh, 'glass', { ballisticSurface: 'metal' });
assert.equal(world.objects[id]?.surface, SURFACE.glass);
assert.equal(world.objects[id]?.ballisticSurface, SURFACE.metal);
world.removeObject(id);
mesh.userData.ballisticSurface = 'metla';
assert.throws((): unknown => physics.addStatic(mesh, 'wood'), /invalid surface/);
delete mesh.userData.ballisticSurface;
assert.equal(physics.addStatic(mesh, 'wood'), id, 'failed validation must not consume a free slot');

geometry.dispose();
material.dispose();
console.log('surface contracts: strict authored metadata, name inference, no partial registration');
