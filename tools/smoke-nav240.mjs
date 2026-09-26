// The traversal harness must reject fake query successes and exercise real collision.
import assert from 'node:assert/strict';
import { loadMap, synthetic, RECORDED, vec } from './nav240/fixtures.mjs';
import { execute, budgetRun } from './nav240/harness.mjs';
import { SurfaceNav } from '../src/ai/nav.js';
import { bakePhysicsNav } from './worldgen/nav-bake.js';

const fixture = synthetic();
const bake = await bakePhysicsNav(fixture.physics, fixture.bounds);
fixture.grid = await SurfaceNav.load(bake.buffer, fixture.physics);
const candidate = { query(from, to) {
  const points = [], n = fixture.grid.findPath(from, to, points);
  return { outcome: fixture.grid.lastOutcome, points: points.slice(0, n) };
} };
for (const sample of fixture.cases) {
  const result = execute(fixture, candidate, sample);
  assert.equal(result.arrived, sample.reachable, `${sample.name}: ${result.status}`);
  assert.equal(result.recovery.length, 0, `${sample.name}: traversal must not require teleporting`);
  if (!sample.reachable) assert.notEqual(result.initialOutcome, 'success', sample.name);
}
const stacked = fixture.cases.find(c => c.name === 'wrong-storey');
const lie = { query: (_from, to) => ({ outcome: 'success', points: [to.clone()] }) };
const falseArrival = execute(fixture, lie, stacked);
assert.equal(falseArrival.initialOutcome, 'success');
assert.equal(falseArrival.arrived, false, 'X/Z waypoint exhaustion is not floor-correct arrival');

const map = await loadMap();
map.grid = await SurfaceNav.load(map.surfaceRaw, map.physics);
for (const [id, p] of RECORDED) {
  const from = vec(p), to = from.clone(); to.y += 4;
  const result = execute(map, lie, { name: `enemy-${id}/wrong-storey`, from, to });
  assert.equal(result.arrived, false, `enemy ${id}: real capsule must not climb a waypoint's Y`);
  assert.ok(result.floorError > 3, `enemy ${id}: wrong floor must remain observable`);
}
const doorway = map.cases.find(c => c.name === 'W5/entrance');
assert.equal(execute(map, lie, doorway).arrived, true, 'real capsule must walk through W5 doorway');

// Reproduce the recorded jam without using the navigator as its own oracle.
const jam = map.cases.find(c => c.name === 'enemy-12/anchor-0');
const unsafe = { query: () => ({ outcome: 'success', points: [vec([-7.2, 0.153, -4])] }) };
const stalled = execute(map, unsafe, jam);
assert.equal(stalled.arrived, false, 'a nonempty unsafe path must not pass the traversal test');
assert.ok(stalled.maxStall >= 3 || stalled.recovery.length > 0, 'real collision must expose the planter-area stall');

const routed = { query(from, to) {
  const points = [], n = map.grid.findPath(from, to, points);
  return { outcome: map.grid.lastOutcome, points: points.slice(0, n) };
} };
const budget = budgetRun(map, routed, map.cases.filter(c => !c.recorded).slice(0, 12), true);
assert.ok(budget.maxSolves <= 2, 'production two-solves budget exceeded');
assert.ok(budget.firstService.every(f => f !== null && f <= 5), 'initial request burst starved an actor');
fixture.grid.dispose(); map.grid.dispose();
console.log('ok  nav240 real-controller harness, stacked floors, stairs, recorded coordinates and budget');
