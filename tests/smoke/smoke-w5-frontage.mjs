#!/usr/bin/env node
/** W5 retains its terrace/frontage, not balcony cages inside that terrace. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { Rng } from '../../src/core/rng.ts';
import { Assembler } from '../../tools/worldgen/builder.js';
import { buildWorld } from '../../tools/worldgen/build.js';
import { BUILDINGS } from '../../tools/worldgen/layout.js';
import { PLACEMENTS } from '../../tools/worldgen/placements/index.js';

const spec = BUILDINGS.find((building) => building.id === 'W5');
const omission = spec.omitBalconies;
function compile(omit) {
  const root = new Rng(0x5eed1234);
  root.fork(); root.fork();
  const rng = root.fork();
  const A = new Assembler({ rng });
  const records = [];
  const add = A.add.bind(A);
  A.add = (key, geometry, matrix, opts) => {
    const hash = createHash('sha256').update(JSON.stringify([key, matrix?.elements, opts]));
    for (const name of Object.keys(geometry.attributes).sort()) {
      hash.update(name).update(Buffer.from(geometry.attributes[name].array.buffer));
    }
    if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer));
    geometry.computeBoundingBox();
    records.push({ hash: hash.digest('hex'), box: geometry.boundingBox.clone().applyMatrix4(matrix ?? new THREE.Matrix4()) });
    return add(key, geometry, matrix, opts);
  };
  spec.omitBalconies = omit;
  try {
    const buildings = buildWorld(A, rng);
    const props = [...A._protos].map(([id, proto]) => [id, proto.matrices.map((matrix) => matrix.elements), proto.masks]);
    return { records, buildings, props, state: [rng.s0, rng.s1, rng.s2, rng.s3] };
  } finally {
    spec.omitBalconies = omission;
    A.dispose();
  }
}
const before = compile(undefined);
const after = compile(omission);
const w5 = after.buildings.find((building) => building.spec.id === 'W5');
assert.deepEqual(w5.balconies.map((balcony) => balcony.side), [0], 'keep the separate south balcony only');
assert.deepEqual(w5.facadeOpenings, before.buildings[0].facadeOpenings, 'frontage openings and terrace doors unchanged');
assert.deepEqual(w5.traversable, before.buildings[0].traversable, 'both ground traversal doors unchanged');
assert.deepEqual(w5.terraces, before.buildings[0].terraces, 'full-width playable terrace unchanged');
assert.deepEqual(w5.ladders, before.buildings[0].ladders, 'roof access unchanged');
assert.deepEqual(after.buildings.slice(1), before.buildings.slice(1), 'all other buildings, including boolean omissions, unchanged');
assert.deepEqual(after.props, before.props, 'all retained prop transforms/masks unchanged');
assert.deepEqual(after.state, before.state, 'sink-only balcony rugs preserve the complete world RNG stream');
assert.ok(after.buildings.every((building) => building.balconies.every((balcony) => !balcony.omitted)), 'no sink-only anchors escape authoring');
for (const id of ['bucket/0007', 'jerry_can/0006', 'jerry_can/0007', 'planter/0006', 'stool/0009']) {
  assert.ok(!PLACEMENTS.some((placement) => placement.id === id), `${id}: removed balcony clutter`);
}
// Match every static add byte-for-byte. The only missing adds must be the two
// redundant balconies and their rugs, never geometry/dressing elsewhere.
const retained = new Map();
for (const record of after.records) retained.set(record.hash, (retained.get(record.hash) ?? 0) + 1);
const removed = [];
for (const record of before.records) {
  const count = retained.get(record.hash) ?? 0;
  if (count) retained.set(record.hash, count - 1);
  else removed.push(record);
}
assert.ok([...retained.values()].every((count) => count === 0), 'no new or reshuffled static geometry');
assert.ok(removed.length > 20, 'both balcony assemblies removed');
const frontage = new THREE.Box3(new THREE.Vector3(-8.75, 3.1, 29.6), new THREE.Vector3(-7.1, 5.0, 35.2));
for (const record of removed) assert.ok(frontage.containsBox(record.box), `removed static geometry outside W5 street balconies: ${JSON.stringify(record.box)}`);
console.log(`ok  W5 frontage: ${removed.length} local static adds removed; other geometry, retained props, routes and RNG unchanged`);
