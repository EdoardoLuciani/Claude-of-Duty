/**
 * Headless regressions for issue 274: patrol/search recovery after route failure.
 *
 *   node tools/smoke-ai-patrol.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AiSystem } from '../src/ai/index.js';
import {
  Agent, STATE, PATH_OUTCOME, EVIDENCE, SEARCH_DURATION,
} from '../src/ai/agent.js';
import { NavGrid, unpackNav } from '../src/ai/nav.js';

function makeRng(seed = 0.31) {
  let x = seed;
  return {
    float() { x = (x * 1.7 + 0.13) % 1; return x; },
    range(a, b) { return a + (b - a) * this.float(); },
    int(a) { return a; },
    gauss() { return 0; },
    signed() { return this.float() * 2 - 1; },
    fork() { return makeRng(this.float()); },
  };
}

function makeGrid(nx = 12, nz = 12, cell = 1) {
  const g = new NavGrid({}, {
    cell, radius: 0.36,
    bounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: nx * cell - 0.1, y: 2, z: nz * cell - 0.1 },
    },
  });
  g.flags.fill(1);
  g.floor.fill(0);
  return g;
}

function makeAi(grid = null) {
  const ai = Object.create(AiSystem.prototype);
  ai.grid = grid;
  ai.pathsPerFrame = 2;
  ai._pathBudget = 2;
  ai.stats = { pathsDeferred: 0, grenadeHolds: 0 };
  ai.cover = null;
  ai.agents = [];
  return ai;
}

function makeAgent(over = {}) {
  const rng = over.rng ?? makeRng();
  const ai = over.ai ?? makeAi(null);
  const a = Object.create(Agent.prototype);
  Object.assign(a, {
    id: 1, alive: true, state: STATE.IDLE, stateTime: 0,
    hasTarget: false, targetVisible: false, awareness: 0, alertness: 0,
    lastKnown: new THREE.Vector3(), lastKnownAge: Infinity, lastKnownKind: null,
    position: new THREE.Vector3(),
    searchPoint: new THREE.Vector3(),
    _searchCand: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
    _searchCount: 0, _searchIndex: 0, _searchDwell: 0, _searchUntil: 0,
    wantFire: false, crouch: false, desiredSpeed: 0, speed: 0,
    hasMoveTarget: false, pathPending: false, path: [], pathLen: 0, pathIndex: 0,
    moveTarget: new THREE.Vector3(), _pendingDest: new THREE.Vector3(),
    yaw: 0, targetYaw: 0, velocity: new THREE.Vector3(), _steer: new THREE.Vector3(),
    controller: null, grounded: true, vaultCooldown: 0, stuckTimer: 0, stuckHits: 0,
    noProgressTime: 0, _progressPos: new THREE.Vector3(),
    _failWait: 0, _failStreak: 0, _holdMove: false,
    pathOutcome: null, pathObjective: null,
    weaponRange: 80, radius: 0.34, eyeHeight: 1.5,
    viewRange: 80, viewCos: Math.cos((100 * Math.PI) / 180 / 2),
    suppression: 0, squad: null, rng, ai, patrolPoints: null, patrolIndex: 0,
    cover: null, repathTimer: 5,
    phys: { lineOfSight: () => true, MASK: { SIGHT: 1 } },
    animator: { turn() {} },
    _v: new THREE.Vector3(), _v2: new THREE.Vector3(), _v3: new THREE.Vector3(),
    _eye: new THREE.Vector3(), _dir: new THREE.Vector3(),
  }, over);
  if (!ai.agents.includes(a)) ai.agents.push(a);
  return a;
}

function pump(agents, dt = 1 / 20) {
  const list = Array.isArray(agents) ? agents : [agents];
  const ai = list[0].ai;
  if (ai) ai._pathBudget = ai.pathsPerFrame ?? 2;
  for (const a of list) {
    if (a.lastKnownAge < 1e6) a.lastKnownAge += dt;
    a.stateTime += dt;
    if (a.pathPending) a._goTo(a._pendingDest);
    a._think(dt);
    a._move(dt);
    a._tickNoProgress(dt);
  }
}

function countPaths(ai, fn) {
  let total = 0;
  let maxFrame = 0;
  const orig = AiSystem.prototype.requestPath.bind(ai);
  ai.requestPath = function (from, dest, out) {
    total++;
    const n = orig(from, dest, out);
    if (n >= 0) this._frameSolves = (this._frameSolves ?? 0) + 1;
    return n;
  };
  fn((dt) => {
    ai._frameSolves = 0;
    pump(ai.agents.length ? ai.agents : [], dt);
    maxFrame = Math.max(maxFrame, ai._frameSolves ?? 0);
  });
  return { total, maxFrame, deferred: ai.stats.pathsDeferred };
}

/* ---- invalid / disconnected goals: skip, back off, hold ---------------- */
{
  const grid = makeGrid();
  grid.flags.fill(0);
  grid.flags[grid.index(0, 0)] = 1;
  grid.flags[grid.index(10, 10)] = 1;
  const ai = makeAi(grid);
  ai.pathsPerFrame = 2;
  const a = makeAgent({
    ai, id: 1,
    position: new THREE.Vector3(0, 0, 0),
    state: STATE.PATROL,
    patrolPoints: [
      new THREE.Vector3(10, 0, 10),
      new THREE.Vector3(10, 0, 9),
    ],
  });
  let held = false;
  const { total, maxFrame } = countPaths(ai, (step) => {
    for (let i = 0; i < 80; i++) {
      step();
      if (a._holdMove) held = true;
    }
  });
  assert.ok(maxFrame <= 2, `disconnected flooded a frame (${maxFrame})`);
  assert.ok(total < 24, `disconnected hammered paths (${total})`);
  assert.equal(held, true, 'disconnected patrol must enter a hold');
  assert.ok(
    a.pathOutcome === PATH_OUTCOME.UNREACHABLE || a.pathOutcome === PATH_OUTCOME.INVALID,
    `expected bounded failure, got ${a.pathOutcome}`,
  );
  assert.equal(a.hasMoveTarget, false);
  assert.ok(a.desiredSpeed < 0.2, 'hold must not keep a move request');
  assert.ok(a.position.length() < 0.5, 'hold must not teleport');
  assert.equal(a.alive, true);
  assert.equal(a.state, STATE.PATROL);
}

/* ---- valid patrol actually moves --------------------------------------- */
{
  const grid = makeGrid();
  const ai = makeAi(grid);
  const a = makeAgent({
    ai, id: 2,
    position: new THREE.Vector3(1, 0, 1),
    state: STATE.PATROL,
    patrolPoints: [new THREE.Vector3(8, 0, 8)],
  });
  const start = a.position.clone();
  for (let i = 0; i < 80; i++) pump(a);
  assert.ok(a.position.distanceTo(start) > 2, `valid patrol did not move (${a.position.distanceTo(start).toFixed(2)})`);
  assert.equal(a.pathOutcome, PATH_OUTCOME.SUCCESS);
  assert.ok(a.hasMoveTarget || a.position.distanceTo(new THREE.Vector3(8, 0, 8)) < 2);

  // arrived at the only endpoint: stop spending the budget so others can move
  const late = makeAgent({
    ai, id: 12,
    position: new THREE.Vector3(2, 0, 2),
    state: STATE.PATROL,
    patrolPoints: [new THREE.Vector3(9, 0, 3)],
  });
  const lateStart = late.position.clone();
  const after = countPaths(ai, (step) => {
    for (let i = 0; i < 80; i++) step();
  });
  assert.ok(after.maxFrame <= 2, `post-arrival spilled budget (${after.maxFrame})`);
  assert.ok(after.total < 90, `arrived patrol still hammered paths (${after.total})`);
  assert.ok(
    late.position.distanceTo(lateStart) > 1,
    `late agent starved (${late.position.distanceTo(lateStart).toFixed(2)} m, solves=${after.total})`,
  );
}

/* ---- deferred requests do not count as failure; budget is shared ------- */
{
  const grid = makeGrid();
  const ai = makeAi(grid);
  ai.pathsPerFrame = 2;
  const agents = [0, 1, 2].map((id) => makeAgent({
    ai, id: id + 1,
    position: new THREE.Vector3(1 + id, 0, 1),
    state: STATE.PATROL,
    patrolPoints: [new THREE.Vector3(8, 0, 8)],
  }));
  let pendingSeen = 0;
  const starts = agents.map((a) => a.position.clone());
  const { maxFrame, deferred } = countPaths(ai, (step) => {
    for (let i = 0; i < 40; i++) {
      step();
      if (agents.some((a) => a.pathPending)) pendingSeen++;
    }
  });
  assert.ok(maxFrame <= 2, `shared budget spilled (${maxFrame})`);
  assert.ok(deferred >= 1 || pendingSeen >= 1, 'three agents must defer under pathsPerFrame=2');
  for (const a of agents) {
    assert.ok(
      a.pathOutcome !== PATH_OUTCOME.UNREACHABLE,
      `deferred treated as unreachable for ${a.id}`,
    );
    assert.ok(
      a.position.distanceTo(starts[a.id - 1]) > 1 || a.hasMoveTarget || a.pathPending,
      `agent ${a.id} neither moved nor kept a live path`,
    );
  }
}

/* ---- exhausted search then failing patrol does not loop-flood ---------- */
{
  const grid = makeGrid();
  grid.flags.fill(0);
  grid.flags[grid.index(0, 0)] = 1;
  grid.flags[grid.index(10, 10)] = 1;
  const ai = makeAi(grid);
  const a = makeAgent({
    ai, id: 4,
    position: new THREE.Vector3(0, 0, 0),
    patrolPoints: [new THREE.Vector3(10, 0, 10)],
  });
  a._noteEvidence(new THREE.Vector3(10, 0, 10), EVIDENCE.VISUAL, 0);
  a._setState(STATE.ALERT);
  let held = false;
  const { total, maxFrame } = countPaths(ai, (step) => {
    for (let i = 0; i < 200; i++) {
      step();
      if (a._holdMove) held = true;
    }
  });
  assert.ok(a.state === STATE.PATROL || a.state === STATE.IDLE, `ended in ${a.state}`);
  assert.equal(a._searchUntil, 0);
  assert.ok(maxFrame <= 2, `search+patrol spilled budget (${maxFrame})`);
  assert.ok(total < 40, `search then patrol flooded (${total})`);
  if (a.state === STATE.PATROL) assert.equal(held, true);
  assert.equal(a.wantFire, false);
  assert.ok(a.stateTime < SEARCH_DURATION + 8);
}

/* ---- spawn-to-patrol validation: capsule is not enough ----------------- */
{
  const grid = makeGrid();
  grid.flags.fill(0);
  grid.flags[grid.index(0, 0)] = 1;
  grid.flags[grid.index(10, 10)] = 1;
  const ai = makeAi(grid);
  const island = { position: new THREE.Vector3(0, 0, 0), yaw: 0 };
  const far = { position: new THREE.Vector3(10, 0, 10), yaw: 0 };
  Object.assign(ai, {
    ctx: { peek: () => ({ spawnPoints: [island, far] }) },
    _phys: {
      checkCapsule: () => true,
      groundHeight: () => 0,
      MASK: { CHARACTER: 1 },
    },
    rng: makeRng(0.2),
    agents: [],
    squads: [],
    _v: new THREE.Vector3(),
    _v2: new THREE.Vector3(),
    _v3: new THREE.Vector3(),
    playerPosition(out) { return out.set(80, 0, 80); },
    spawn(variant, p, yaw, opts) {
      const a = { position: p.clone(), patrolPoints: opts.patrol, variant, yaw };
      this.agents.push(a);
      return a;
    },
    createSquad() { return { add() {}, members: [] }; },
  });
  const made = AiSystem.prototype.populate.call(ai, { squads: 1, perSquad: 2 });
  assert.equal(made, 0, 'disconnected capsule spawn must not count as a patrol route');

  grid.flags.fill(1);
  ai.agents.length = 0;
  const madeOk = AiSystem.prototype.populate.call(ai, { squads: 1, perSquad: 2 });
  assert.ok(madeOk > 0, 'connected spawn+route must still populate');
  for (const a of ai.agents) {
    assert.ok(a.patrolPoints?.length >= 1, 'usable route must keep at least one end');
  }
}

/* ---- missing same-floor start is invalid, not a roof path -------------- */
{
  const grid = makeGrid(20, 20);
  grid.floor.fill(3);
  for (let x = 0; x < 20; x++) {
    for (let z = 0; z < 20; z++) {
      const ring = Math.max(x, z);
      if (ring > 8) grid.floor[grid.index(x, z)] = Math.max(0, 3 - (ring - 8) * 0.4);
    }
  }
  const ai = makeAi(grid);
  const a = makeAgent({
    ai, id: 11,
    position: new THREE.Vector3(1, 0, 1),
    state: STATE.PATROL,
    patrolPoints: [new THREE.Vector3(19, 0, 19)],
  });
  let req = 0;
  const orig = AiSystem.prototype.requestPath.bind(ai);
  ai.requestPath = function (from, dest, out) {
    req++;
    return orig(from, dest, out);
  };
  const ok = a._goTo(a.patrolPoints[0]);
  assert.equal(ok, false);
  assert.equal(a.pathOutcome, PATH_OUTCOME.INVALID);
  assert.equal(req, 0, `missing start still queried the solver (${req})`);
  assert.equal(a.hasMoveTarget, false);
}

/* ---- recorded survivor locations: move or a bounded failure ------------ */
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const meta = JSON.parse(readFileSync(join(root, 'public/models/world/level.json'), 'utf8'));
  const raw = gunzipSync(readFileSync(join(root, 'public/models/world', meta.assets.nav)));
  const bake = unpackNav(raw);
  const grid = new NavGrid({}, {
    bounds: {
      min: { x: bake.minX, y: 0, z: bake.minZ },
      max: { x: bake.minX + 1, y: 2, z: bake.minZ + 1 },
    },
  });
  grid.applyBake(bake);

  const patrol = meta.spawns.map((s) => new THREE.Vector3(s.position[0], s.position[1], s.position[2]));
  const recorded = [
    { id: 23, position: new THREE.Vector3(22.613, 0.423, 46.092) },
    { id: 25, position: new THREE.Vector3(21.923, 0.423, 45.061) },
    { id: 9, position: new THREE.Vector3(-24.006, 0.103, -30.405) },
  ];
  const ai = makeAi(grid);
  ai.pathsPerFrame = 2;
  const agents = recorded.map((r) => makeAgent({
    ai, id: r.id,
    position: r.position.clone(),
    state: STATE.PATROL,
    patrolPoints: patrol,
  }));
  const starts = agents.map((a) => a.position.clone());
  const { total, maxFrame } = countPaths(ai, (step) => {
    for (let i = 0; i < 120; i++) step(1 / 20);
  });
  assert.ok(maxFrame <= 2, `recorded positions spilled budget (${maxFrame})`);
  assert.ok(total < 160, `recorded positions hammered paths (${total})`);
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const moved = a.position.distanceTo(starts[i]);
    const failed = a._holdMove
      || a.pathOutcome === PATH_OUTCOME.UNREACHABLE
      || a.pathOutcome === PATH_OUTCOME.INVALID;
    assert.ok(
      moved > 0.8 || (failed && !a.hasMoveTarget && a.desiredSpeed < 0.2),
      `survivor ${a.id} neither moved (${moved.toFixed(2)} m) nor held a bounded failure `
        + `(hold=${a._holdMove} outcome=${a.pathOutcome})`,
    );
    assert.equal(a.alive, true, `survivor ${a.id} must not be killed to recover`);
  }
}

console.log('ok  smoke-ai-patrol');
