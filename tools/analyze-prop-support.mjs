#!/usr/bin/env node
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
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
  .filter((result) => !result.extra && result.status !== 'supported')
  .sort((a, b) => (b.nearestGap ?? Infinity) - (a.nearestGap ?? Infinity));
const representativeIds = new Set([
  'crate_b/0056', 'box_card_b/0021', 'jerry_can/0021', 'stool/0030',
  'water_tank/0001', 'box_card_a/0002', 'interior/W2/floor-1/chair/003',
]);
const representatives = report.results.filter((result) => representativeIds.has(result.id));
const rampartSandbags = report.results.filter((result) => (
  !result.id && result.prototype.startsWith('sandbag_') && result.position[1] > 6
));
const baselinePath = process.argv.find((arg) => arg.startsWith('--compare='))?.slice('--compare='.length);
let comparison;
if (baselinePath) {
  const before = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (!Array.isArray(before.results)) throw new Error('Comparison requires a full --all report');
  const key = (result) => `${result.extra ? 'fixture/' : ''}${result.prototype}|${result.position.map((n) => n.toFixed(3)).join('|')}`;
  const previous = new Map(before.results.map((result) => [key(result), result]));
  const transitions = {}, fixtureTransitions = {};
  const newlyFlagged = [], cleared = [], reclassified = [], added = [];
  for (const result of report.results) {
    const old = previous.get(key(result));
    previous.delete(key(result));
    if (!old) { added.push(result.key); continue; }
    const transition = `${old.status} -> ${result.status}`;
    const matrix = result.extra ? fixtureTransitions : transitions;
    matrix[transition] = (matrix[transition] ?? 0) + 1;
    if (old.status === result.status) continue;
    const delta = { key: result.key, prototype: result.prototype, position: result.position, before: old.status, after: result.status, physical: result.physical, reasons: result.reasons, localReasons: result.localReasons, stabilityMargin: result.stabilityMargin, nearestGap: result.nearestGap, nearestSupport: result.nearestSupport };
    if (old.status === 'supported') newlyFlagged.push(delta);
    else if (result.status === 'supported') cleared.push(delta);
    else reclassified.push(delta);
  }
  comparison = { baseline: before.stats, current: report.stats, transitions, fixtureTransitions, newlyFlagged, cleared, reclassified, added, removed: [...previous.values()].map((result) => result.id ?? key(result)) };
}
console.log(JSON.stringify(process.argv.includes('--all') ? { ...report, comparison } : {
  stats: report.stats, comparison, fixtures, representatives, rampartSandbags, suspicious,
}, null, 2));
A.dispose();
for (const material of cache.values()) material.dispose();
