#!/usr/bin/env node
/** Outdoor ground-resting props must sit on the visual ground; alley overlays
 * must be the surface groundY claims (catches unordered rects / inverted scale).
 * Recall over precision: debris is included; irregular AABBs will false-flag. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { Assembler } from './worldgen/builder.js';
import { buildWorld } from './worldgen/build.js';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/config.js';
import { ALLEYS, STREET } from './worldgen/layout.js';
import { groundY, inBuilding } from './worldgen/queries.js';

const OVERLAY_TOP = 0.06;
const FLOAT_TOL = 0.04;
const GROUND_REST = new Set([
  'crate_a', 'crate_b', 'crate_c', 'crate_flat', 'barrel_rust', 'barrel_blue',
  'barrel_wood', 'gas_bottle', 'bucket', 'jerry_can', 'sandbag_a', 'sandbag_b',
  'sandbag_c', 'jersey', 'block_big', 'tyre', 'tyre_small', 'pallet', 'table',
  'table_small', 'stall', 'shelf', 'mattress', 'chair', 'cabinet', 'lamp_post',
  'water_tank', 'palm_trunk', 'planter',
  'rock_a', 'rock_b', 'brick_a', 'brick_b', 'slab_shard', 'rebar', 'plank_a',
  'plank_b', 'bottle', 'can', 'box_card_a', 'box_card_b', 'block_small',
]);

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
for (const alley of ALLEYS) {
  for (const [x, z] of alleyPoints(alley.rect)) {
    const y = groundY(x, z);
    if (Math.abs(y - OVERLAY_TOP) > 0.005) {
      failures.push(`groundY(${x.toFixed(2)}, ${z.toFixed(2)}) = ${y.toFixed(3)} in ${alley.surface} alley, expected ${OVERLAY_TOP}`);
    }
  }
}

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

const xform = new THREE.Matrix4().compose(
  new THREE.Vector3(LEVEL_TX, 0, LEVEL_TZ),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, LEVEL_YAW, 0)),
  new THREE.Vector3(1, 1, 1)
);
const inverse = xform.clone().invert();

const A = new Assembler({ materials, rng: worldRng() });
A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
buildWorld(A, A.rng);

const BOX = new THREE.Box3();
const worldPosition = new THREE.Vector3();
const instances = [];
const grid = new Map();
for (const [prototype, proto] of A._protos) {
  if (!GROUND_REST.has(prototype)) continue;
  proto.geo.computeBoundingBox();
  if (!proto.geo.boundingBox) continue;
  for (const matrix of proto.matrices) {
    BOX.copy(proto.geo.boundingBox).applyMatrix4(matrix);
    worldPosition.setFromMatrixPosition(matrix);
    const rec = {
      prototype,
      box: BOX.clone(),
      minY: BOX.min.y,
      maxY: BOX.max.y,
      cx: (BOX.min.x + BOX.max.x) / 2,
      cz: (BOX.min.z + BOX.max.z) / 2,
      hx: (BOX.max.x - BOX.min.x) / 2,
      hz: (BOX.max.z - BOX.min.z) / 2,
      pos: worldPosition.clone().applyMatrix4(inverse),
    };
    instances.push(rec);
    const x0 = Math.floor((rec.cx - rec.hx));
    const x1 = Math.floor((rec.cx + rec.hx));
    const z0 = Math.floor((rec.cz - rec.hz));
    const z1 = Math.floor((rec.cz + rec.hz));
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(rec);
      }
    }
  }
}

const root = new THREE.Group();
A.finalize(root);
A.releaseCache();
const visual = new THREE.Scene();
visual.add(root);
visual.updateMatrixWorld(true);

const GROUND_NAMES = new Set([
  'world_sand', 'world_road_dust', 'world_asphalt', 'world_gravel',
  'world_dirt', 'world_concrete', 'world_concrete_prop', 'world_road_rut',
]);
const groundMeshes = [];
visual.traverse((object) => {
  if (object.isMesh && GROUND_NAMES.has(object.name)) groundMeshes.push(object);
});

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
const origin = new THREE.Vector3();
function highestY(wx, wy, wz, skipAbove) {
  origin.set(wx, wy, wz);
  raycaster.set(origin, DOWN);
  raycaster.far = 8;
  let best = -Infinity;
  for (const hit of raycaster.intersectObjects(groundMeshes, false)) {
    if (hit.point.y >= skipAbove) continue;
    if (hit.point.y > best) best = hit.point.y;
  }
  return best;
}

for (const alley of ALLEYS) {
  for (const [x, z] of alleyPoints(alley.rect)) {
    origin.set(x, 1.2, z).applyMatrix4(xform);
    const y = highestY(origin.x, origin.y, origin.z, 1.2);
    if (!Number.isFinite(y) || y < OVERLAY_TOP - 0.02) {
      failures.push(
        `visual ${alley.surface} alley (${x.toFixed(2)}, ${z.toFixed(2)}) y=${Number.isFinite(y) ? y.toFixed(3) : 'none'}, expected ~${OVERLAY_TOP}`
      );
    }
  }
}

function seatedOnNeighbour(rec) {
  const area = Math.max(1e-6, rec.hx * 2 * rec.hz * 2);
  const x0 = Math.floor(rec.cx - rec.hx);
  const x1 = Math.floor(rec.cx + rec.hx);
  const z0 = Math.floor(rec.cz - rec.hz);
  const z1 = Math.floor(rec.cz + rec.hz);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (const other of grid.get(`${x},${z}`) ?? []) {
        if (other === rec) continue;
        const ox = Math.min(rec.box.max.x, other.box.max.x) - Math.max(rec.box.min.x, other.box.min.x);
        const oz = Math.min(rec.box.max.z, other.box.max.z) - Math.max(rec.box.min.z, other.box.min.z);
        if (ox <= 0 || oz <= 0) continue;
        const seat = rec.minY - other.maxY;
        if (seat >= -0.08 && seat <= FLOAT_TOL) return true;
        if (ox * oz > area * 0.25 && other.minY < rec.minY && other.maxY > rec.minY) return true;
      }
    }
  }
  return false;
}

for (const rec of instances) {
  if (rec.minY < -0.4 || rec.maxY > 3.2) continue;
  if (inBuilding(rec.pos.x, rec.pos.z, 0.3)) continue;
  if (seatedOnNeighbour(rec)) continue;
  let below = -Infinity;
  for (const [fx, fz] of [[0, 0], [-0.7, 0], [0.7, 0], [0, -0.7], [0, 0.7]]) {
    const y = highestY(rec.cx + fx * rec.hx, rec.maxY + 0.05, rec.cz + fz * rec.hz, rec.maxY - 0.02);
    if (y > below) below = y;
  }
  const gap = rec.minY - below;
  if (!Number.isFinite(below) || gap <= FLOAT_TOL) continue;
  failures.push(
    `${rec.prototype} gap=${gap.toFixed(3)} bottom=${rec.minY.toFixed(3)} support=${below.toFixed(3)} @(${rec.pos.x.toFixed(2)},${rec.pos.y.toFixed(2)},${rec.pos.z.toFixed(2)})`
  );
}

console.log(JSON.stringify({ ok: failures.length === 0, failures: failures.slice(0, 40) }, null, 2));
A.dispose();
for (const material of materialCache.values()) material.dispose();
assert.equal(failures.length, 0, failures.slice(0, 8).join('\n'));
