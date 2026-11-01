import assert from 'node:assert/strict';

import * as THREE from 'three';

import { PLACEMENTS } from '../../tools/worldgen/level/placements/index.js';
import {
  clearDoorwayClutter,
  clearVolumeClutter,
  placeBaked,
  validatePlacements,
} from '../../tools/worldgen/placement.js';

const record = {
  id: 'crate/test',
  prototype: 'crate_a',
  position: [1, 2, 3],
  rotationDeg: [10, 20, 30],
  scale: [1, 2, 1],
};
validatePlacements(PLACEMENTS);
validatePlacements([
  record,
  { ...record, id: 'crate/other', support: 'balcony', masks: [1, 0, 1] },
]);
assert.throws(() => validatePlacements([record, record]), /duplicate placement id/);
for (const [patch, error] of [
  [{ unexpected: true }, /unknown field/],
  [{ id: '' }, /placement needs an id/],
  [{ prototype: '' }, /needs a prototype/],
  [{ position: [1, 2] }, /position must contain three finite numbers/],
  [{ rotationDeg: [1, NaN, 3] }, /rotationDeg must contain three finite numbers/],
  [{ scale: [1, 2, Infinity] }, /scale must contain three finite numbers/],
  [{ masks: [1, 2] }, /masks must contain three finite numbers/],
  [{ support: 'floating' }, /support must be balcony/],
]) {
  assert.throws(() => validatePlacements([{ ...record, ...patch }]), error);
}

// A consuming assembler must see every authored record in order, with no changes
// to IDs/prototypes, degree-to-radian transforms or optional mask semantics.
let placed = 0;
placeBaked({
  has: () => true,
  place(prototype, matrix, masks) {
    const placement = PLACEMENTS[placed++];
    assert.equal(prototype, placement.prototype);
    assert.equal(masks, placement.masks ?? null);
    const expected = new THREE.Matrix4()
      .makeRotationFromEuler(
        new THREE.Euler(...placement.rotationDeg.map(THREE.MathUtils.degToRad))
      )
      .scale(new THREE.Vector3(...placement.scale))
      .setPosition(...placement.position);
    for (let i = 0; i < 16; i++) {
      assert(Math.abs(matrix.elements[i] - expected.elements[i]) < 1e-10, placement.id);
    }
  },
});
assert.equal(placed, PLACEMENTS.length);
assert.throws(() => placeBaked({ has: () => false }), /references unknown prototype/);

// Clearance runs in level space even when instance matrices are world-space;
// preserve surviving order and parallel masks, and never clear structural shapes.
const xform = new THREE.Matrix4().makeRotationY(0.6).setPosition(10, 1, -8);
const matrixAt = (x, y, z) => xform.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
const outside = matrixAt(5, 0.2, 0);
const high = matrixAt(0, 3, 0);
const crate = {
  matrices: [matrixAt(0, 0.2, 0), outside, high],
  masks: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
};
const table = { matrices: [matrixAt(0, 0.8, 0)], masks: [[1, 1, 1]] };
const beam = { matrices: [matrixAt(0, 0.2, 0)], masks: [[1, 1, 1]] };
const assembler = {
  xform,
  _protos: new Map([
    ['crate_a', crate],
    ['table', table],
    ['beam', beam],
  ]),
};
clearDoorwayClutter(assembler, [{ from: [-1, 0, 0], to: [1, 0, 0] }]);
assert.equal(assembler.culledDoorwayClutter, 1);
assert.deepEqual(crate.matrices, [outside, high]);
assert.deepEqual(crate.masks, [
  [1, 0, 0],
  [0, 1, 0],
]);
assert.equal(table.matrices.length, 1);
clearVolumeClutter(assembler, [{ x0: -0.5, x1: 0.5, z0: -0.5, z1: 0.5 }]);
assert.equal(assembler.culledVolumeClutter, 2);
assert.deepEqual(crate.matrices, [outside]);
assert.deepEqual(crate.masks, [[1, 0, 0]]);
assert.equal(table.matrices.length, 0);
assert.equal(beam.matrices.length, 1);
clearVolumeClutter(assembler, []);
assert.equal(assembler.culledVolumeClutter, 2);
console.log(`World placement validation, ${placed} ordered transforms/masks and clearance passed.`);
