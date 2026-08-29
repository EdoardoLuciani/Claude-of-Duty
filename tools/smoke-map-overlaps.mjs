#!/usr/bin/env node
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { Assembler } from './worldgen/builder.js';
import { buildWorld } from './worldgen/build.js';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/config.js';
import { BUILDINGS, GATE } from './worldgen/layout.js';
import { PLACEMENTS } from './worldgen/placements/index.js';

function worldRng() {
  const root = new Rng(0x5eed1234);
  root.fork();
  root.fork();
  return root.fork();
}

const materialCache = new Map();
const materials = {
  get(name, opts = {}) {
    const key = `${name}|${!!opts.vertexMasks}`;
    let material = materialCache.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ name, vertexColors: !!opts.vertexMasks });
      materialCache.set(key, material);
    }
    return material;
  },
};

const inverse = new THREE.Matrix4().compose(
  new THREE.Vector3(LEVEL_TX, 0, LEVEL_TZ),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, LEVEL_YAW, 0)),
  new THREE.Vector3(1, 1, 1)
).invert();
const placementIds = new Map();
for (const p of PLACEMENTS) {
  placementIds.set(
    `${p.prototype}|${p.position[0].toFixed(2)}|${p.position[1].toFixed(2)}|${p.position[2].toFixed(2)}`,
    p.id
  );
}

const A = new Assembler({ materials, rng: worldRng() });
A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
buildWorld(A, A.rng);

const instances = [];
const box = new THREE.Box3();
const worldPosition = new THREE.Vector3();
let autoId = 0;
for (const [prototype, proto] of A._protos) {
  proto.geo.computeBoundingBox();
  if (!proto.geo.boundingBox) continue;
  for (const matrix of proto.matrices) {
    box.copy(proto.geo.boundingBox).applyMatrix4(matrix);
    worldPosition.setFromMatrixPosition(matrix).applyMatrix4(inverse);
    const key = `${prototype}|${worldPosition.x.toFixed(2)}|${worldPosition.y.toFixed(2)}|${worldPosition.z.toFixed(2)}`;
    instances.push({
      id: placementIds.get(key) ?? `_auto/${String(autoId++).padStart(4, '0')}`,
      prototype,
      box: box.clone(),
      matrix: matrix.clone(),
    });
  }
}

const byId = new Map(instances.map((item) => [item.id, item]));
const cellSize = 1;
const grid = new Map();
for (const item of instances) {
  const x0 = Math.floor(item.box.min.x / cellSize);
  const x1 = Math.floor(item.box.max.x / cellSize);
  const z0 = Math.floor(item.box.min.z / cellSize);
  const z1 = Math.floor(item.box.max.z / cellSize);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const key = `${x},${z}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(item);
    }
  }
}

function overlapVolume(a, b) {
  const x = Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x);
  const y = Math.min(a.box.max.y, b.box.max.y) - Math.max(a.box.min.y, b.box.min.y);
  const z = Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z);
  return x > 0 && y > 0 && z > 0 ? x * y * z : 0;
}

const overlaps = new Map();
for (const item of instances) {
  const cx = Math.floor((item.box.min.x + item.box.max.x) * 0.5 / cellSize);
  const cz = Math.floor((item.box.min.z + item.box.max.z) * 0.5 / cellSize);
  for (const other of grid.get(`${cx},${cz}`) ?? []) {
    if (item === other) continue;
    const key = item.id < other.id ? `${item.id}|${other.id}` : `${other.id}|${item.id}`;
    if (overlaps.has(key)) continue;
    const volume = overlapVolume(item, other);
    if (volume > 0) overlaps.set(key, { a: item, b: other, volume });
  }
}

const fixedPairs = [
  ['ac_unit/0006', 'ac_unit/0007'],
  ['ac_unit/0009', 'ac_unit/0010'],
  ['ac_unit/0017', 'ac_unit/0018'],
  ['ac_unit/0024', 'ac_unit/0025'],
  ['ac_unit/0061', 'ac_unit/0062'],
  ['ac_unit/0073', 'ac_unit/0074'],
  ['ac_unit/0080', 'ac_unit/0081'],
  ['ac_unit/0083', 'ac_unit/0084'],
  ['ac_unit/0095', 'ac_unit/0096'],
  ['ac_unit/0101', 'ac_unit/0102'],
  ['planter/0013', 'planter/0014'],
  ['planter/0022', 'planter/0023'],
  ['sat_dish/0005', 'sat_dish/0006'],
  ['gas_bottle/0002', 'gas_bottle/0003'],
  ['box_card_a/0012', 'box_card_a/0013'],
];
const removed = new Set([
  'water_tank/0025',
  'water_tank/0028',
  'sat_dish/0025',
  'crate_a/0026',
  'crate_flat/0021',
  'rebar/0003',
  'planter/0014',
  'planter/0023',
  'ac_unit/0024',
  'ac_unit/0025',
  'ac_unit/0061',
  'ac_unit/0062',
  'ac_unit/0074',
  'ac_unit/0081',
]);
const failures = [];

// Authored structures may meet at a seam but must never occupy the same volume.
for (let i = 0; i < BUILDINGS.length; i++) {
  const a = BUILDINGS[i];
  for (let j = i + 1; j < BUILDINGS.length; j++) {
    const b = BUILDINGS[j];
    const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
    const oz = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
    if (ox > 0.02 && oz > 0.02) failures.push(`${a.id} structure overlaps ${b.id} by ${ox.toFixed(2)} x ${oz.toFixed(2)} m`);
  }
}
const gateRects = [
  { id: 'gate/west', x0: GATE.xL0, x1: GATE.xL1, z0: GATE.z - GATE.depth / 2, z1: GATE.z + GATE.depth / 2 },
  { id: 'gate/east', x0: GATE.xR0, x1: GATE.xR1, z0: GATE.z - GATE.depth / 2, z1: GATE.z + GATE.depth / 2 + GATE.eastProud },
  { id: 'gate/tower', x0: GATE.xT0, x1: GATE.xT1, z0: GATE.z - GATE.depth / 2, z1: GATE.z + GATE.depth / 2 + GATE.towerProud },
];
for (const gate of gateRects) {
  for (const building of BUILDINGS) {
    const ox = Math.min(gate.x1, building.x + building.w / 2) - Math.max(gate.x0, building.x - building.w / 2);
    const oz = Math.min(gate.z1, building.z + building.d / 2) - Math.max(gate.z0, building.z - building.d / 2);
    if (ox > 0.02 && oz > 0.02) failures.push(`${gate.id} overlaps ${building.id} by ${ox.toFixed(2)} x ${oz.toFixed(2)} m`);
  }
}

// Wreck wheels are authored as separate instances, so validate the compound at
// the source placement level: four unique wheels must remain around every hull.
const wrecks = instances.filter((item) => item.prototype === 'wreck');
const wheels = instances.filter((item) => item.prototype === 'wheel_flat');
const instancePoint = (item) => new THREE.Vector3().setFromMatrixPosition(item.matrix);
const wheelOwners = new Map();
for (const wheel of wheels) {
  const wp = instancePoint(wheel);
  let owner = null;
  let best = Infinity;
  for (const wreck of wrecks) {
    const distance = wp.distanceTo(instancePoint(wreck));
    if (distance < best) { best = distance; owner = wreck; }
  }
  if (owner && best <= 2.2) wheelOwners.set(wheel, owner);
  else failures.push(`${wheel.id} is not anchored to a wreck`);
}
for (const wreck of wrecks) {
  const count = [...wheelOwners.values()].filter((owner) => owner === wreck).length;
  if (count !== 4) failures.push(`${wreck.id} has ${count} anchored wheels, expected 4`);
}

for (const [a, b] of fixedPairs) {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const hit = overlaps.get(key);
  if (hit) failures.push(`${a} overlaps ${b} by ${hit.volume.toFixed(3)} m^3`);
}
for (const id of removed) {
  if (byId.has(id)) failures.push(`${id} should have been removed`);
}

const staticMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const staticMeshes = [];
for (const acc of A._static.values()) {
  if (acc.empty) continue;
  const mesh = new THREE.Mesh(acc.build(), staticMaterial);
  mesh.updateMatrixWorld(true);
  staticMeshes.push(mesh);
}
const raycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const rayCenter = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const rayTangent = new THREE.Vector3();
function staticHit(origin, direction, distance) {
  raycaster.set(origin, direction);
  raycaster.far = distance;
  return raycaster.intersectObjects(staticMeshes, false)[0] ?? null;
}

const facadeAnchors = fixedPairs
  .map(([id]) => id)
  .filter((id) => id.startsWith('ac_unit/') && !removed.has(id));
for (const id of facadeAnchors) {
  const item = byId.get(id);
  if (!item) {
    failures.push(`${id} facade anchor is missing`);
    continue;
  }
  item.box.getCenter(rayCenter);
  rayDirection.set(0, 0, -1).transformDirection(item.matrix);
  rayTangent.set(1, 0, 0).transformDirection(item.matrix);
  for (const offset of [-0.45, 0, 0.45]) {
    rayOrigin.copy(rayCenter).addScaledVector(rayTangent, offset);
    if (!staticHit(rayOrigin, rayDirection, 0.75)) {
      failures.push(`${id} has no facade backing at ${offset.toFixed(2)} m near ${rayCenter.toArray().map((n) => n.toFixed(2)).join(',')}`);
      break;
    }
  }
}

const roofCrate = byId.get('crate_a/0027');
let roofSupportGap = null;
if (!roofCrate) {
  failures.push('crate_a/0027 roof crate is missing');
} else {
  roofCrate.box.getCenter(rayOrigin);
  rayOrigin.y = roofCrate.box.min.y + 0.05;
  rayDirection.set(0, -1, 0);
  const hit = staticHit(rayOrigin, rayDirection, 0.2);
  roofSupportGap = hit ? roofCrate.box.min.y - hit.point.y : null;
  if (!hit || roofSupportGap > 0.12) failures.push('crate_a/0027 is not supported by the BS3 roof');
}

const allowedGenerated = new Set([
  'barrel_rust|shelf',
  'block_big|rebar',
  'box_card_a|shelf',
  'box_card_b|shelf',
  'crate_a|shelf',
  'crate_flat|crate_flat',
  'jersey|rebar',
  'rebar|rebar',
]);
const nestedDetail = new Set(['bottle', 'can', 'cinder', 'litter', 'pock', 'rock_a', 'rock_b', 'shrub', 'slab_shard', 'weeds']);
const generatedLarge = [];
for (const hit of overlaps.values()) {
  if (!hit.a.id.startsWith('_auto/') && !hit.b.id.startsWith('_auto/')) continue;
  if (nestedDetail.has(hit.a.prototype) || nestedDetail.has(hit.b.prototype)) continue;
  const pair = [hit.a.prototype, hit.b.prototype].sort().join('|');
  if (hit.volume >= 0.1 && !allowedGenerated.has(pair)) {
    const ac = hit.a.box.getCenter(new THREE.Vector3());
    const bc = hit.b.box.getCenter(new THREE.Vector3());
    generatedLarge.push(
      `${hit.a.id}(${hit.a.prototype}) @${ac.toArray().map((n) => n.toFixed(2)).join(',')} x ` +
      `${hit.b.id}(${hit.b.prototype}) @${bc.toArray().map((n) => n.toFixed(2)).join(',')} ${hit.volume.toFixed(3)} m^3`
    );
  }
}
failures.push(...generatedLarge);

const result = {
  ok: failures.length === 0,
  instances: instances.length,
  overlapCandidates: overlaps.size,
  checkedStablePairs: fixedPairs.length,
  structuralChecks: BUILDINGS.length + gateRects.length,
  wrecks: wrecks.length,
  anchoredWheels: wheelOwners.size,
  doorwayPlacementsCulled: A.skippedDoorPlacements ?? 0,
  doorwayClutterCulled: A.culledDoorwayClutter ?? 0,
  removedObjects: removed.size,
  facadeSupportChecks: facadeAnchors.length,
  roofSupportGap,
  unapprovedGeneratedOverlaps: generatedLarge.length,
  failures,
};
console.log(JSON.stringify(result, null, 2));

for (const mesh of staticMeshes) mesh.geometry.dispose();
staticMaterial.dispose();
A.dispose();
for (const material of materialCache.values()) material.dispose();
if (failures.length) process.exitCode = 1;
