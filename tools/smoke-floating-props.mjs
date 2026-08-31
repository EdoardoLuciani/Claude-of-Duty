#!/usr/bin/env node
/** Furniture must sit on visual ground, an authored slab, or another prop mesh.
 * Scatter still uses the outdoor ground sweep. Alley overlays must match groundY. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { Assembler } from './worldgen/builder.js';
import { buildWorld } from './worldgen/build.js';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/config.js';
import { registerDressingProps } from './worldgen/dressing.js';
import { buildGround } from './worldgen/ground.js';
import { ALLEYS, STREET } from './worldgen/layout.js';
import { PLACEMENTS } from './worldgen/placements/index.js';
import { registerProps } from './worldgen/props.js';
import { groundY, inBuilding, structureY } from './worldgen/queries.js';

const OVERLAY_TOP = 0.06;
const SCATTER_TOL = 0.22;
const FURNITURE_TOL = 0.15;
const GROUND_REST = new Set([
  'crate_a', 'crate_b', 'crate_c', 'crate_flat', 'barrel_rust', 'barrel_blue',
  'barrel_wood', 'gas_bottle', 'bucket', 'jerry_can', 'sandbag_a', 'sandbag_b',
  'sandbag_c', 'jersey', 'block_big', 'tyre', 'tyre_small', 'pallet', 'table',
  'table_small', 'stall', 'shelf', 'mattress', 'chair', 'cabinet', 'lamp_post',
  'water_tank', 'palm_trunk', 'planter', 'stool',
  'rock_a', 'rock_b', 'brick_a', 'brick_b', 'slab_shard', 'rebar', 'plank_a',
  'plank_b', 'bottle', 'can', 'box_card_a', 'box_card_b', 'block_small',
]);
const GROUND_NAMES = new Set([
  'world_sand', 'world_road_dust', 'world_asphalt', 'world_gravel',
  'world_dirt', 'world_concrete', 'world_concrete_prop', 'world_road_rut',
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
const buildings = buildWorld(A, A.rng);

const placementIds = new Map();
for (const placement of PLACEMENTS) {
  placementIds.set(
    `${placement.prototype}|${placement.position[0].toFixed(2)}|${placement.position[1].toFixed(2)}|${placement.position[2].toFixed(2)}`,
    placement.id
  );
}

const BOX = new THREE.Box3();
const worldPosition = new THREE.Vector3();
const instances = [];
const grid = new Map();
for (const [prototype, proto] of A._protos) {
  proto.geo.computeBoundingBox();
  if (!proto.geo.boundingBox) continue;
  for (const matrix of proto.matrices) {
    BOX.copy(proto.geo.boundingBox).applyMatrix4(matrix);
    worldPosition.setFromMatrixPosition(matrix);
    const pos = worldPosition.clone().applyMatrix4(inverse);
    const rec = {
      id: placementIds.get(`${prototype}|${pos.x.toFixed(2)}|${pos.y.toFixed(2)}|${pos.z.toFixed(2)}`) ?? null,
      prototype,
      geometry: proto.geo,
      matrix,
      box: BOX.clone(),
      minY: BOX.min.y,
      maxY: BOX.max.y,
      cx: (BOX.min.x + BOX.max.x) / 2,
      cz: (BOX.min.z + BOX.max.z) / 2,
      hx: (BOX.max.x - BOX.min.x) / 2,
      hz: (BOX.max.z - BOX.min.z) / 2,
      pos,
    };
    if (GROUND_REST.has(prototype)) instances.push(rec);
    const x0 = Math.floor(rec.cx - rec.hx);
    const x1 = Math.floor(rec.cx + rec.hx);
    const z0 = Math.floor(rec.cz - rec.hz);
    const z1 = Math.floor(rec.cz + rec.hz);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(rec);
      }
    }
  }
}

// Raycast ground built in isolation; merging the complete level makes every
// support ray walk hundreds of thousands of unrelated building triangles.
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
    const gy = groundY(x, z);
    if (Math.abs(gy - OVERLAY_TOP) > 0.005) {
      failures.push(`groundY(${x.toFixed(2)}, ${z.toFixed(2)}) = ${gy.toFixed(3)} in ${alley.surface} alley, expected ${OVERLAY_TOP}`);
    }
    origin.set(x, 1.2, z).applyMatrix4(xform);
    const y = highestY(origin.x, origin.y, origin.z, 1.2);
    if (!Number.isFinite(y) || y < OVERLAY_TOP - 0.02) {
      failures.push(
        `visual ${alley.surface} alley (${x.toFixed(2)}, ${z.toFixed(2)}) y=${Number.isFinite(y) ? y.toFixed(3) : 'none'}, expected ~${OVERLAY_TOP}`
      );
    }
  }
}

const supportMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const supportMeshes = new Map();
const levelPoint = new THREE.Vector3();
const seenSupports = new Set();
const SUPPORT_SKIP = new Set(['dust_skirt', 'litter', 'pock', 'weeds', 'shrub', 'palm_frond']);

function nestedInTyreStack(rec) {
  if (!TYRES.has(rec.prototype)) return false;
  const x0 = Math.floor(rec.cx - rec.hx);
  const x1 = Math.floor(rec.cx + rec.hx);
  const z0 = Math.floor(rec.cz - rec.hz);
  const z1 = Math.floor(rec.cz + rec.hz);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (const other of grid.get(`${x},${z}`) ?? []) {
        if (other === rec || !TYRES.has(other.prototype)) continue;
        const ox = Math.min(rec.box.max.x, other.box.max.x) - Math.max(rec.box.min.x, other.box.min.x);
        const oz = Math.min(rec.box.max.z, other.box.max.z) - Math.max(rec.box.min.z, other.box.min.z);
        if (ox <= 0 || oz <= 0) continue;
        const seat = rec.minY - other.maxY;
        if (seat >= -0.08 && seat <= FURNITURE_TOL) return true;
        if (other.minY < rec.minY && other.maxY > rec.minY && ox * oz > rec.hx * rec.hz) return true;
      }
    }
  }
  return false;
}

function instanceY(rec, wx, wz) {
  const candidates = grid.get(`${Math.floor(wx)},${Math.floor(wz)}`) ?? [];
  seenSupports.clear();
  let best = -Infinity;
  for (const other of candidates) {
    if (other === rec || SUPPORT_SKIP.has(other.prototype) || seenSupports.has(other)) continue;
    seenSupports.add(other);
    if (wx < other.box.min.x || wx > other.box.max.x || wz < other.box.min.z || wz > other.box.max.z) continue;
    let mesh = supportMeshes.get(other.prototype);
    if (!mesh) {
      mesh = new THREE.Mesh(other.geometry, supportMaterial);
      mesh.matrixAutoUpdate = false;
      supportMeshes.set(other.prototype, mesh);
    }
    mesh.matrixWorld.copy(other.matrix);
    origin.set(wx, rec.minY + FURNITURE_TOL, wz);
    raycaster.set(origin, DOWN);
    raycaster.far = 8;
    for (const hit of raycaster.intersectObject(mesh, false)) {
      if (hit.point.y <= rec.minY + FURNITURE_TOL && hit.point.y > best) best = hit.point.y;
    }
  }
  return best;
}

const SCATTER = new Set([
  'rock_a', 'rock_b', 'brick_a', 'brick_b', 'slab_shard', 'rebar',
  'plank_a', 'plank_b', 'bottle', 'can',
]);
const SMALL_GOODS = new Set(['box_card_a', 'box_card_b', 'bottle', 'can', 'bucket']);
const TYRES = new Set(['tyre', 'tyre_small']);
const SUPPORT_SAMPLES = [
  [0, 0], [-0.65, 0], [0.65, 0], [0, -0.65], [0, 0.65],
  [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45],
];

for (const rec of instances) {
  if (rec.minY < -0.4) continue;
  const outdoor = !inBuilding(rec.pos.x, rec.pos.z, 0);
  // Small goods on interior counters/shelves are not ground-resting.
  if (!outdoor && SMALL_GOODS.has(rec.prototype) && rec.pos.y > 0.5 && rec.pos.y < 2.2) continue;
  if (SCATTER.has(rec.prototype)) {
    if (!outdoor || rec.pos.y > 3.2) continue;
    let groundBelow = -Infinity;
    for (const [fx, fz] of [[0, 0], [-0.7, 0], [0.7, 0], [0, -0.7], [0, 0.7]]) {
      const y = highestY(rec.cx + fx * rec.hx, rec.maxY + 2, rec.cz + fz * rec.hz, Infinity);
      if (y > groundBelow) groundBelow = y;
    }
    const groundGap = rec.minY - groundBelow;
    if (Number.isFinite(groundBelow) && groundGap <= SCATTER_TOL) continue;
    failures.push(
      `${rec.id ?? rec.prototype} (${rec.prototype}) gap=${Number.isFinite(groundGap) ? groundGap.toFixed(3) : 'none'} bottom=${rec.minY.toFixed(3)} support=${Number.isFinite(groundBelow) ? groundBelow.toFixed(3) : 'none'} @(${rec.pos.x.toFixed(2)},${rec.pos.y.toFixed(2)},${rec.pos.z.toFixed(2)})`
    );
    continue;
  }
  if (rec.minY < 0.08) continue;
  if (nestedInTyreStack(rec)) continue;
  let below = -Infinity;
  for (const [fx, fz] of SUPPORT_SAMPLES) {
    const wx = rec.cx + fx * rec.hx;
    const wz = rec.cz + fz * rec.hz;
    levelPoint.set(wx, 0, wz).applyMatrix4(inverse);
    let pointBelow = Math.max(
      highestY(wx, rec.minY + FURNITURE_TOL, wz, Infinity),
      structureY(levelPoint.x, levelPoint.z, buildings, rec.minY + FURNITURE_TOL),
    );
    if (!(Number.isFinite(pointBelow) && rec.minY - pointBelow <= FURNITURE_TOL)) {
      pointBelow = Math.max(pointBelow, instanceY(rec, wx, wz));
    }
    below = Math.max(below, pointBelow);
  }
  const gap = rec.minY - below;
  if (Number.isFinite(below) && gap <= FURNITURE_TOL) continue;
  failures.push(
    `${rec.id ?? rec.prototype} (${rec.prototype}) gap=${Number.isFinite(gap) ? gap.toFixed(3) : 'none'} bottom=${rec.minY.toFixed(3)} support=${Number.isFinite(below) ? below.toFixed(3) : 'none'} @(${rec.pos.x.toFixed(2)},${rec.pos.y.toFixed(2)},${rec.pos.z.toFixed(2)})`
  );
}

console.log(JSON.stringify({ ok: failures.length === 0, failures: failures.slice(0, 80) }, null, 2));
A.dispose();
groundA.dispose();
supportMaterial.dispose();
for (const material of materialCache.values()) material.dispose();
assert.equal(failures.length, 0, failures.slice(0, 8).join('\n'));
