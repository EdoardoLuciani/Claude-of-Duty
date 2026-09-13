#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FxSystem } from '../src/fx/index.js';

const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 1200);
camera.updateMatrixWorld();

const signed = [0.5, -0.25];
const spawned = [];
const fx = Object.assign(Object.create(FxSystem.prototype), {
  ctx: { camera, time: { elapsed: 3 } },
  rng: {
    signed: () => signed.shift(),
    float: () => 0.5,
  },
  _tmpA: new THREE.Vector3(),
  _tmpB: new THREE.Vector3(),
  emitAdd: (s) => spawned.push({ ...s }),
});

const target = {
  point: new THREE.Vector3(0, 0, -5),
  tangent: new THREE.Vector3(1, 0, 0),
  bitangent: new THREE.Vector3(0, 1, 0),
  normal: new THREE.Vector3(0, 0, 1),
  spanU: 2,
  spanV: 1,
  world: {},
};
fx._stageTracer(target);

assert.equal(spawned.length, 3, 'staged tracer emits core, afterglow and head');
assert.ok(Math.abs(fx._tmpB.x - 0.45) < 1e-9, 'horizontal spread stays on the target');
assert.ok(Math.abs(fx._tmpB.y + 0.0875) < 1e-9, 'vertical spread stays on the target');
assert.equal(fx._tmpB.z, -5, 'tracer stops on the wall instead of overshooting behind it');
for (const s of spawned) assert.ok(Math.abs(s.life - 0.1) < 1e-9, 'wall flight remains visible for 100 ms');
const speed = Math.hypot(spawned[0].vx, spawned[0].vy, spawned[0].vz);
assert.ok(speed < 55, 'capture timing can bypass the gameplay tracer speed floor');

console.log('  ok  staged wall tracer visibility');
