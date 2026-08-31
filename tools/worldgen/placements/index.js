import * as THREE from 'three';
import { groundY, inBuilding, structureY, SUPPORT_SURFACES } from '../queries.js';
import { eastSide } from './east-side.js';
import { interiors } from './interiors.js';
import { market } from './market.js';
import { midStreet } from './mid-street.js';
import { northStreet } from './north-street.js';
import { southStreet } from './south-street.js';
import { westSide } from './west-side.js';

export const PLACEMENTS = [
  ...eastSide,
  ...interiors,
  ...market,
  ...midStreet,
  ...northStreet,
  ...southStreet,
  ...westSide,
];

const ids = new Set();
for (const placement of PLACEMENTS) {
  for (const key of Object.keys(placement)) {
    if (!['id', 'prototype', 'position', 'rotationDeg', 'scale', 'masks'].includes(key)) {
      throw new Error(`[world] ${placement.id ?? '<unknown>'} has unknown field ${key}`);
    }
  }
  if (typeof placement.id !== 'string' || !placement.id) throw new Error('[world] placement needs an id');
  if (ids.has(placement.id)) throw new Error(`[world] duplicate placement id ${placement.id}`);
  ids.add(placement.id);
  if (typeof placement.prototype !== 'string' || !placement.prototype) {
    throw new Error(`[world] ${placement.id} needs a prototype`);
  }
  for (const key of ['position', 'rotationDeg', 'scale']) {
    if (!Array.isArray(placement[key]) || placement[key].length !== 3 || !placement[key].every(Number.isFinite)) {
      throw new Error(`[world] ${placement.id}.${key} must contain three finite numbers`);
    }
  }
  if (placement.masks != null && (
    !Array.isArray(placement.masks) || placement.masks.length !== 3 || !placement.masks.every(Number.isFinite)
  )) throw new Error(`[world] ${placement.id}.masks must contain three finite numbers`);
}

const position = new THREE.Vector3();
const rotation = new THREE.Euler();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const levelPosition = new THREE.Vector3();
const inverse = new THREE.Matrix4();

function inClearance(point, clearance) {
  const ax = clearance.from[0];
  const az = clearance.from[2];
  const bx = clearance.to[0];
  const bz = clearance.to[2];
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const along = lengthSq > 0
    ? Math.max(-0.2, Math.min(1.2, ((point.x - ax) * dx + (point.z - az) * dz) / lengthSq))
    : 0;
  const px = ax + dx * along;
  const pz = az + dz * along;
  return Math.hypot(point.x - px, point.z - pz) < 1.25;
}

export function placeBaked(A) {
  for (const placement of PLACEMENTS) {
    if (!A.has(placement.prototype)) {
      throw new Error(`[world] ${placement.id} references unknown prototype ${placement.prototype}`);
    }
    const degrees = placement.rotationDeg;
    position.fromArray(placement.position);
    rotation.set(
      THREE.MathUtils.degToRad(degrees[0]),
      THREE.MathUtils.degToRad(degrees[1]),
      THREE.MathUtils.degToRad(degrees[2])
    );
    quaternion.setFromEuler(rotation);
    scale.fromArray(placement.scale);
    matrix.compose(position, quaternion, scale);
    A.place(placement.prototype, matrix, placement.masks ?? null);
  }
}

const DOORWAY_CLUTTER = new Set([
  'barrel_blue', 'barrel_rust', 'barrel_wood', 'bottle', 'box_card_a', 'box_card_b',
  'brick_a', 'brick_b', 'bucket', 'can', 'chair', 'cinder', 'crate_a', 'crate_b',
  'crate_c', 'crate_flat', 'dust_skirt', 'gas_bottle', 'jerry_can', 'litter',
  'pallet', 'plank_a', 'plank_b', 'produce', 'rebar', 'rock_a', 'rock_b',
  'sandbag_a', 'sandbag_b', 'sandbag_c', 'shrub', 'slab_shard', 'stool', 'tray',
  'tyre', 'tyre_small', 'weeds',
]);

/** Remove low, non-structural clutter from every authored traversal sweep. */
export function clearDoorwayClutter(A, clearances) {
  inverse.copy(A.xform).invert();
  let removed = 0;
  for (const [id, prototype] of A._protos) {
    if (!DOORWAY_CLUTTER.has(id)) continue;
    const matrices = [];
    const masks = [];
    for (let i = 0; i < prototype.matrices.length; i++) {
      levelPosition.setFromMatrixPosition(prototype.matrices[i]).applyMatrix4(inverse);
      if (levelPosition.y < 2.3 && clearances.some((clearance) => inClearance(levelPosition, clearance))) {
        removed++;
        continue;
      }
      matrices.push(prototype.matrices[i]);
      masks.push(prototype.masks[i]);
    }
    prototype.matrices = matrices;
    prototype.masks = masks;
  }
  A.culledDoorwayClutter = removed;
}

const FURNITURE = new Set([
  'crate_a', 'crate_b', 'crate_c', 'crate_flat', 'barrel_rust', 'barrel_blue',
  'barrel_wood', 'gas_bottle', 'bucket', 'jerry_can', 'sandbag_a', 'sandbag_b',
  'sandbag_c', 'jersey', 'block_big', 'tyre', 'tyre_small', 'pallet', 'table',
  'table_small', 'chair', 'cabinet', 'shelf', 'water_tank', 'planter', 'stool',
  'box_card_a', 'box_card_b', 'block_small',
]);
const SUPPORT_SKIP = new Set(['dust_skirt', 'litter', 'pock', 'weeds', 'shrub', 'palm_frond']);
const CULL_GAP = 0.16;
const supportBox = new THREE.Box3();
const sampleLevel = new THREE.Vector3();
const sampleOrigin = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const SUPPORT_SAMPLES = [
  [0, 0], [-0.65, 0], [0.65, 0], [0, -0.65], [0, 0.65],
  [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45],
];

function collectSupportMeshes(A) {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = [];
  for (const [key, acc] of A._static) {
    if (acc.empty || !SUPPORT_SURFACES.has(key)) continue;
    const mesh = new THREE.Mesh(acc.build(true), material);
    mesh.updateMatrixWorld(true);
    meshes.push(mesh);
  }
  return { material, meshes };
}

function meshSupportY(meshes, raycaster, wx, wy, wz) {
  sampleOrigin.set(wx, wy, wz);
  raycaster.set(sampleOrigin, DOWN);
  raycaster.far = 8;
  let best = -Infinity;
  for (const hit of raycaster.intersectObjects(meshes, false)) {
    if (hit.point.y <= wy && hit.point.y > best) best = hit.point.y;
  }
  return best;
}

/** Omit furniture that is not stacked and lacks two supported footprint samples. */
export function seatUnsupported(A, buildings) {
  inverse.copy(A.xform).invert();
  const { material, meshes } = collectSupportMeshes(A);
  const raycaster = new THREE.Raycaster();
  const items = [];
  const supports = [];
  for (const [id, proto] of A._protos) {
    if (SUPPORT_SKIP.has(id)) continue;
    proto.geo.computeBoundingBox();
    for (let i = 0; i < proto.matrices.length; i++) {
      supportBox.copy(proto.geo.boundingBox).applyMatrix4(proto.matrices[i]);
      const record = {
        proto, i, keep: true,
        minX: supportBox.min.x, maxX: supportBox.max.x,
        minY: supportBox.min.y, maxY: supportBox.max.y,
        minZ: supportBox.min.z, maxZ: supportBox.max.z,
      };
      supports.push(record);
      if (FURNITURE.has(id)) {
        const world = new THREE.Vector3().setFromMatrixPosition(proto.matrices[i]);
        record.world = world;
        record.level = world.clone().applyMatrix4(inverse);
        items.push(record);
      }
    }
  }
  items.sort((a, b) => a.level.y - b.level.y);
  const instMesh = new Map();
  const instGrid = new Map();
  for (const support of supports) {
    const x0 = Math.floor(support.minX), x1 = Math.floor(support.maxX);
    const z0 = Math.floor(support.minZ), z1 = Math.floor(support.maxZ);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`;
        if (!instGrid.has(key)) instGrid.set(key, []);
        instGrid.get(key).push(support);
      }
    }
  }
  function instanceY(item, wx, minY, wz) {
    let best = -Infinity;
    const rayY = minY + CULL_GAP;
    for (const other of instGrid.get(`${Math.floor(wx)},${Math.floor(wz)}`) ?? []) {
      if (other === item || !other.keep || !other.proto.matrices[other.i]) continue;
      if (wx < other.minX || wx > other.maxX || wz < other.minZ || wz > other.maxZ) continue;
      if (other.minY > rayY || other.maxY < minY - CULL_GAP) continue;
      let mesh = instMesh.get(other.proto);
      if (!mesh) {
        mesh = new THREE.Mesh(other.proto.geo, material);
        mesh.matrixAutoUpdate = false;
        instMesh.set(other.proto, mesh);
      }
      mesh.matrixWorld.copy(other.proto.matrices[other.i]);
      sampleOrigin.set(wx, rayY, wz);
      raycaster.set(sampleOrigin, DOWN);
      raycaster.far = 8;
      for (const hit of raycaster.intersectObject(mesh, false)) {
        if (hit.point.y <= rayY && hit.point.y > best) best = hit.point.y;
      }
    }
    return best;
  }
  const dropped = [];
  for (const item of items) {
    supportBox.copy(item.proto.geo.boundingBox).applyMatrix4(item.proto.matrices[item.i]);
    const minY = supportBox.min.y;
    const cx = (supportBox.min.x + supportBox.max.x) / 2;
    const cz = (supportBox.min.z + supportBox.max.z) / 2;
    const hx = (supportBox.max.x - supportBox.min.x) / 2;
    const hz = (supportBox.max.z - supportBox.min.z) / 2;
    const bb = item.proto.geo.boundingBox;
    const need = (bb.max.x - bb.min.x) * (bb.max.z - bb.min.z) > 0.25 ? 2 : 1;
    sampleLevel.copy(item.world).applyMatrix4(inverse);
    const centerSupport = Math.max(
      groundY(sampleLevel.x, sampleLevel.z),
      structureY(sampleLevel.x, sampleLevel.z, buildings, minY + CULL_GAP),
    );
    if (!inBuilding(sampleLevel.x, sampleLevel.z, 0) && minY - centerSupport > 1) {
      item.keep = false;
      dropped.push(item);
      item.proto.matrices[item.i] = null;
      continue;
    }
    let supported = 0;
    for (const [fx, fz] of SUPPORT_SAMPLES) {
      const wx = cx + fx * hx;
      const wz = cz + fz * hz;
      sampleLevel.set(wx, 0, wz).applyMatrix4(inverse);
      let support = Math.max(
        groundY(sampleLevel.x, sampleLevel.z),
        structureY(sampleLevel.x, sampleLevel.z, buildings, minY + CULL_GAP),
      );
      if (minY - support > CULL_GAP) {
        support = Math.max(
          support,
          meshSupportY(meshes, raycaster, wx, minY + CULL_GAP, wz),
          instanceY(item, wx, minY, wz),
        );
      }
      if (minY - support <= CULL_GAP) supported++;
    }
    if (supported >= need) continue;
    item.keep = false;
    dropped.push(item);
    item.proto.matrices[item.i] = null;
  }
  for (const mesh of meshes) mesh.geometry.dispose();
  material.dispose();
  for (const [id, proto] of A._protos) {
    if (!FURNITURE.has(id)) continue;
    const matrices = [];
    const masks = [];
    for (let i = 0; i < proto.matrices.length; i++) {
      if (!proto.matrices[i]) continue;
      matrices.push(proto.matrices[i]);
      masks.push(proto.masks[i]);
    }
    proto.matrices = matrices;
    proto.masks = masks;
  }
  const skirt = A._protos.get('dust_skirt');
  if (skirt && dropped.length) {
    const matrices = [];
    const masks = [];
    for (let i = 0; i < skirt.matrices.length; i++) {
      levelPosition.setFromMatrixPosition(skirt.matrices[i]).applyMatrix4(inverse);
      const orphan = dropped.some((item) =>
        Math.hypot(levelPosition.x - item.level.x, levelPosition.z - item.level.z) < 0.9 &&
        Math.abs(levelPosition.y - item.level.y) < 0.4
      );
      if (orphan) continue;
      matrices.push(skirt.matrices[i]);
      masks.push(skirt.masks[i]);
    }
    skirt.matrices = matrices;
    skirt.masks = masks;
  }
}
