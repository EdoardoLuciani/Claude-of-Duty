#!/usr/bin/env node
// node --expose-gc tools/nav240/run.mjs --recast /path/to/recast-navigation --out report.json
import { writeFileSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMap, synthetic, oldGrid, PROFILE } from './fixtures.mjs';
import { legacy, execute, budgetRun, distribution, canConnect } from './harness.mjs';
import { layeredGrid } from './layers.mjs';
import { recastApi, recastMesh } from './recast.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes('--out')) throw new Error('Specify --out <report.json>');
const api = args.includes('--recast') ? await recastApi(option('--recast')) : null;
const toolHash = createHash('sha256');
for (const file of readdirSync(new URL('./', import.meta.url)).filter(f => f.endsWith('.mjs')).sort()) {
  toolHash.update(file); toolHash.update(readFileSync(new URL(file, import.meta.url)));
}
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  toolSourceHash: toolHash.digest('hex'),
  node: process.version, cpu: cpus()[0].model, profile: PROFILE, wasmInitMs: api?.initMs,
  results: [], limitations: ['headless fixed-goal movement, not full senses/combat or browser rendering',
    'standing-only prototypes; crouch-only traversal is rejected', 'no off-mesh links',
    'prototype JS allocations are not production-ready', 'prototype bake memory is not runtime residency'] };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const fixture of [synthetic(), await loadMap()]) {
  if (fixture.meta) report.assets = { sourceHash: fixture.meta.sourceHash, ...fixture.meta.assets };
  const factories = [() => legacy(fixture.grid)];
  if (!args.includes('--baseline-only')) {
    if (!args.includes('--recast-only')) factories.push(() => layeredGrid(fixture.physics, fixture.bounds, 0.4));
    if (args.includes('--fine-grid')) factories.push(() => layeredGrid(fixture.physics, fixture.bounds, 0.2));
    if (api) for (const cs of (args.includes('--recast-cells') ? option('--recast-cells').split(',').map(Number) : [0.2, 0.1])) {
      factories.push(() => recastMesh(api, fixture.physics, cs));
    }
  }
  for (const create of factories) {
    global.gc?.();
    const memoryBefore = process.memoryUsage();
    const candidate = create();
    global.gc?.();
    const memoryAfter = process.memoryUsage();
    console.error(`Evaluating ${fixture.name}/${candidate.name}`);
    const result = { fixture: fixture.name, candidate: candidate.name, ...candidate.metrics,
      retainedHeapDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
      retainedArrayBufferDelta: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
      wasmHeapBytes: api?.Raw.Module.HEAPU8?.byteLength };
    const packed = candidate.packed ?? fixture.raw;
    if (packed) {
      result.sha256 = hash(packed); result.packedBytes = packed.length;
      result.gzipBytes = gzipSync(packed, { level: 9 }).length;
    }
    if (candidate.packed) {
      const repeat = create();
      result.repeatByteIdentical = repeat.packed.equals(candidate.packed);
      result.repeatBakeMs = repeat.metrics.bakeMs;
      repeat.dispose?.();
      if (candidate.name.startsWith('recast-')) {
        const dir = mkdtempSync(join(tmpdir(), 'nav240-load-'));
        try {
          const filename = join(dir, 'nav.bin'); writeFileSync(filename, packed);
          result.coldLoad = JSON.parse(execFileSync(process.execPath,
            [fileURLToPath(new URL('./load-recast.mjs', import.meta.url)), option('--recast'), filename], { encoding: 'utf8' }));
        } finally { rmSync(dir, { recursive: true, force: true }); }
      }
    }
    const times = [];
    result.queries = fixture.cases.map((sample) => {
      candidate.query(sample.from, sample.to); // warm this input
      let q;
      for (let i = 0; i < 5; i++) {
        const start = performance.now(); q = candidate.query(sample.from, sample.to);
        times.push(performance.now() - start);
      }
      return { name: sample.name, outcome: q.outcome, waypoints: q.points.length, expanded: q.expanded, stale: q.stale };
    });
    result.queryMs = distribution(times);
    // Run both actual shipped capsule settings and a separate, clearly labelled
    // corrected-slope/largest-variant sensitivity test. Never silently fix baseline.
    result.movement = fixture.cases.map(sample => execute(fixture, candidate, sample));
    result.correctedMovement = fixture.cases.map(sample => execute(fixture, candidate, sample, true));
    if (fixture.name === 'map') result.budget = budgetRun(fixture, candidate, fixture.cases.filter(c => !c.recorded).slice(0, 12), false);
    if (fixture.name === 'synthetic') {
      result.floorCover = [0, 3.15].map(y => {
        const x = -1.4, z = 0;
        const ref = candidate.resolve ? candidate.resolve({ x, y, z }) : fixture.grid.nearest(x, z, y);
        const navY = typeof ref === 'number' ? (candidate.points?.[ref]?.y ?? fixture.grid.floor[ref]) : ref?.nearestPoint.y;
        const probe = (floor, h) => Number.isFinite(floor)
          && fixture.physics.raycastAny(x, floor + h, z, 1, 0, 0, 1.3, fixture.physics.MASK.WORLD);
        return { y, surfaceRef: typeof ref === 'number' ? ref : ref?.nearestRef, navY,
          physical: { low: probe(y, 0.55), high: probe(y, 1.32) },
          projected: { low: probe(navY, 0.55), high: probe(navY, 1.32) } };
      });
    }
    report.results.push(result);
    candidate.dispose?.();
    writeFileSync(option('--out'), JSON.stringify(report, null, 2) + '\n');
    console.error(JSON.stringify({ candidate: result.candidate, fixture: result.fixture, queryMs: result.queryMs,
      outcomes: result.movement.reduce((o, r) => { o[r.status] = (o[r.status] ?? 0) + 1; return o; }, {}) }));
  }
  if (fixture.name === 'map') {
    report.directController = fixture.cases.filter(c => !c.recorded).map(c => ({ name: c.name,
      reachable: canConnect(fixture.physics, c.from, c.to) }));
    report.oldSolver = [];
    for (const precision of ['float32', 'float64']) {
      const grid = oldGrid(fixture.physics, fixture.bounds, fixture.raw);
      if (precision === 'float64') grid.gScore = new Float64Array(grid.gScore.length);
      let pops = 0, repeats = 0, drops = 0;
      const seen = new Map();
      const pop = grid.open.pop.bind(grid.open), push = grid.open.push.bind(grid.open);
      grid.open.pop = () => {
        const i = pop(); pops++;
        if (seen.get(i) === grid.gScore[i]) repeats++;
        seen.set(i, grid.gScore[i]); return i;
      };
      grid.open.push = (i, k) => { if (grid.open.n >= grid.open.idx.length) drops++; push(i, k); };
      for (const c of fixture.cases.filter(c => c.recorded === 12)) {
        pops = repeats = drops = 0; seen.clear();
        const t = performance.now(); const out = []; const n = grid.findPath(c.from, c.to, out);
        report.oldSolver.push({ precision, name: c.name, waypoints: n, pops, equivalentRepeatPops: repeats,
          heapDrops: drops, ms: performance.now() - t });
      }
    }
  }
}
writeFileSync(option('--out'), JSON.stringify(report, null, 2) + '\n');
