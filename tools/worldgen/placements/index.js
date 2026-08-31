import * as THREE from 'three';
import { groundY, structureY } from '../queries.js';
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
  'table_small', 'chair', 'cabinet', 'water_tank', 'planter', 'stool',
  'box_card_a', 'box_card_b', 'block_small',
]);
const CULL_GAP = 0.16;
const localPoint = new THREE.Vector3();
const otherInverse = new THREE.Matrix4();

function stackedOn(item, items) {
  for (const other of items) {
    if (other === item || !other.keep) continue;
    const bb = other.proto.geo.boundingBox;
    if (!bb) continue;
    const height = bb.max.y - bb.min.y;
    const dy = item.level.y - other.level.y;
    if (dy < height - 0.12 || dy > height + 0.18) continue;
    otherInverse.copy(other.matrix).invert();
    localPoint.copy(item.world).applyMatrix4(otherInverse);
    const ix = Math.min(0.08, (bb.max.x - bb.min.x) * 0.2);
    const iz = Math.min(0.08, (bb.max.z - bb.min.z) * 0.2);
    if (
      localPoint.x >= bb.min.x + ix && localPoint.x <= bb.max.x - ix &&
      localPoint.z >= bb.min.z + iz && localPoint.z <= bb.max.z - iz
    ) return true;
  }
  return false;
}

/** Omit furniture whose origin is more than CULL_GAP above ground and every authored slab. */
export function seatUnsupported(A, buildings) {
  inverse.copy(A.xform).invert();
  const items = [];
  for (const [id, proto] of A._protos) {
    if (!FURNITURE.has(id)) continue;
    proto.geo.computeBoundingBox();
    for (let i = 0; i < proto.matrices.length; i++) {
      const matrix = proto.matrices[i];
      const world = new THREE.Vector3().setFromMatrixPosition(matrix);
      const level = world.clone().applyMatrix4(inverse);
      items.push({ id, proto, i, matrix, world, level, origY: level.y, keep: true });
    }
  }
  items.sort((a, b) => a.level.y - b.level.y);
  for (const item of items) {
    const support = Math.max(
      groundY(item.level.x, item.level.z),
      structureY(item.level.x, item.level.z, buildings, item.level.y),
    );
    const gap = item.level.y - (Number.isFinite(support) ? support : -Infinity);
    if (stackedOn(item, items)) continue;
    if (gap > CULL_GAP) item.keep = false;
  }
  const dropped = [];
  for (const [id, proto] of A._protos) {
    if (!FURNITURE.has(id)) continue;
    const matrices = [];
    const masks = [];
    for (let i = 0; i < proto.matrices.length; i++) {
      const item = items.find((entry) => entry.proto === proto && entry.i === i);
      if (!item?.keep) {
        if (item) dropped.push(item);
        continue;
      }
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
        Math.abs(levelPosition.y - item.origY) < 0.4
      );
      if (orphan) continue;
      matrices.push(skirt.matrices[i]);
      masks.push(skirt.masks[i]);
    }
    skirt.matrices = matrices;
    skirt.masks = masks;
  }
  A.seatedUnsupported = dropped.length;
}
