// Production Recast/Detour, cooked-physics execution and the actual AI request boundary.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Detour, Raw } from '@recast-navigation/core';
import { SurfaceNav, CoverMap } from '../src/ai/nav.js';
import { unpackNav, navHash, NAV_ENGINE } from '../src/ai/nav-format.js';
import { AiSystem } from '../src/ai/index.js';
import { bakePhysicsNav } from './worldgen/nav-bake.js';
import { synthetic, loadMap, addClearStairCases, OBSTRUCTED_MAP_GOALS } from './nav240/fixtures.mjs';
import { execute, makeWalker } from './nav240/harness.mjs';

const packages = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
for (const version of [packages.dependencies['@recast-navigation/core'], packages.dependencies['@recast-navigation/wasm'],
  packages.devDependencies['@recast-navigation/generators']]) assert.equal(`recast-navigation@${version}`, NAV_ENGINE, 'bake ABI and exact dependency pins must agree');
const beforeModule = Raw.Module;
await assert.rejects(SurfaceNav.load(new Uint8Array(64), {}), /unsupported bake magic/);
assert.equal(Raw.Module, beforeModule, 'reject malformed assets before WASM initialization');
const f = synthetic(), provenance = { sourceHash: 'fixture', collisionAsset: 'synthetic' };
const bake = await bakePhysicsNav(f.physics, f.bounds, provenance);
const repeat = await bakePhysicsNav(f.physics, f.bounds, provenance);
assert.deepEqual(bake.buffer, repeat.buffer, 'repeated bakes must be byte-identical');
const expected = { ...provenance, sha256: await navHash(bake.buffer) };
const nav = await SurfaceNav.load(bake.buffer, f.physics, expected);
f.grid = nav;
const candidate = { query(from, to) {
  const points = [], n = nav.findPath(from, to, points);
  return { points: points.slice(0, n), outcome: nav.lastOutcome, reason: nav.lastReason };
} };
for (const c of f.cases) {
  const r = execute(f, candidate, c, true);
  assert.equal(r.arrived, c.reachable, `${c.name}: ${r.status}`);
  assert.equal(r.recovery.length, 0, `${c.name}: recovery is not traversal`);
  if (!c.reachable) assert.notEqual(r.initialOutcome, 'success', `${c.name}: no fictitious route`);
}
const stack = f.cases.find(c => c.name === 'wrong-storey'), tmp = new THREE.Vector3();
const ground = nav.project(stack.from, tmp), roof = nav.project(stack.to, tmp);
assert.ok(ground && roof && ground !== roof);
assert.notEqual(nav.components.get(ground), nav.components.get(roof));
const alias = stack.from.clone();
assert.equal(nav.project(alias, alias), ground, 'in-place projection must not lose the physical input');
assert.equal(nav.project(new THREE.Vector3(Infinity, 0, 0), tmp), 0);
assert.equal(nav.project(new THREE.Vector3(1e20, 0, 0), tmp), 0);
assert.equal(nav.sampleGround(NaN, 0, 0, tmp), 0);

// Check the complete Detour result, not just its success bit or a non-empty list.
const corner = f.cases.find(c => c.name === 'corner');
const solve = nav.query.findPath.bind(nav.query), straighten = nav.query.findStraightPath.bind(nav.query);
for (const [flag, reason] of [[Detour.DT_PARTIAL_RESULT, 'partial-path'], [Detour.DT_BUFFER_TOO_SMALL, 'path-limit'], [Detour.DT_OUT_OF_NODES, 'search-limit']]) {
  nav.query.findPath = (...args) => { const p = solve(...args); p.status |= flag; return p; };
  assert.equal(nav.findPath(corner.from, corner.to, []), 0);
  assert.equal(nav.lastOutcome, 'unreachable'); assert.equal(nav.lastReason, reason);
}
nav.query.findPath = (...args) => {
  const p = solve(...args); p.polys.set(p.polys.size - 1, nav.startSurface); return p;
};
assert.equal(nav.findPath(corner.from, corner.to, []), 0);
assert.equal(nav.lastReason, 'partial-path', 'corridor must actually end on the goal surface');
nav.query.findPath = solve;
for (const [flag, reason] of [[Detour.DT_PARTIAL_RESULT, 'partial-path'], [Detour.DT_BUFFER_TOO_SMALL, 'path-limit'], [Detour.DT_OUT_OF_NODES, 'search-limit']]) {
  nav.query.findStraightPath = (...args) => { const p = straighten(...args); p.status |= flag; return p; };
  assert.equal(nav.findPath(corner.from, corner.to, []), 0);
  assert.equal(nav.lastReason, reason);
}
nav.query.findStraightPath = (...args) => {
  const p = straighten(...args); p.straightPathFlags.set(p.straightPathCount - 1, 0); return p;
};
assert.equal(nav.findPath(corner.from, corner.to, []), 0);
assert.equal(nav.lastReason, 'partial-path', 'straight path must contain its end marker');
nav.query.findStraightPath = straighten;
assert.ok(nav.findPath(corner.from, corner.to, []) > 0);

// Both envelope checks and nested native bounds must reject before unchecked import.
const corrupt = async (change, pattern, checksum = true) => {
  const b = new Uint8Array(bake.buffer), d = new DataView(b.buffer);
  change(b, d);
  if (checksum) b.set(new Uint8Array(await crypto.subtle.digest('SHA-256', b.subarray(64))), 32);
  await assert.rejects(SurfaceNav.load(b, f.physics), pattern);
};
await assert.rejects(unpackNav(bake.buffer.subarray(0, -4)), /lengths disagree/);
await assert.rejects(unpackNav(bake.buffer, { sha256: '0'.repeat(64) }), /manifest nav hash/);
await assert.rejects(unpackNav(bake.buffer, { sourceHash: 'stale' }), /sourceHash mismatch/);
await assert.rejects(unpackNav(bake.buffer, { collisionAsset: 'stale' }), /collisionAsset mismatch/);
await corrupt(b => { b[b.length - 1] ^= 1; }, /checksum/, false);
await corrupt((_b, d) => d.setUint32(24, 1, true), /reserved flags/);
await corrupt((_b, d) => d.setUint32(20, 999999, true), /lengths disagree/);
const tile = d => 64 + d.getUint32(8, true) + 48;
await corrupt((_b, d) => d.setUint32(tile(d) + 32, 0xffffffff, true), /section lengths/);
await corrupt((_b, d) => d.setFloat32(tile(d) + 100, NaN, true), /nonfinite vertex/);
await corrupt((_b, d) => d.setUint32(tile(d) + 4, 99, true), /tile version/);
for (const [from, to, error] of [['0.43.1', '0.43.2', /version\/engine/], ['"radius":0.36', '"radius":0.37', /infantry profile/], ['"cs":0.045', '"cs":0.046', /bake configuration/]]) {
  await corrupt((b, d) => {
    const length = d.getUint32(8, true), text = new TextDecoder().decode(b.subarray(64, 64 + length));
    assert.ok(text.includes(from)); b.set(new TextEncoder().encode(text.replace(from, to)), 64);
  }, error);
}
const boot = Object.assign(Object.create(AiSystem.prototype), { _phys: f.physics, grid: null,
  ctx: { peek: () => ({ worldNav: new Uint8Array(64), worldPrefetch: Promise.resolve({ meta: {
    navigation: { version: 1, sha256: expected.sha256 }, sourceHash: 'fixture', assets: { collision: 'synthetic' },
  } }) }) } });
await assert.rejects(boot._buildNav(), /unsupported bake magic/);
assert.equal(boot.grid, null, 'bad bake must not trigger an online/fallback navigator');
const unavailable = makeWalker(f, candidate, f.cases[0].from, 99, true);
unavailable.ai.grid = null;
assert.equal(unavailable._goTo(f.cases[0].to), false);
assert.equal(unavailable.pathOutcome, 'invalid'); assert.equal(unavailable.pathReason, 'nav-unavailable');
f.physics.removeCharacter(unavailable.controller);

// Persistent contention: first service by frame five, then no actor waits over six
// frames even when already-served actors immediately ask again. No raised budget.
const clear = f.cases[0], ai = Object.assign(Object.create(AiSystem.prototype), {
  grid: nav, agents: [], pathsPerFrame: 2, _pathBudget: 0, stats: { pathsDeferred: 0 },
});
const cache = () => ({ nav: null, version: -1, ref: 0, position: new THREE.Vector3(), point: new THREE.Vector3() });
const serviced = Array.from({ length: 12 }, () => []);
let frame = -1;
ai.requestPath = function (from, to, out, actor) {
  const n = AiSystem.prototype.requestPath.call(this, from, to, out, actor);
  if (n >= 0) serviced[actor.id].push(frame);
  return n;
};
for (let id = 0; id < 12; id++) {
  const a = makeWalker(f, candidate, clear.from, id, true);
  a.ai = ai; a.navStart = cache(); a.navGoal = cache(); a._failStreak = 0; a._failWait = 0;
  ai.agents.push(a); a._goTo(clear.to);
  assert.equal(a.pathOutcome, 'deferred'); assert.equal(a._failStreak, 0);
}
for (frame = 0; frame < 60; frame++) {
  ai._pathBudget = 2;
  const before = nav.stats.queries;
  ai._servePendingPaths();
  for (const a of ai.agents) a._goTo(clear.to);
  assert.ok(nav.stats.queries - before <= 2);
}
assert.deepEqual(serviced.map(s => s[0]), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
for (const s of serviced) {
  assert.equal(s.length, 10);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] - s[i - 1] <= 6);
}
const a = ai.agents[0], checks = nav.stats.endpointChecks, hits = nav.stats.cacheHits;
nav.findPath(clear.from, clear.to, [], a);
assert.equal(nav.stats.endpointChecks, checks); assert.ok(nav.stats.cacheHits >= hits + 2);
const second = await SurfaceNav.load(bake.buffer, f.physics);
second.findPath(clear.from, clear.to, [], a);
assert.equal(second.stats.cacheHits, 0, 'cache belongs to its navigator, even with identical poly refs');
second.dispose();
for (const actor of ai.agents) f.physics.removeCharacter(actor.controller);

// Floor/component ownership and claims, including connected floors above us.
const p = { x: -5, y: .05, z: -2, dx: 0, dz: -1, high: true, claimed: -1 };
const lower = nav.project(p, tmp, null, true);
const good = { ...p, surface: lower, component: nav.components.get(lower) };
nav.coverPoints = [good, { ...good, y: 3.2, high: true }, { ...good, component: -1, x: -6 }];
const cover = new CoverMap(nav, f.physics), threat = new THREE.Vector3(-5, 1.5, -14);
assert.equal(cover.pick(clear.from, threat, { id: 5 }), good);
assert.equal(good.claimed, 5); assert.equal(cover.pick(clear.from, threat, { id: 6 }), null);
cover.release(5); assert.equal(good.claimed, -1);
cover.pick(clear.from, threat, { id: 6 }); cover.releaseAll(); assert.equal(good.claimed, -1);

// Moving or newly obstructed endpoints cannot reuse stale successful attachments.
nav.findPath(clear.from, clear.to, [], a);
const block = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 1.5), new THREE.MeshBasicMaterial());
block.position.copy(clear.to); block.position.y += .5; block.updateMatrixWorld(true);
f.physics.addStatic(block, 'concrete');
assert.equal(nav.findPath(clear.from, clear.to, [], a), 0);
assert.equal(nav.lastReason, 'collision-pending', 'never probe stale collision while its rebuild is pending');
f.physics.rebuildStatic();
assert.equal(nav.findPath(clear.from, clear.to, [], a), 0);
assert.equal(nav.lastOutcome, 'invalid'); assert.equal(nav.lastReason, 'goal-attachment');
f.physics.removeStatic(block); f.physics.rebuildStatic();
assert.ok(nav.findPath(clear.from, clear.to, [], a) > 0);
assert.equal(nav.findPath(clear.from, stack.to, [], a), 0);
assert.equal(nav.lastReason, 'disconnected');
block.geometry.dispose(); block.material.dispose();
nav.dispose();
assert.equal(f.physics.characters.length, 0, 'navigation probes must not register game actors');

// Committed production assets retain the 305 stair/door feasibility gate.
const map = await loadMap(); addClearStairCases(map);
const live = await SurfaceNav.load(map.surfaceRaw, map.physics, { sha256: map.meta.navigation.sha256,
  sourceHash: map.meta.sourceHash, collisionAsset: map.meta.assets.collision });
map.grid = live;
const real = { query(from, to) {
  const points = [], n = live.findPath(from, to, points);
  return { points: points.slice(0, n), outcome: live.lastOutcome, reason: live.lastReason };
} };
assert.equal(map.meta.navigation.sha256, '65a59e8c40622879272533a510ed296ae2436d693ecb31a75f16463a5616e4f1',
  're-measure recorded fixture outcomes after changing baked assets');
let arrivals = 0;
for (const c of map.cases) {
  const r = execute(map, real, c, true);
  if (c.recorded) {
    // Known follower defects remain explicit for #307. Improvements are allowed;
    // a previously successful arrival must never regress into a query-only pass.
    if (!r.arrived) assert.equal(r.status, c.expectedOutcome, `${c.name}: undocumented execution regression`);
    assert.ok(r.elapsed <= 240.05); assert.equal(r.recovery.length, 0, c.name);
    continue;
  }
  if (OBSTRUCTED_MAP_GOALS.includes(c.name)) assert.notEqual(r.initialOutcome, 'success', c.name);
  else { assert.ok(r.arrived, `${c.name}: ${r.status}`); arrivals++; }
  assert.equal(r.recovery.length, 0, `${c.name}: recovery is not traversal`);
}
assert.equal(arrivals, 19);
live.dispose();
console.log('ok  surface nav: physical multilayer traversal, fail-closed assets, bounded/fair queries, cached attachments, floor-owned cover');
