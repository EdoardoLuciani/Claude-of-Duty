#!/usr/bin/env node
// World-backed companion to smoke-fx-tracer.mjs: instead of a synthetic target,
// stage the tracer through the real `_findTarget` fan against the real cooked
// level geometry, then verify the round ends ON the surface rather than behind
// it (the occlusion case the headless test cannot exercise).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { Assembler } from './worldgen/builder.js';
import { buildWorld } from './worldgen/build.js';
import { buildCollision } from './worldgen/pack.js';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/config.js';
import { PhysicsSystem } from '../src/physics/index.js';
import { FxSystem } from '../src/fx/index.js';

// --- world + collision BVH (same recipe as smoke-collision-fidelity) --------
function worldRng() {
  const root = new Rng(0x5eed1234);
  root.fork();
  root.fork();
  return root.fork();
}
const materialCache = new Map();
const materials = { get(name, opts = {}) {
  const key = `${name}|${!!opts.vertexMasks}`;
  let material = materialCache.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ name, vertexColors: !!opts.vertexMasks });
    materialCache.set(key, material);
  }
  return material;
} };
const A = new Assembler({ materials, rng: worldRng() });
A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
buildWorld(A, A.rng);
const root = new THREE.Group();
A.finalize(root);
A.releaseCache();
const visual = new THREE.Scene();
visual.add(root);
visual.updateMatrixWorld(true);
const { scene: collision } = await buildCollision(visual);
collision.updateMatrixWorld(true);

const physics = new PhysicsSystem();
physics.addStaticGroup(collision);
physics.rebuildStatic();
assert.ok(physics.staticWorld.triCount > 0, 'collision BVH has triangles');

// --- fx staging stub: real methods, pooled scratch, capture harness rng -----
// `impacts` shot framing: squared up on the plaster wall 5.25 m away.
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 1200);
camera.position.set(2.5, 1.6, 6);
camera.lookAt(-1.8, 1.5, 9.0);
camera.updateMatrixWorld();

const signed = [0.5, -0.25];
const spawned = [];
const fx = Object.assign(Object.create(FxSystem.prototype), {
  ctx: {
    camera,
    time: { elapsed: 3 },
    peek: (name) => (name === 'physics' ? physics : undefined),
  },
  rng: { signed: () => signed.shift() ?? 0, float: () => 0.5 },
  // Object.create skips the constructor, so seed the scratch the staged path uses.
  _tmpA: new THREE.Vector3(),
  _tmpB: new THREE.Vector3(),
  _camPos: new THREE.Vector3(),
  _probeSurf: new Array(63).fill('concrete'),
  emitAdd: (s) => spawned.push({ ...s }),
});

// --- run the production path: fan-of-probes target selection, then staging --
const target = fx._findTarget();
assert.equal(target.world, physics.staticWorld, 'target resolved against real world geometry, not the virtual plane');
assert.ok(target.distance >= 1.5 && target.distance <= 9, `wall in the staging band (got ${target.distance.toFixed(2)} m)`);
assert.ok(-target.normal.dot(camera.getWorldDirection(new THREE.Vector3())) > 0.3, 'hit is a face, not a grazing edge');

fx._stageTracer(target);
const muzzle = fx._tmpA.clone();
const end = fx._tmpB.clone();

// The round terminates on the surface plane: no overshoot behind the wall,
// which soft-depth clipping would render invisible (tracer head depth).
const signedEnd = end.clone().sub(target.point).dot(target.normal);
assert.ok(Math.abs(signedEnd) < 1e-4, `tracer ends on the surface plane (off by ${signedEnd.toExponential(2)} m)`);

// --- emitted sprites agree with the staged geometry ------------------------
assert.equal(spawned.length, 3, 'core, afterglow and head all emitted');
const dir = new THREE.Vector3(spawned[0].vx, spawned[0].vy, spawned[0].vz);
const speed = dir.length();
dir.normalize();
assert.ok(speed < 55, 'capture timing bypasses the gameplay speed floor');
assert.ok(Math.abs(spawned[0].life - 0.1) < 1e-9, '100 ms capture flight');
const headAtEnd = muzzle.clone().addScaledVector(dir, spawned[0].life * speed + 0.25);
assert.ok(Math.abs(headAtEnd.clone().sub(end).length()) < 1e-6, 'the head expires exactly at the wall, never past it');

console.log('  ok  staged wall tracer against world geometry');
