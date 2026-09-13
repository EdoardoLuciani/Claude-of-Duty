#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { Assembler } from './worldgen/builder.js';
import { buildWorld } from './worldgen/build.js';
import { buildCollision } from './worldgen/pack.js';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/config.js';

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
const { scene: collision, collideTris } = await buildCollision(visual);
collision.updateMatrixWorld(true);

const cases = [
  { name: 'E3 doorway', eye: [-3.009, 2.08, -26.65], forward: [0.717, -0.572, -0.399] },
  { name: 'W1 shell outside', eye: [1.574, 2.085, 19.129], forward: [-0.823, -0.353, 0.445] },
  { name: 'W1 shell inside', eye: [-2.577, 2.076, 20.258], forward: [-0.264, -0.8, 0.539] },
  { name: 'W2 shopfront', eye: [-11.75, 2.099, 5.56], forward: [-0.688, -0.571, 0.449] },
  { name: 'E3 second ray', eye: [-2.368, 2.101, -26.809], forward: [0.67, -0.595, -0.444] },
];
const raycaster = new THREE.Raycaster();
raycaster.far = 6;
const failures = [];
const results = [];
for (const sample of cases) {
  raycaster.set(new THREE.Vector3(...sample.eye), new THREE.Vector3(...sample.forward).normalize());
  const visualHit = raycaster.intersectObject(visual, true).find((hit) => hit.object.userData.surface !== 'foliage');
  const collisionHit = raycaster.intersectObject(collision, true)[0];
  const delta = visualHit && collisionHit ? Math.abs(visualHit.distance - collisionHit.distance) : Infinity;
  results.push({
    name: sample.name,
    visual: visualHit ? +visualHit.distance.toFixed(3) : null,
    collision: collisionHit ? +collisionHit.distance.toFixed(3) : null,
    delta: Number.isFinite(delta) ? +delta.toFixed(3) : null,
  });
  if (!!visualHit !== !!collisionHit || delta > 0.1) failures.push(`${sample.name} visual/collision mismatch`);
}
console.log(JSON.stringify({ ok: failures.length === 0, collideTris, cases: results, failures }, null, 2));
for (const result of results) assert.ok(result.delta !== null && result.delta <= 0.1, result.name);
A.dispose();
for (const material of materialCache.values()) material.dispose();
