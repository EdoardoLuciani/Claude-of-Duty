/** World randomness is keyed per element: editing one building never re-rolls another. */
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { buildWorld } from '../../tools/worldgen/build.js';
import { Assembler } from '../../tools/worldgen/builder.js';
import { BUILDINGS } from '../../tools/worldgen/level/layout.js';

const box = new THREE.Box3();

/** Every merged piece and instance as `key min max`, counted. */
function emitted() {
  const out = new Map();
  const record = (key, geo, matrix) => {
    if (!geo.boundingBox) geo.computeBoundingBox();
    box.copy(geo.boundingBox);
    if (matrix) box.applyMatrix4(matrix);
    const k = `${key} ${box.min.toArray().map((v) => v.toFixed(4))} ${box.max.toArray().map((v) => v.toFixed(4))}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  };
  const A = new Assembler({ materials: { get: (name) => ({ name }) } });
  const add = A.add.bind(A);
  const place = A.place.bind(A);
  A.add = (key, geo, matrix, opts) => (record(key, geo, matrix), add(key, geo, matrix, opts));
  A.place = (id, matrix, masks) => {
    const proto = A._protos.get(id);
    if (proto) record(id, proto.geo, matrix);
    return place(id, matrix, masks);
  };
  buildWorld(A);
  return out;
}

// W2 has facades, an interior stair, furnished rooms, a ladder and roof dressing.
const spec = BUILDINGS.find((building) => building.id === 'W2');
const before = emitted();
const damage = spec.damage;
spec.damage = (damage ?? 0.2) + 0.25; // changes the draw count of every W2 facade
const after = emitted();
spec.damage = damage;

const near = (k) => {
  const [x, , z] = k.split(' ')[1].split(',').map(Number);
  return Math.abs(x - spec.x) < spec.w / 2 + 3 && Math.abs(z - spec.z) < spec.d / 2 + 3;
};
let local = 0;
const leaked = [];
for (const k of new Set([...before.keys(), ...after.keys()])) {
  if ((before.get(k) ?? 0) === (after.get(k) ?? 0)) continue;
  if (near(k)) local++;
  else leaked.push(k);
}
assert.ok(local > 0, 'the edit changes W2 itself');
assert.deepEqual(leaked.slice(0, 5), [], `${leaked.length} pieces changed outside W2`);
