#!/usr/bin/env node
import assert from 'node:assert/strict';
import { wallBacking } from './worldgen/interiors.js';

const envelope = { x0: 0, z0: 0, x1: 10, z1: 8 };
const facadeRoom = {
  x0: 0, z0: 0, x1: 10, z1: 8, y: 0.42, envelope,
  partitions: [], doors: [],
  facadeOpenings: [
    { side: 0, x: 5, z: 0, w: 3, y0: 0, y1: 2.6, kind: 'shop' },
  ],
};
assert.equal(wallBacking(facadeRoom, 0, 4.2, 5.8, 1.1, 1.8), false, 'shopfront is not backing');
assert.equal(wallBacking(facadeRoom, 0, 0.5, 2.0, 1.1, 1.8), true, 'facade pier backs dressing');
assert.equal(wallBacking(facadeRoom, 0, 4.2, 5.8, 2.75, 3.0), true, 'lintel backs high dressing');
assert.equal(wallBacking(facadeRoom, 0, 2.0, 4.0, 1.1, 1.8), false, 'partial opening overlap is rejected');

const partitionRoom = {
  x0: 0, z0: 0, x1: 5, z1: 8, y: 0.42, envelope,
  facadeOpenings: [],
  partitions: [{ x0: 5, z0: 0, x1: 5, z1: 8 }],
  doors: [{ x: 5, z: 4 }],
};
assert.equal(wallBacking(partitionRoom, 1, 0.5, 2.0, 1.0, 1.8), true, 'partition backs dressing');
assert.equal(wallBacking(partitionRoom, 1, 3.8, 4.2, 1.0, 1.8), false, 'partition doorway is not backing');
assert.equal(wallBacking(partitionRoom, 1, 3.8, 4.2, 2.8, 3.0), true, 'partition above doorway is backing');

console.log('wall support smoke ok');
