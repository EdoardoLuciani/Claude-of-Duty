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
