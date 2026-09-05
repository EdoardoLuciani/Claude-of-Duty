#!/usr/bin/env node
/** Material-independent support analysis must separate confirmed floats,
 * ambiguous facade seating, and intentionally stacked or elevated props. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { CONFIRMED_FLOAT_FIXTURES, PREVIOUS_UNSUPPORTED_IDS } from './lib/support-fixtures.mjs';
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

function expectStatus(ids, status) {
  for (const id of ids) {
    const actual = byId.get(id)?.status ?? 'missing';
    if (actual !== status) failures.push(`${id} expected ${status}, got ${actual}`);
  }
}

expectStatus(CONFIRMED_FLOAT_FIXTURES.map((fixture) => fixture.id), 'unsupported');
for (const id of [
  'sandbag_a/0006', 'box_card_b/0009', 'box_card_b/0012', 'box_card_b/0013', 'box_card_b/0014',
  'box_card_b/0015', 'box_card_b/0016', 'box_card_b/0017', 'box_card_b/0022', 'box_card_b/0023',
  'bucket/0012', 'bucket/0014', 'bucket/0016', 'bucket/0017',
  'bucket/0020', 'bucket/0027', 'bucket/0029', 'bucket/0031', 'bucket/0032',
  'jerry_can/0011', 'jerry_can/0012', 'jerry_can/0016',
  'jerry_can/0018', 'jerry_can/0019', 'jerry_can/0020',
  'jerry_can/0022', 'jerry_can/0023', 'jerry_can/0024',
  'planter/0009', 'planter/0010', 'planter/0011', 'planter/0017', 'planter/0019',
  'planter/0025', 'planter/0026', 'planter/0028', 'planter/0029', 'stool/0013', 'stool/0019',
  'stool/0020', 'stool/0021', 'stool/0025', 'stool/0026', 'stool/0029', 'stool/0031',
  'tyre_small/0016', 'tyre_small/0017',
  'tyre_small/0025', 'tyre_small/0026', 'tyre_small/0027',
  'crate_b/0019', 'crate_b/0024', 'crate_b/0053', 'crate_b/0055',
  'water_tank/0010', 'water_tank/0011',
]) {
  if (byId.has(id)) failures.push(`${id} should remain omitted as a confirmed float`);
}

expectStatus(['water_tank/0001', 'box_card_a/0002', 'crate_b/0040', 'box_card_b/0027'], 'supported');
expectStatus(['crate_b/0056', 'box_card_b/0021', 'jerry_can/0021', 'stool/0030'], 'supported');
const reclassified = new Set(['jerry_can/0015', 'tyre_small/0030', 'planter/0024']);
expectStatus(PREVIOUS_UNSUPPORTED_IDS.filter((id) => !reclassified.has(id)), 'unsupported');
expectStatus(['jerry_can/0015'], 'review-gap');
expectStatus(['planter/0024'], 'unclassified-seat');
expectStatus(['stool/0010', 'box_card_b/0008', 'tyre_small/0020'], 'supported');
expectStatus(['tyre_small/0030'], 'review-overhang');

// The previous test incorrectly certified these as stable. Independent mesh
// rays find two chair feet 10 cm above the stair, and the tyre stack inherits
// an uncertain base footprint. Neither is a high-confidence unsupported float.
expectStatus(['interior/W2/floor-1/chair/003'], 'unclassified-seat');
expectStatus(['tyre_small/0013'], 'review-overhang');
for (const id of ['interior/W2/floor-1/chair/003', 'tyre_small/0013']) {
  if (byId.get(id)?.physical !== 'contact') failures.push(`${id} lost its measured contact`);
}
if (!byId.get('tyre_small/0013')?.stableFootprint) failures.push('top tyre lost its local footprint');
expectStatus(['crate_a/0019'], 'supported');

const rampartSandbags = report.results.filter((result) => (
  !result.id && result.prototype.startsWith('sandbag_') && result.position[1] > 6
));
if (rampartSandbags.length !== 50) failures.push(`expected 50 rampart sandbags, found ${rampartSandbags.length}`);
const overhangingBags = new Set([
  'generated/sandbag_a|3.586|12.817|-42.514',
  'generated/sandbag_b|-0.024|7.172|-42.366',
]);
for (const result of rampartSandbags) {
  const expected = overhangingBags.has(result.key) ? 'review-overhang' : 'supported';
  if (result.status !== expected || result.physical !== 'contact') {
    failures.push(`rampart ${result.key} is ${result.status}/${result.physical}, expected ${expected}/contact`);
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
