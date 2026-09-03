#!/usr/bin/env node
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { CONFIRMED_FLOAT_FIXTURES } from './lib/support-fixtures.mjs';
import { Assembler } from './worldgen/builder.js';
import { buildWorld } from './worldgen/build.js';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './worldgen/config.js';
import { PLACEMENTS } from './worldgen/placements/index.js';
import { analyzePropSupport } from './worldgen/prop-support.js';

const root = new Rng(0x5eed1234);
root.fork();
root.fork();
const rng = root.fork();
const cache = new Map();
const materials = {
  get(name, opts = {}) {
    const key = `${name}|${!!opts.vertexMasks}`;
    let material = cache.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ name, vertexColors: !!opts.vertexMasks });
      cache.set(key, material);
    }
    return material;
  },
};

const A = new Assembler({ materials, rng, trackSupports: true });
A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
buildWorld(A, rng);
const report = analyzePropSupport(A, PLACEMENTS, CONFIRMED_FLOAT_FIXTURES);
const fixtures = report.results.filter((result) => result.extra);
const suspicious = report.results
  .filter((result) => !result.extra && result.id && result.status !== 'supported')
  .sort((a, b) => (b.nearestGap ?? Infinity) - (a.nearestGap ?? Infinity));
const representativeIds = new Set([
  'crate_b/0056', 'box_card_b/0021', 'jerry_can/0021', 'stool/0030',
  'water_tank/0001', 'box_card_a/0002', 'interior/W2/floor-1/chair/003',
]);
const representatives = report.results.filter((result) => representativeIds.has(result.id));
const rampartSandbags = report.results.filter((result) => (
  !result.id && result.prototype.startsWith('sandbag_') && result.position[1] > 6
));
console.log(JSON.stringify({ stats: report.stats, fixtures, representatives, rampartSandbags, suspicious }, null, 2));
A.dispose();
for (const material of cache.values()) material.dispose();
