/** Frozen pre-refactor query/build/solver outputs plus explicit boundary contracts. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as THREE from 'three';

import { Rng } from '../../src/core/rng.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import {
  makeClosest,
  makeHitRecord,
  rayCapsule,
  rayCapsuleFar,
  rayObb,
  rayObbFar,
  segTriangleClosest,
} from '../../src/physics/math.ts';
import { Ragdoll, humanoidSpec } from '../../src/physics/ragdoll.ts';
import { RigidBody, RigidBodyWorld } from '../../src/physics/rigidbody.ts';
import { LAYER, MASK } from '../../src/physics/surfaces.ts';

const rng = new Rng(0x51a7);
const scalar = () => rng.signed() * 4;
const vector = () => new THREE.Vector3(scalar(), scalar(), scalar());
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const snapshots = {};
assert.equal(
  digest([0, 1.6, 1.8, 2.15].map((h) => humanoidSpec(h, 75))),
  '81ece50f5ad13380f4e626626c814aa1e5439ec654363bf726ae5573100fa6f8',
  'bilateral spec preserves bone order, parent indices, dimensions and tuning'
);
const world = new StaticWorld();
for (let i = 0; i < 24; i++) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5 + rng.float(), 0.5 + rng.float(), 0.5 + rng.float())
  );
  mesh.position.copy(vector());
  mesh.rotation.set(scalar(), scalar(), scalar());
  world.addMesh(mesh, i % 2 ? 'wood' : 'metal', i % 2 ? LAYER.STATIC : LAYER.DEBRIS);
}
const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, 20));
floor.position.y = -0.25;
world.addMesh(floor, 'concrete');
world.build();
assert.ok(world.nodeCount > 1, 'exercise interior nodes, not only a root leaf');
snapshots.build = digest([
  world.aabb,
  world.nodeCount,
  world.maxDepth,
  ...[
    'pos',
    'nrm',
    'surface',
    'mask',
    'object',
    'solid',
    'triIndex',
    'nodeBounds',
    'nodeMeta',
    '_cent',
    '_taabb',
  ].map((key) => Array.from(world[key])),
]);

const queries = [];
const hit = makeHitRecord();
for (let i = 0; i < 350; i++) {
  const p = vector(),
    d = vector().normalize();
  if (i % 7 === 0) d.set(0, -1, 0);
  const args = [p.x, p.y, p.z, d.x, d.y, d.z, 12, i % 3 ? MASK.ALL : LAYER.STATIC];
  const found = world.raycast(...args, hit, i % 5 ? -1 : i % 24, i % 11 ? -1 : i % 24);
  queries.push(found ? { ...hit } : false, world.raycastAny(...args));
  const count = world.queryAabb(p.x - 1, p.y - 1, p.z - 1, p.x + 1, p.y + 1, p.z + 1, MASK.ALL);
  queries.push(Array.from(world.candidates.subarray(0, count)));
  const sweep = world.sweepCapsule(
    p.x,
    p.y,
    p.z,
    p.x,
    p.y + 1,
    p.z,
    0.25,
    d.x,
    d.y,
    d.z,
    8,
    MASK.ALL,
    hit
  );
  queries.push(sweep ? { ...hit } : false);
  const n = world.overlapCapsule(p.x, p.y, p.z, p.x, p.y + 1, p.z, 0.4, MASK.ALL, 0.001);
  queries.push(
    Object.fromEntries(
      ['nx', 'ny', 'nz', 'px', 'py', 'pz', 'depth', 's', 'tri'].map((key) => [
        key,
        Array.from(world.contacts[key].subarray(0, n)),
      ])
    )
  );
}
snapshots.bvh = digest(queries);

const geometry = [],
  closest = makeClosest();
for (let i = 0; i < 600; i++) {
  const points = Array.from({ length: 15 }, scalar);
  if (i % 10 === 0) points.splice(3, 3, ...points.slice(0, 3));
  segTriangleClosest(...points, closest);
  geometry.push({ ...closest });
  const p = vector(),
    d = vector().normalize(),
    a = vector(),
    b = vector();
  if (i % 10 === 0) b.copy(a);
  const args = [p.x, p.y, p.z, d.x, d.y, d.z, a.x, a.y, a.z, b.x, b.y, b.z, 1, 15];
  geometry.push(rayCapsule(...args), rayCapsuleFar(...args));
  const inv = new THREE.Matrix4()
    .compose(
      a,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.1)),
      new THREE.Vector3(1, 1, 1)
    )
    .invert().elements;
  const obbArgs = [p.x, p.y, p.z, d.x, d.y, d.z, inv, 1, 2, 0.5, 15];
  geometry.push(rayObb(...obbArgs), rayObbFar(...obbArgs));
}
snapshots.math = digest(geometry);
// Near hits include t=0 on an axial interior ray; far hits seek a true exit.
const axial = [0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 1, 10];
assert.equal(rayCapsule(...axial), 0);
assert.equal(rayCapsuleFar(...axial), 2);
assert.equal(rayCapsuleFar(...axial.slice(0, -1), 1.999), -1, 'exit must be reached');
const sideRay = [-3, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 1, 10];
assert.equal(rayCapsule(...sideRay), 2);
assert.equal(rayCapsuleFar(...sideRay), 4);
assert.equal(
  rayCapsuleFar(1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 1, 10),
  -1,
  'nondegenerate capsule exits reject the surface epsilon'
);
assert.equal(
  rayCapsuleFar(1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 10),
  0,
  'degenerate capsules retain the distinct sphere exit guard'
);
closest.t = 123;
segTriangleClosest(0.2, 0.2, 1, 0.4, 0.2, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, closest);
assert.equal(closest.s, 0, 'equal-distance features retain the first endpoint');
assert.equal(closest.t, 123, 'non-straddling closest queries do not overwrite t');
const identity = new THREE.Matrix4().elements;
assert.equal(rayObb(0, 0, 0, 1, 0, 0, identity, 1, 1, 1, 10), 0);
assert.equal(rayObbFar(0, 0, 0, 1, 0, 0, identity, 1, 1, 1, 10), 1);
const plane = new StaticWorld();
plane.addTriangles(new Float32Array([1, -2, -2, 1, 2, -2, 1, 0, 2]), 1, 'concrete');
plane.build();
assert.equal(plane.queryAabb(1, -2, -2, 1, 2, 2, MASK.ALL), 1, 'AABB overlap is inclusive');
assert.equal(plane.queryAabb(1, -2, -2, 1, 2, 2, LAYER.DEBRIS), 0, 'AABB queries retain masks');
for (const query of ['raycast', 'raycastAny']) {
  assert.equal(
    plane[query](0, 0, 0, 1, 0, 0, 1, MASK.ALL, hit),
    false,
    'max distance is exclusive'
  );
  assert.equal(plane[query](0, 0, 0, 1, 0, 0, 1.000001, MASK.ALL, hit), true);
}

const bodies = new RigidBodyWorld(world);
const impacts = [];
for (const shape of ['sphere', 'box', 'capsule']) {
  bodies.add(
    new RigidBody({
      shape,
      position: new THREE.Vector3(0, 2, 0),
      velocity: vector(),
      angularVelocity: vector(),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.1)),
      onImpact: (_b, ...contact) => impacts.push(contact),
    })
  );
}
const rd = new Ragdoll(world, { transform: new THREE.Matrix4().makeTranslation(0, 1, 0) });
rd.setVelocity(1, -2, 0.5);
const simulation = [];
for (let i = 0; i < 160; i++) {
  bodies.step(1 / 120);
  rd.step(1 / 120);
  simulation.push(
    bodies.bodies.map((b) => [
      b.position.toArray(),
      b.quaternion.toArray(),
      b.linearVelocity.toArray(),
      b.angularVelocity.toArray(),
      b.sleeping,
    ])
  );
  simulation.push(
    ...['px', 'py', 'pz', 'qx', 'qy', 'qz', 'boneUp'].map((key) => Array.from(rd[key])),
    { ...rd.aabb }
  );
}
snapshots.solvers = digest([simulation, impacts, Array.from(rd.selfPairs)]);

const physics = new PhysicsSystem();
physics.staticWorld = world;
physics.bodies = bodies;
physics.ragdolls.push(rd);
for (const [i, shape] of ['sphere', 'capsule', 'box'].entries()) {
  const c = physics.addCollider({
    shape,
    owner: { name: shape },
    part: 'torso',
    surface: 'flesh',
    ballisticSurface: 'wood',
    sheetThickness: 0.01,
  });
  if (shape === 'box') c.setMatrix(new THREE.Matrix4().makeTranslation(i, 1, 0));
  else c.setSegment(i, 0.5, 0, i, 1.5, 0, 0.3);
}
const publicHits = [];
for (let i = 0; i < 500; i++) {
  const p = vector(),
    d = vector();
  const result = physics.raycast(p, d, 12, MASK.ALL, i % 2 ? physics.colliders[0].owner : null);
  publicHits.push({
    ...result,
    point: result.point.toArray(),
    normal: result.normal.toArray(),
    object: result.object instanceof THREE.Object3D ? 'mesh' : result.object,
    body: result.body?.shape,
    collider: result.collider?.shape,
    ragdoll: result.ragdoll ? true : null,
  });
}
snapshots.publicHits = digest(publicHits);
// Captured on af113a8 before the structural changes; exact (unrounded) outputs.
assert.deepEqual(snapshots, {
  build: '4ac2f26927526a51680cf8a098302fdc9c2b3b5babd82b67ceb16830efff5f3c',
  bvh: 'f9a2b55ec11ff633efbc49c3e09da6368157e4c2b11fa2a295fc9807298978dc',
  math: 'aac060cbe64dfbe52898c6ae90ed5016f34e629202124ef43eac17a44ce40dc1',
  solvers: '526ac3a0a9af4367f44a86ab23515463481be2830590526684574d24850bd2ab',
  publicHits: '732013d47ebf3958d1930b022c153b0b3c482f3a6b5164f6fd24ed291aaf6601',
});
console.log('smoke-physics-geometry: ok');
