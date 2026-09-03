import * as THREE from 'three';
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
const SUPPORT_DECLARATIONS = new Set(['balcony']);
for (const placement of PLACEMENTS) {
  for (const key of Object.keys(placement)) {
    if (!['id', 'prototype', 'position', 'rotationDeg', 'scale', 'masks', 'support'].includes(key)) {
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
  if (placement.support != null && !SUPPORT_DECLARATIONS.has(placement.support)) {
    throw new Error(`[world] ${placement.id}.support must be balcony`);
  }
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
