#!/usr/bin/env node
/** Material-independent support analysis must separate confirmed floats,
 * ambiguous facade seating, and intentionally stacked or elevated props. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { CONFIRMED_FLOAT_FIXTURES } from './lib/support-fixtures.mjs';
import { Assembler } from './worldgen/builder.js';
import { buildWorld } from './worldgen/build.js';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/config.js';
import { registerDressingProps } from './worldgen/dressing.js';
import { buildGround } from './worldgen/ground.js';
import { ALLEYS, STREET } from './worldgen/layout.js';
import { PLACEMENTS } from './worldgen/placements/index.js';
import { analyzePropSupport } from './worldgen/prop-support.js';
import { registerProps } from './worldgen/props.js';
import { groundY } from './worldgen/queries.js';

const OVERLAY_TOP = 0.06;

function worldRng() {
  const root = new Rng(0x5eed1234);
  root.fork();
  root.fork();
  return root.fork();
}

function alleyPoints(rect) {
  const [x0, z0, x1, z1] = rect;
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const za = Math.min(z0, z1), zb = Math.max(z0, z1);
  return [
    [(xa + xb) / 2, (za + zb) / 2],
    [xa + (xb - xa) * 0.25, za + (zb - za) * 0.5],
    [xa + (xb - xa) * 0.75, za + (zb - za) * 0.5],
  ].filter(([x, z]) => !(Math.abs(x) < STREET.halfWidth && z > STREET.zMin && z < STREET.zMax));
}

const failures = [];
const materialCache = new Map();
const materials = {
  get(name, opts = {}) {
    const key = `${name}|${!!opts.vertexMasks}`;
    let material = materialCache.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ name, vertexColors: !!opts.vertexMasks });
      materialCache.set(key, material);
    }
    return material;
  },
};

const A = new Assembler({ materials, rng: worldRng(), trackSupports: true });
A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
buildWorld(A, A.rng);
const report = analyzePropSupport(A, PLACEMENTS, CONFIRMED_FLOAT_FIXTURES);
const byId = new Map(report.results.filter((result) => result.id).map((result) => [result.id, result]));

for (const fixture of CONFIRMED_FLOAT_FIXTURES) {
  const result = byId.get(fixture.id);
  if (result?.status !== 'unsupported') {
    failures.push(`${fixture.id} expected unsupported, got ${result?.status ?? 'missing'}`);
  }
}
for (const id of [
  'sandbag_a/0006', 'box_card_b/0013', 'bucket/0020', 'jerry_can/0018',
  'jerry_can/0019', 'planter/0025', 'planter/0028', 'stool/0020',
  'stool/0025', 'stool/0031', 'tyre_small/0025', 'tyre_small/0026',
  'water_tank/0010', 'water_tank/0011',
]) {
  if (byId.has(id)) failures.push(`${id} should remain omitted as a confirmed float`);
}

for (const id of [
  'water_tank/0001',
  'box_card_a/0002',
  'interior/W2/floor-1/chair/003',
  'crate_b/0040',
  'tyre_small/0013',
]) {
  const result = byId.get(id);
  if (result?.status !== 'supported') failures.push(`${id} expected supported, got ${result?.status ?? 'missing'}`);
}

for (const id of ['crate_b/0056', 'box_card_b/0021', 'jerry_can/0021', 'stool/0030']) {
  const result = byId.get(id);
  if (result?.status !== 'review-balcony') {
    failures.push(`${id} expected review-balcony, got ${result?.status ?? 'missing'}`);
  }
}

for (const id of ['stool/0026', 'bucket/0031', 'planter/0009']) {
  const result = byId.get(id);
  if (result?.status !== 'unsupported') failures.push(`${id} expected unsupported, got ${result?.status ?? 'missing'}`);
}

const rampartSandbags = report.results.filter((result) => (
  !result.id && result.prototype.startsWith('sandbag_') && result.position[1] > 6
));
if (rampartSandbags.length < 40) failures.push(`expected rampart sandbags, found ${rampartSandbags.length}`);
for (const result of rampartSandbags) {
  if (result.status !== 'supported') {
    failures.push(`rampart ${result.prototype} @${result.position.map((n) => n.toFixed(2))} is ${result.status}`);
  }
}

// Preserve the alley regression: analytic ground and rendered overlays must
// describe the same support height.
const xform = new THREE.Matrix4().compose(
  new THREE.Vector3(LEVEL_TX, 0, LEVEL_TZ),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, LEVEL_YAW, 0)),
  new THREE.Vector3(1, 1, 1)
);
const groundA = new Assembler({ materials, rng: worldRng() });
groundA.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
registerProps(groundA, groundA.rng);
registerDressingProps(groundA, groundA.rng);
buildGround(groundA, groundA.rng);
const root = new THREE.Group();
groundA.finalize(root);
groundA.releaseCache();
root.updateMatrixWorld(true);
const groundMeshes = [];
root.traverse((object) => {
  if (object.isMesh && ['world_sand', 'world_road_dust', 'world_gravel', 'world_dirt'].includes(object.name)) {
    groundMeshes.push(object);
  }
});
const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3();
const down = new THREE.Vector3(0, -1, 0);
for (const alley of ALLEYS) {
  for (const [x, z] of alleyPoints(alley.rect)) {
    const expected = groundY(x, z);
    if (Math.abs(expected - OVERLAY_TOP) > 0.005) {
      failures.push(`groundY(${x.toFixed(2)}, ${z.toFixed(2)})=${expected.toFixed(3)}, expected ${OVERLAY_TOP}`);
    }
    origin.set(x, 1.2, z).applyMatrix4(xform);
    raycaster.set(origin, down);
    raycaster.far = 2;
    const y = raycaster.intersectObjects(groundMeshes, false)[0]?.point.y;
    if (!Number.isFinite(y) || y < OVERLAY_TOP - 0.02) {
      failures.push(`visual alley support at (${x.toFixed(2)},${z.toFixed(2)}) is ${y ?? 'missing'}`);
    }
  }
}

console.log(JSON.stringify({ ok: failures.length === 0, stats: report.stats, failures }, null, 2));
A.dispose();
groundA.dispose();
for (const material of materialCache.values()) material.dispose();
assert.equal(failures.length, 0, failures.slice(0, 8).join('\n'));
