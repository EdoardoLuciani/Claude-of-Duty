#!/usr/bin/env node
/** Offline map-issue triage (evidence only). Builds the world once, raycasts
 * against real collision for the float check. Does not touch committed assets. */
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { Assembler } from './worldgen/builder.js';
import { buildWorld } from './worldgen/build.js';
import { buildCollision } from './worldgen/pack.js';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/config.js';
import { PLACEMENTS } from './worldgen/placements/index.js';

function worldRng() {
  const root = new Rng(0x5eed1234); root.fork(); root.fork(); return root.fork();
}
const BOX = new THREE.Box3();
const CELL = 1.0;
const _v = new THREE.Vector3();
const inv = new THREE.Matrix4().compose(
  new THREE.Vector3(LEVEL_TX, 0, LEVEL_TZ),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, LEVEL_YAW, 0)),
  new THREE.Vector3(1, 1, 1)).invert();
function placementById() {
  const map = new Map();
  for (const p of PLACEMENTS) map.set(`${p.prototype}|${p.position[0].toFixed(2)}|${p.position[1].toFixed(2)}|${p.position[2].toFixed(2)}`, p.id);
  return map;
}
const materialCache = new Map();
const materials = { get(name, o = {}) {
  const k = `${name}|${!!o.vertexMasks}`;
  let m = materialCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ name, vertexColors: !!o.vertexMasks }); materialCache.set(k, m); }
  return m;
} };
const A = new Assembler({ materials, rng: worldRng() });
A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
const buildingsInfo = buildWorld(A, A.rng);
const idMap = placementById();
const instances = [];
let unknownId = 0;
for (const [prototype, proto] of A._protos) {
  proto.geo.computeBoundingBox();
  if (!proto.geo.boundingBox) continue;
  for (let i = 0; i < proto.matrices.length; i++) {
    const m = proto.matrices[i];
    BOX.copy(proto.geo.boundingBox).applyMatrix4(m);
    _v.fromArray(m.elements.slice(12, 15));
    const level = _v.clone().applyMatrix4(inv);
    const id = idMap.get(`${prototype}|${level.x.toFixed(2)}|${level.y.toFixed(2)}|${level.z.toFixed(2)}`) ?? `_auto/${String(unknownId++).padStart(4, '0')}`;
    const rec = { id, prototype, box: BOX.clone(), pos: level.clone(),
      minY: BOX.min.y, maxY: BOX.max.y,
      cx: (BOX.min.x + BOX.max.x) / 2, cz: (BOX.min.z + BOX.max.z) / 2,
      hx: (BOX.max.x - BOX.min.x) / 2, hz: (BOX.max.z - BOX.min.z) / 2 };
    instances.push(rec);
  }
}
const grid = new Map();
function addToGrid(rec) {
  const x0 = Math.floor((rec.cx - rec.hx) / CELL), x1 = Math.floor((rec.cx + rec.hx) / CELL);
  const z0 = Math.floor((rec.cz - rec.hz) / CELL), z1 = Math.floor((rec.cz + rec.hz) / CELL);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const k = `${x},${z}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(rec);
  }
}
for (const rec of instances) addToGrid(rec);
function vol(a, b) {
  const ox = Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x);
  const oy = Math.min(a.box.max.y, b.box.max.y) - Math.max(a.box.min.y, b.box.min.y);
  const oz = Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z);
  return ox > 0 && oy > 0 && oz > 0 ? ox * oy * oz : 0;
}
const NEST = new Set(['dust_skirt', 'tray', 'cinder', 'produce', 'litter', 'weeds', 'pock', 'bottle', 'can', 'slab_shard', 'rock_a', 'rock_b']);
const FOLIAGE = new Set(['palm_frond', 'palm_trunk', 'shrub', 'weeds']);
const seen = new Set();
const overlaps = [];
for (const rec of instances) {
  if (NEST.has(rec.prototype) || FOLIAGE.has(rec.prototype)) continue;
  for (const other of grid.get(`${Math.floor(rec.cx / CELL)},${Math.floor(rec.cz / CELL)}`) ?? []) {
    if (other === rec || NEST.has(other.prototype) || FOLIAGE.has(other.prototype)) continue;
    const pair = rec.id < other.id ? `${rec.id}|${other.id}` : `${other.id}|${rec.id}`;
    if (seen.has(pair)) continue; seen.add(pair);
    const ov = vol(rec, other);
    if (ov <= 0) continue;
    const minDim = Math.min(rec.hx * 2, rec.maxY - rec.minY, rec.hz * 2, other.hx * 2, other.maxY - other.minY, other.hz * 2);
    const sameHeight = Math.min(rec.box.max.y, other.box.max.y) - Math.max(rec.box.min.y, other.box.min.y);
    const cr = Math.cbrt(ov);
    if (cr > minDim * 0.5 && sameHeight > minDim * 0.5) overlaps.push({ rec, other, ov });
  }
}
overlaps.sort((a, b) => b.ov - a.ov);

// finalize visual + build collision once for raycasts
const visualRoot = new THREE.Group();
visualRoot.name = 'world';
A.finalize(visualRoot);
A.releaseCache();
const visualScene = new THREE.Scene();
visualScene.add(visualRoot);
const { scene: collisionScene } = await buildCollision(visualScene);
collisionScene.updateMatrixWorld(true);
const rayMeshes = [];
collisionScene.traverse((o) => {
  if (!o.isMesh) return;
  if (/dust_skirt/.test(o.name)) return;
  if (o.userData.surface === 'foliage') return;
  rayMeshes.push(o);
});
const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
const origin = new THREE.Vector3();
function surfaceBelow(x, z, maxY) {
  origin.set(x, maxY, z);
  raycaster.set(origin, DOWN);
  raycaster.far = 40;
  let best = -Infinity;
  for (const h of raycaster.intersectObjects(rayMeshes, false)) {
    if (h.point.y <= maxY && h.point.y > best) best = h.point.y;
  }
  return best;
}
/** Support height under a prop: 3x3 footprint samples cast from above the prop;
 * the highest hit at/below maxY wins. Hits within 2cm of maxY are the prop's own
 * top face — skip them. Sunk props (bottom below the support top) come out with
 * a negative gap, i.e. correctly NOT floating. */
function supportUnder(rec) {
  let best = -Infinity;
  const ring = [
    [-0.55, -0.55], [0, -0.55], [0.55, -0.55],
    [-0.55, 0], [0, 0], [0.55, 0],
    [-0.55, 0.55], [0, 0.55], [0.55, 0.55],
    // outer ring: catches support at the rim (a small tyre wedged inside a
    // bigger one is held by the tube at ~0.85 of its radius, not its centre)
    [-0.85, 0], [0.85, 0], [0, -0.85], [0, 0.85],
  ];
  for (const [fx, fz] of ring) {
    const y = surfaceBelow(rec.cx + fx * rec.hx, rec.cz + fz * rec.hz, rec.maxY + 0.05);
    if (y > rec.maxY - 0.02) continue;
    if (y > best) best = y;
  }
  return best;
}

const GROUND_REST = new Set(['crate_a','crate_b','crate_c','crate_flat','box_card_a','box_card_b',
  'barrel_rust','barrel_blue','barrel_wood','gas_bottle','bucket','jerry_can','sandbag_a','sandbag_b',
  'sandbag_c','jersey','block_big','block_small','tyre','tyre_small','pallet','table','table_small',
  'stall','shelf','mattress','chair','cabinet','lamp_post','water_tank','palm_trunk','brick_a','brick_b',
  'rock_a','rock_b','slab_shard','rebar','plank_a','plank_b','bottle','can','shrub','planter']);
const FLOAT_TOL = 0.15;
const floating = [];
for (const rec of instances) {
  if (!GROUND_REST.has(rec.prototype)) continue;
  if (rec.box.min.y < -0.3 || rec.box.max.y > 3.2) continue;
  const below = supportUnder(rec);
  if (!Number.isFinite(below)) continue;
  const gap = rec.minY - below;
  if (gap <= FLOAT_TOL) continue;
  floating.push({ rec, below, gap });
}
floating.sort((a, b) => b.gap - a.gap);

const doors = [];
for (const info of buildingsInfo) for (const d of info.doors ?? []) doors.push({ bld: info.spec.id, side: d.side, wp: d.wp });
const byBld = {};
for (const door of doors) {
  const pos = new THREE.Vector3().fromArray(door.wp);
  for (const rec of instances) {
    if (['dust_skirt','pock','weeds','litter','bottle','can'].includes(rec.prototype)) continue;
    const dx = rec.cx - pos.x, dz = rec.cz - pos.z;
    if (Math.hypot(dx, dz) > 0.8 + Math.max(rec.hx, rec.hz)) continue;
    if (rec.box.max.y < pos.y - 0.05 || rec.box.min.y > pos.y + 2.2) continue;
    if (Math.hypot(dx, dz) < 1.15) (byBld[door.bld] ??= []).push({ side: door.side, id: rec.id, proto: rec.prototype, p: rec.pos });
  }
}

console.log(`instances=${instances.length}  buildings=${buildingsInfo.length}  facadeDoors=${doors.length}`);
console.log(`\n=== FLOATING (${floating.length}) — support raycast from above (highest surface at/below bottom) ==========`);
for (const { rec, below, gap } of floating) {
  console.log(`  ${rec.id} (${rec.prototype})  bottom=${rec.minY.toFixed(2)} support=${below.toFixed(2)} gap=${gap.toFixed(2)}  @(${rec.pos.x.toFixed(2)},${rec.pos.y.toFixed(2)},${rec.pos.z.toFixed(2)})`);
}
console.log(`\n=== DOORS WITH PROPS AT THE OPENING (${Object.keys(byBld).length} buildings with props at the opening) ==========`);
for (const [bld, list] of Object.entries(byBld)) {
  console.log(`  ${bld}: ${list.map((o) => `${o.id}(${o.proto})@${o.p.x.toFixed(1)},${o.p.z.toFixed(1)}`).join(', ')}`);
}
console.log(`\n=== TOP 50 OVERLAPS (${overlaps.length} total, non-foliage) ==========`);
for (const { rec, other, ov } of overlaps.slice(0, 50)) {
  console.log(`  ${rec.id}(${rec.prototype}) × ${other.id}(${other.prototype}) vol=${ov.toFixed(3)} @(${rec.pos.x.toFixed(2)},${rec.pos.y.toFixed(2)},${rec.pos.z.toFixed(2)})`);
}
A.dispose();
