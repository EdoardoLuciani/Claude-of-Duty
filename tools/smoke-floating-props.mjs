#!/usr/bin/env node
/**
 * Gate: ground-resting props must sit on the *visual* ground, and alley
 * overlays must be the surface groundY claims they are.
 *
 * Collision is the wrong oracle (simplification drifts, inverted meshes drop
 * out). Raycast the visual scene, FrontSide, same as the player.
 */
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
const CELL = 1;

function worldRng() {
  const root = new Rng(0x5eed1234);
  root.fork();
  root.fork();
  return root.fork();
}

function alleyBounds(rect) {
  const [x0, z0, x1, z1] = rect;
  return [Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)];
}

function onRoad(x, z) {
  return Math.abs(x) < STREET.halfWidth && z > STREET.zMin && z < STREET.zMax;
}

const failures = [];

// --- authoring: groundY must see every alley overlay, even unordered rects --
const alleySamples = [];
for (const alley of ALLEYS) {
  const [xa, xb, za, zb] = alleyBounds(alley.rect);
  const pts = [
    [(xa + xb) / 2, (za + zb) / 2],
    [xa + (xb - xa) * 0.25, za + (zb - za) * 0.5],
    [xa + (xb - xa) * 0.75, za + (zb - za) * 0.5],
    [xa + (xb - xa) * 0.5, za + (zb - za) * 0.25],
    [xa + (xb - xa) * 0.5, za + (zb - za) * 0.75],
  ];
  for (const [x, z] of pts) {
    if (onRoad(x, z)) continue;
    const y = groundY(x, z);
    alleySamples.push({ surface: alley.surface, x, z, y });
    if (Math.abs(y - OVERLAY_TOP) > 0.005) {
      failures.push(
        `groundY(${x.toFixed(2)}, ${z.toFixed(2)}) = ${y.toFixed(3)} inside ${alley.surface} alley, expected ${OVERLAY_TOP}`
      );
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
for (const [prototype, proto] of A._protos) {
  proto.geo.computeBoundingBox();
  if (!proto.geo.boundingBox) continue;
  for (const matrix of proto.matrices) {
    BOX.copy(proto.geo.boundingBox).applyMatrix4(matrix);
    worldPosition.setFromMatrixPosition(matrix);
    instances.push({
      prototype,
      box: BOX.clone(),
      minY: BOX.min.y,
      maxY: BOX.max.y,
      cx: (BOX.min.x + BOX.max.x) / 2,
      cz: (BOX.min.z + BOX.max.z) / 2,
      hx: (BOX.max.x - BOX.min.x) / 2,
      hz: (BOX.max.z - BOX.min.z) / 2,
      pos: worldPosition.clone().applyMatrix4(inverse),
    });
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
  if (!object.isMesh) return;
  if (!GROUND_NAMES.has(object.name)) return;
  groundMeshes.push(object);
});

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
const origin = new THREE.Vector3();

function firstGroundY(levelX, levelZ, fromY = 1.2) {
  origin.set(levelX, fromY, levelZ).applyMatrix4(xform);
  raycaster.set(origin, DOWN);
  raycaster.far = 8;
  let best = -Infinity;
  for (const hit of raycaster.intersectObjects(groundMeshes, false)) {
    const y = hit.point.y;
    if (y < fromY && y > best) best = y;
  }
  return best;
}

// --- authoring: visual overlay top at alley interiors (catches inverted scale) --
for (const alley of ALLEYS) {
  const [xa, xb, za, zb] = alleyBounds(alley.rect);
  const pts = [
    [(xa + xb) / 2, (za + zb) / 2],
    [xa + (xb - xa) * 0.8, za + (zb - za) * 0.5],
  ];
  for (const [x, z] of pts) {
    if (onRoad(x, z)) continue;
    const y = firstGroundY(x, z);
    if (!Number.isFinite(y) || y < OVERLAY_TOP - 0.02) {
      failures.push(
        `visual ground at ${alley.surface} alley (${x.toFixed(2)}, ${z.toFixed(2)}) y=${Number.isFinite(y) ? y.toFixed(3) : 'none'}, expected overlay ~${OVERLAY_TOP}`
      );
    }
  }
}

const STRUCTURAL = new Set([
  'crate_a', 'crate_b', 'crate_c', 'crate_flat', 'barrel_rust', 'barrel_blue',
  'barrel_wood', 'gas_bottle', 'bucket', 'jerry_can', 'sandbag_a', 'sandbag_b',
  'sandbag_c', 'jersey', 'block_big', 'tyre', 'tyre_small', 'pallet', 'table',
  'table_small', 'stall', 'shelf', 'mattress', 'chair', 'cabinet', 'lamp_post',
  'water_tank', 'palm_trunk', 'planter',
]);
const GROUND_REST = new Set([
  ...STRUCTURAL,
  'rock_a', 'rock_b', 'brick_a', 'brick_b', 'slab_shard', 'rebar', 'plank_a',
  'plank_b', 'bottle', 'can', 'box_card_a', 'box_card_b', 'block_small',
]);

const grid = new Map();
function addToGrid(rec) {
  const x0 = Math.floor((rec.cx - rec.hx) / CELL);
  const x1 = Math.floor((rec.cx + rec.hx) / CELL);
  const z0 = Math.floor((rec.cz - rec.hz) / CELL);
  const z1 = Math.floor((rec.cz + rec.hz) / CELL);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const key = `${x},${z}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(rec);
    }
  }
}
for (const rec of instances) addToGrid(rec);

/** Neighbour whose top is the seat, or who occupies the bottom band (interleaved tyres). */
function seatedOnNeighbour(rec) {
  const x0 = Math.floor((rec.cx - rec.hx) / CELL);
  const x1 = Math.floor((rec.cx + rec.hx) / CELL);
  const z0 = Math.floor((rec.cz - rec.hz) / CELL);
  const z1 = Math.floor((rec.cz + rec.hz) / CELL);
  const area = Math.max(1e-6, rec.hx * 2 * rec.hz * 2);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (const other of grid.get(`${x},${z}`) ?? []) {
        if (other === rec || !GROUND_REST.has(other.prototype)) continue;
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

const RING = [
  [0, 0], [-0.7, 0], [0.7, 0], [0, -0.7], [0, 0.7],
];

function supportUnder(rec) {
  let best = -Infinity;
  for (const [fx, fz] of RING) {
    origin.set(rec.cx + fx * rec.hx, rec.maxY + 0.05, rec.cz + fz * rec.hz);
    raycaster.set(origin, DOWN);
    raycaster.far = 8;
    for (const hit of raycaster.intersectObjects(groundMeshes, false)) {
      const y = hit.point.y;
      if (y > rec.maxY - 0.02) continue;
      if (y > best) best = y;
    }
  }
  return best;
}

const floating = [];
for (const rec of instances) {
  if (!STRUCTURAL.has(rec.prototype)) continue;
  if (rec.minY < -0.4 || rec.maxY > 3.2) continue;
  if (inBuilding(rec.pos.x, rec.pos.z, 0.3)) continue;
  if (seatedOnNeighbour(rec)) continue;
  const below = supportUnder(rec);
  if (!Number.isFinite(below)) continue;
  const gap = rec.minY - below;
  if (gap <= FLOAT_TOL) continue;
  floating.push({ rec, below, gap });
}
floating.sort((a, b) => b.gap - a.gap);

for (const { rec, below, gap } of floating) {
  failures.push(
    `${rec.prototype} gap=${gap.toFixed(3)} bottom=${rec.minY.toFixed(3)} support=${below.toFixed(3)} @(${rec.pos.x.toFixed(2)},${rec.pos.y.toFixed(2)},${rec.pos.z.toFixed(2)})`
  );
}

const result = {
  ok: failures.length === 0,
  alleySamples: alleySamples.length,
  instances: instances.length,
  groundMeshes: groundMeshes.length,
  floating: floating.length,
  failures: failures.slice(0, 40),
};
console.log(JSON.stringify(result, null, 2));

A.dispose();
for (const material of materialCache.values()) material.dispose();
assert.equal(failures.length, 0, failures.slice(0, 8).join('\n'));
