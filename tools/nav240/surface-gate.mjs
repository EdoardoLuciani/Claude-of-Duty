// Production core acceptance and measurements. Not a live-combat/wave completion test.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import * as THREE from 'three';
import { SurfaceNav } from '../../src/ai/nav.js';
import { AiSystem } from '../../src/ai/index.js';
import { loadMap, addClearStairCases, addFollowupCases, addAccessCases, OBSTRUCTED_MAP_GOALS } from './fixtures.mjs';
import { execute, makeWalker, distribution } from './harness.mjs';
import { parseArgs } from '../lib/browser-harness.mjs';
const args = parseArgs(), root = new URL('../../', import.meta.url);
const files = readdirSync(new URL('src/', root), { recursive: true }).filter(f => f.endsWith('.js')).map(f => `src/${f}`)
  .concat(['tools/nav240/fixtures.mjs', 'tools/nav240/harness.mjs', 'tools/nav240/surface-gate.mjs']).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(file).update('\0').update(readFileSync(new URL(file, root)));
const source = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), sha256: hash.digest('hex'), files };
const fixture = await loadMap(); addClearStairCases(fixture); addFollowupCases(fixture); addAccessCases(fixture);
const nav = await SurfaceNav.load(fixture.surfaceRaw, fixture.physics, { sha256: fixture.meta.navigation.sha256,
  sourceHash: fixture.meta.sourceHash, collisionAsset: fixture.meta.assets.collision });
fixture.grid = nav;
const candidate = { query(from, to) {
  const points = [], n = nav.findPath(from, to, points);
  return { outcome: nav.lastOutcome, reason: nav.lastReason, points: points.slice(0, n),
    startSurface: nav.startSurface, goalSurface: nav.goalSurface };
} };
const results = [], failures = [];
for (const c of fixture.cases) {
  const query = candidate.query(c.from, c.to), result = execute(fixture, candidate, c, true);
  results.push({ ...result, reason: query.reason, startSurface: query.startSurface, goalSurface: query.goalSurface,
    from: c.from.toArray(), to: c.to.toArray() });
  console.log(c.name, result.status, query.reason, result.horizontalError.toFixed(3), result.floorError.toFixed(3));
  if (!c.recorded) {
    if (OBSTRUCTED_MAP_GOALS.includes(c.name)) {
      if (query.outcome === 'success') failures.push(`${c.name}: accepted obstruction`);
    } else if (!result.arrived) failures.push(`${c.name}: ${result.status}`);
    if (result.recovery.length) failures.push(`${c.name}: recovery is not traversal`);
  }
}
const cache = () => ({ nav: null, version: -1, ref: 0, position: new THREE.Vector3(), point: new THREE.Vector3() });
const owners = fixture.cases.map(() => ({ navStart: cache(), navGoal: cache() }));
const cold = [], cached = [], out = [];
for (let pass = 0; pass < 6; pass++) for (let i = 0; i < fixture.cases.length; i++) {
  const c = fixture.cases[i], t = performance.now();
  nav.findPath(c.from, c.to, out, owners[i]);
  (pass ? cached : cold).push(performance.now() - t);
}
// Sustained contention through real Agent._goTo and AiSystem.requestPath/service.
const cases = fixture.cases.filter((c, i) => results[i].arrived).slice(0, 12);
assert.equal(cases.length, 12);
const ai = Object.assign(Object.create(AiSystem.prototype), { grid: nav, agents: [],
  _pathBudget: 0, pathsPerFrame: 2, stats: { pathsDeferred: 0 } });
const service = cases.map(() => []), frames = [];
let frame = -1, maxSolves = 0;
ai.requestPath = function (from, to, path, actor) {
  const n = AiSystem.prototype.requestPath.call(this, from, to, path, actor);
  if (n >= 0) service[actor.id].push(frame);
  return n;
};
for (let i = 0; i < cases.length; i++) {
  const a = makeWalker(fixture, candidate, cases[i].from, i, true);
  a.ai = ai; a.navStart = cache(); a.navGoal = cache(); ai.agents.push(a); a._goTo(cases[i].to);
}
for (frame = 0; frame < 120; frame++) {
  ai._pathBudget = 2;
  const before = nav.stats.queries, t = performance.now();
  ai._servePendingPaths();
  // Keep poses fixed to isolate scheduler/query cost, NOT physical progress.
  for (let i = 0; i < ai.agents.length; i++) ai.agents[i]._goTo(cases[i].to);
  frames.push(performance.now() - t); maxSolves = Math.max(maxSolves, nav.stats.queries - before);
}
assert.equal(maxSolves, 2);
assert.deepEqual(service.map(s => s[0]), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
const gaps = service.flatMap(s => s.slice(1).map((v, i) => v - s[i]));
assert.ok(Math.max(...gaps) <= 6);
for (const a of ai.agents) fixture.physics.removeCharacter(a.controller);
const loads = Array.from({ length: 3 }, () => JSON.parse(execFileSync(process.execPath,
  ['--expose-gc', new URL('./load-surface.mjs', import.meta.url).pathname], { encoding: 'utf8' })));
const report = { source, node: process.version, cpu: cpus()[0].model, assets: fixture.meta.assets,
  sourceHash: fixture.meta.sourceHash, navigation: fixture.meta.navigation, loads,
  queryMs: { uncached: distribution(cold), cached: distribution(cached) },
  scheduler: { frames: 120, actors: 12, maxSolves, firstService: service.map(s => s[0]), maxServiceGap: Math.max(...gaps),
    deferred: ai.stats.pathsDeferred, serviceFrameMs: distribution(frames) },
  counts: results.reduce((counts, r) => { counts[r.status] = (counts[r.status] ?? 0) + 1; return counts; }, {}),
  failures, results };
writeFileSync(args.out ?? '/tmp/nav306-traces.json', JSON.stringify(report, null, 2));
if (args.summary) writeFileSync(args.summary, JSON.stringify({ ...report,
  results: results.map(r => {
    const compact = { ...r, recoveries: r.recovery.length, waypoints: r.initialPath.length };
    delete compact.trace; delete compact.initialPath; delete compact.recovery;
    return compact;
  }) }, null, 2) + '\n');
console.log(JSON.stringify({ counts: report.counts, queryMs: report.queryMs, scheduler: report.scheduler, loads }, null, 2));
nav.dispose();
assert.deepEqual(failures, [], 'production core must retain the stair/entrance feasibility gate');
