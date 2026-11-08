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
const scalar = (): number => rng.signed() * 4;
const vector = (): THREE.Vector3 => new THREE.Vector3(scalar(), scalar(), scalar());
const digest = (name: string, value: unknown): string => {
  const payload = JSON.stringify(value);
  if (process.env.DUMP_CHARACTERIZATION) console.log(name, payload);
  return createHash('sha256').update(payload).digest('hex');
};
const snapshots: Record<string, string> = {};
assert.equal(
  digest(
    'humanoidSpec',
    [0, 1.6, 1.8, 2.15].map((h): ReturnType<typeof humanoidSpec> => humanoidSpec(h, 75))
  ),
  '81ece50f5ad13380f4e626626c814aa1e5439ec654363bf726ae5573100fa6f8',
  'humanoid spec characterization changed; inspect with DUMP_CHARACTERIZATION=1'
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
snapshots.build = digest('build', [
  world.aabb,
  world.nodeCount,
  world.maxDepth,
  ...(
    [
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
    ] as const
  ).map((key): number[] => Array.from(world[key])),
]);

const queries: unknown[] = [];
const hit = makeHitRecord();
for (let i = 0; i < 350; i++) {
  const p = vector(),
    d = vector().normalize();
  if (i % 7 === 0) d.set(0, -1, 0);
  const args = [p.x, p.y, p.z, d.x, d.y, d.z, 12, i % 3 ? MASK.ALL : LAYER.STATIC] as const;
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
      (['nx', 'ny', 'nz', 'px', 'py', 'pz', 'depth', 's', 'tri'] as const).map(
        (key): [string, number[]] => [key, Array.from(world.contacts[key].subarray(0, n))]
      )
    )
  );
}
snapshots.bvh = digest('bvh', queries);

const geometry: unknown[] = [],
  closest = makeClosest();
for (let i = 0; i < 600; i++) {
  const points: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ] = [
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
    scalar(),
  ];
  if (i % 10 === 0) points.splice(3, 3, ...points.slice(0, 3));
  segTriangleClosest(...points, closest);
  geometry.push({ ...closest });
  const p = vector(),
    d = vector().normalize(),
    a = vector(),
    b = vector();
  if (i % 10 === 0) b.copy(a);
  const args = [p.x, p.y, p.z, d.x, d.y, d.z, a.x, a.y, a.z, b.x, b.y, b.z, 1, 15] as const;
  geometry.push(rayCapsule(...args), rayCapsuleFar(...args));
  const inv = new THREE.Matrix4()
    .compose(
      a,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.1)),
      new THREE.Vector3(1, 1, 1)
    )
    .invert().elements;
  const obbArgs = [p.x, p.y, p.z, d.x, d.y, d.z, inv, 1, 2, 0.5, 15] as const;
  geometry.push(rayObb(...obbArgs), rayObbFar(...obbArgs));
}
snapshots.math = digest('math', geometry);
// Near hits include t=0 on an axial interior ray; far hits seek a true exit.
const axialRay = [0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 1] as const;
const axial = [...axialRay, 10] as const;
assert.equal(rayCapsule(...axial), 0);
assert.equal(rayCapsuleFar(...axial), 2);
assert.equal(rayCapsuleFar(...axialRay, 1.999), -1, 'exit must be reached');
const sideRay = [-3, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 1, 10] as const;
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
for (const query of ['raycast', 'raycastAny'] as const) {
  assert.equal(
    plane[query](0, 0, 0, 1, 0, 0, 1, MASK.ALL, hit),
    false,
    'max distance is exclusive'
  );
  assert.equal(plane[query](0, 0, 0, 1, 0, 0, 1.000001, MASK.ALL, hit), true);
}

const bodies = new RigidBodyWorld(world);
const impacts: unknown[] = [];
for (const shape of ['sphere', 'box', 'capsule'] as const) {
  bodies.add(
    new RigidBody({
      shape,
      position: new THREE.Vector3(0, 2, 0),
      velocity: vector(),
      angularVelocity: vector(),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.1)),
      onImpact: (_b, ...contact): number => impacts.push(contact),
    })
  );
}
const rd = new Ragdoll(world, { transform: new THREE.Matrix4().makeTranslation(0, 1, 0) });
rd.setVelocity(1, -2, 0.5);
const simulation: unknown[] = [];
for (let i = 0; i < 160; i++) {
  bodies.step(1 / 120);
  rd.step(1 / 120);
  simulation.push(
    bodies.bodies.map((b): unknown[] => [
      b.position.toArray(),
      b.quaternion.toArray(),
      b.linearVelocity.toArray(),
      b.angularVelocity.toArray(),
      b.sleeping,
    ])
  );
  simulation.push(
    ...(['px', 'py', 'pz', 'qx', 'qy', 'qz', 'boneUp'] as const).map((key): number[] =>
      Array.from(rd[key])
    ),
    { ...rd.aabb }
  );
}
snapshots.solvers = digest('solvers', [simulation, impacts, Array.from(rd.selfPairs)]);

const physics = new PhysicsSystem();
physics.staticWorld = world;
physics.bodies = bodies;
physics.ragdolls.push(rd);
for (const [i, shape] of (['sphere', 'capsule', 'box'] as const).entries()) {
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
const publicHits: unknown[] = [];
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
snapshots.publicHits = digest('publicHits', publicHits);
// Bun 1.4.4 exact, unrounded baseline. Paired Node dumps retain hit decisions,
// topology and array shapes; maximum absolute solver drift is below 6e-8.
assert.deepEqual(
  snapshots,
  {
    build: '4ac2f26927526a51680cf8a098302fdc9c2b3b5babd82b67ceb16830efff5f3c',
    bvh: '2d485874ba06104d5595f1b9f2acd8863c001c12bdd473a5b49bfe0a3b971dfc',
    math: 'bff8e4a32def06d667da217bfaf760a50180a241e4e466479b19b90f87f96fc1',
    solvers: '31c72e280b25cd2284892deede496ea3f29df15262c6a06439776b574a0257bc',
    publicHits: 'ba06b217009365e38d3c99afe57db64060632bdc181d7ff260b26cec8297b9ed',
  },
  'physics characterization changed; inspect section payloads with DUMP_CHARACTERIZATION=1'
);
console.log('smoke-physics-geometry: ok');
