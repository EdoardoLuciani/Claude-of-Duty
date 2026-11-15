/** Collision boundary and broadphase regressions. */
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { StaticWorld } from '../../src/physics/bvh.ts';
import {
  makeClosest,
  makeHitRecord,
  rayCapsule,
  rayCapsuleFar,
  rayObb,
  rayObbFar,
  segTriangleClosest,
} from '../../src/physics/math.ts';
import { RigidBody, RigidBodyWorld } from '../../src/physics/rigidbody.ts';
import { LAYER, MASK } from '../../src/physics/surfaces.ts';
import { addTriangles } from '../lib/static-world.ts';

const hit = makeHitRecord();
const closest = makeClosest();
// Near hits include t=0 on an axial interior ray; far hits seek a true exit.
const axialRay = [0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 1] as const;
const axial = [...axialRay, 10] as const;
assert.equal(rayCapsule(...axial), 0);
assert.equal(rayCapsuleFar(...axial), 2);
assert.equal(rayCapsuleFar(...axialRay, 1.999), -1, 'exit must be reached');
for (const end of [-1, 1]) {
  for (const direction of [-1, 1]) {
    for (const [x, capOffset, expected] of [
      [0, 0.5, 0],
      [0, 1, 0],
      [0.75, 0.5, 0],
      [0.6, 0.8, 0],
      [0.75, 0.875, -1],
      [0, 1.2, -1],
    ] as const) {
      assert.equal(
        rayCapsule(x, end * (1 + capOffset), 0, 0, direction, 0, 0, -1, 0, 0, 1, 0, 1, 0.1),
        expected,
        `short axial ray: end=${end}, direction=${direction}, cap=(${x}, ${capOffset})`
      );
    }
  }
  const outside = [0, end * 10, 0, 0, -end, 0, 0, -1, 0, 0, 1, 0, 1] as const;
  assert.equal(rayCapsule(...outside, 10), 8, 'axial entry must be at the finite cap');
  assert.equal(rayCapsule(...outside, 1), -1, 'unreached axial cap must not hit');
  assert.equal(
    rayCapsule(0, end * 10, 0, 0, end, 0, 0, -1, 0, 0, 1, 0, 1, 10),
    -1,
    'axial ray pointing away from the capsule must not hit'
  );
}
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
addTriangles(plane, [1, -2, -2, 1, 2, -2, 1, 0, 2], 'concrete');
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

// Shape-sized broadphase bounds must include large spheres and rotated capsule caps.
for (const shape of ['sphere', 'capsule'] as const) {
  const contactWorld = new StaticWorld();
  const x = shape === 'sphere' ? 0.29 : 0.64;
  addTriangles(contactWorld, [x, -2, -2, x, 0, 2, x, 2, -2], 'concrete');
  contactWorld.build();
  const simulation = new RigidBodyWorld(contactWorld, 0);
  const body = simulation.add(
    new RigidBody({
      shape,
      radius: shape === 'sphere' ? 0.3 : 0.05,
      halfHeight: 0.6,
      quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
    })
  );
  assert.equal(body.minExtent, body.radius, `${shape} CCD core uses the radius`);
  simulation.step(1 / 120);
  assert(body.position.x < 0, `${shape} end contact must reach the discrete solver`);
}

console.log('smoke-physics-geometry: ok');
