/**
 * Headless regressions for issue 268: evidence ordering and bounded search.
 *
 *   node tools/smoke-ai-search.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AiSystem } from '../src/ai/index.js';
import {
  Agent, STATE, EVIDENCE, EVIDENCE_TTL, VISUAL_LOCK, SOUND_ERROR,
  SEARCH_RADIUS, SEARCH_CANDIDATES, SEARCH_DURATION,
} from '../src/ai/agent.js';
import { Squad } from '../src/ai/squad.js';
import { NavGrid } from '../src/ai/nav.js';

function makeRng(seed = 0.31) {
  let x = seed;
  return {
    float() { x = (x * 1.7 + 0.13) % 1; return x; },
    range(a, b) { return a + (b - a) * this.float(); },
    int(a) { return a; },
    gauss() { return 0; },
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

function makeSearchAgent(over = {}) {
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
    weaponRange: 80, radius: 0.34, eyeHeight: 1.5,
    viewRange: 80, viewCos: Math.cos((100 * Math.PI) / 180 / 2),
    suppression: 0, squad: null, rng, ai, patrolPoints: null, cover: null, repathTimer: 5,
    phys: { lineOfSight: () => true, MASK: { SIGHT: 1 } },
    animator: { turn() {} },
    _v: new THREE.Vector3(), _v2: new THREE.Vector3(), _v3: new THREE.Vector3(),
    _eye: new THREE.Vector3(), _dir: new THREE.Vector3(),
  }, over);
  if (!ai.agents.includes(a)) ai.agents.push(a);
  return a;
}

function pump(a, dt = 1 / 60) {
  if (a.ai) a.ai._pathBudget = a.ai.pathsPerFrame ?? 2;
  if (a.lastKnownAge < 1e6) a.lastKnownAge += dt;
  a.stateTime += dt;
  if (a.pathPending) a._goTo(a._pendingDest);
  a._think(dt);
  a._move(dt);
}

const origin = new THREE.Vector3(1, 0, 1);
const seen = new THREE.Vector3(1, 0, 8);
const hidden = new THREE.Vector3(10, 0, 1);

/* ---- evidence ordering --------------------------------------------------- */
{
  const a = makeSearchAgent();
  assert.equal(a._noteEvidence(seen, EVIDENCE.VISUAL, 0), true);
  assert.equal(a.lastKnownKind, EVIDENCE.VISUAL);
  a.lastKnownAge = 0.4;
  assert.equal(a._noteEvidence(hidden, EVIDENCE.SOUND, 0), false, 'fresh visual beats sound');
  assert.ok(a.lastKnown.distanceTo(seen) < 1e-6);
  assert.equal(a.lastKnownKind, EVIDENCE.VISUAL);

  a.lastKnownAge = VISUAL_LOCK + 0.2;
  assert.equal(a._noteEvidence(hidden, EVIDENCE.SOUND, 0), true, 'expired visual lock yields');
  assert.equal(a.lastKnownKind, EVIDENCE.SOUND);
  assert.ok(a.lastKnown.distanceTo(hidden) < 1e-6);

  const b = makeSearchAgent();
  b._noteEvidence(seen, EVIDENCE.VISUAL, 0);
  b.lastKnownAge = 0.3;
  assert.equal(b._noteEvidence(hidden, EVIDENCE.FIRE, 0.4), false, 'older fire cannot replace visual');
  assert.equal(b.lastKnownKind, EVIDENCE.VISUAL);
}

/* ---- sound is uncertain, never a visual target --------------------------- */
{
  const a = makeSearchAgent({ position: origin.clone() });
  a.hear(new THREE.Vector3(10, 0, 0), 20);
  assert.equal(a.hasTarget, false);
  assert.equal(a.lastKnownKind, EVIDENCE.SOUND);
  assert.ok(a.lastKnown.distanceTo(new THREE.Vector3(10, 0, 0)) > 0.2, 'sound must not copy the event');
  assert.ok(a.lastKnown.distanceTo(new THREE.Vector3(10, 0, 0)) <= SOUND_ERROR + 0.01);
  assert.equal(a.state, STATE.ALERT);
  a._think(0.05);
  assert.equal(a.wantFire, false);
  assert.equal(a.hasTarget, false);
}

/* ---- reports preserve age and cannot renew ------------------------------- */
{
  const rng = makeRng(0.4);
  const sq = new Squad(rng);
  const seer = makeSearchAgent({
    hasTarget: true, targetVisible: true, state: STATE.COMBAT,
    lastKnown: seen.clone(), lastKnownAge: 0, lastKnownKind: EVIDENCE.VISUAL,
  });
  const mate = makeSearchAgent({ state: STATE.IDLE, lastKnownAge: Infinity });
  sq.add(seer);
  sq.add(mate);
  sq.update(0.05);
  assert.equal(mate.lastKnownKind, EVIDENCE.REPORT);
  assert.ok(mate.lastKnown.distanceTo(seen) < 1e-6);
  assert.ok(mate.lastKnownAge < 0.2, `first share keeps observation age, got ${mate.lastKnownAge}`);
  assert.equal(mate.state, STATE.ALERT);
  assert.equal(mate.hasTarget, false);
  const age0 = mate.lastKnownAge;
  const until0 = mate._searchUntil;
  for (let i = 0; i < 40; i++) {
    mate.lastKnownAge += 0.1;
    seer.lastKnownAge = 0;
    seer.hasTarget = true;
    seer.targetVisible = true;
    sq.update(0.1);
  }
  assert.ok(mate.lastKnownAge >= age0 + 3.9, 'repeated shares must not rejuvenate');
  assert.equal(mate._searchUntil, until0, 'repeated shares must not extend search');
  assert.equal(mate.hasTarget, false);

  mate.stateTime = SEARCH_DURATION + 0.2;
  mate._think(0.05);
  assert.equal(mate.state, STATE.IDLE);
  assert.equal(mate._searchUntil, 0);
  const idleAge = mate.lastKnownAge;
  sq.update(0.05);
  assert.equal(mate.state, STATE.IDLE, 'unexpired leftover report must not re-alert');
  assert.equal(mate._searchUntil, 0);
  assert.ok(mate.lastKnownAge >= idleAge);
}

/* ---- candidate / deadline limits ----------------------------------------- */
{
  const a = makeSearchAgent({ position: origin.clone() });
  a._noteEvidence(seen, EVIDENCE.VISUAL, 0);
  a._setState(STATE.ALERT);
  assert.ok(a._searchUntil > 0);
  assert.ok(a._searchCount >= 1 && a._searchCount <= SEARCH_CANDIDATES);
  const until = a._searchUntil;
  assert.equal(until, SEARCH_DURATION);

  // skip a candidate without resetting the deadline
  a._searchDwell = 0;
  a.hasMoveTarget = false;
  a.pathPending = false;
  const idx = a._searchIndex;
  a._goTo = function () {
    this.pathPending = false;
    this.hasMoveTarget = false;
    return false;
  };
  a._tickSearch(0.05);
  assert.ok(a._searchIndex >= idx);
  assert.equal(a._searchUntil, until);
}

/* ---- cancellation -------------------------------------------------------- */
{
  const a = makeSearchAgent({ position: origin.clone() });
  a._noteEvidence(seen, EVIDENCE.VISUAL, 0);
  a._setState(STATE.ALERT);
  assert.ok(a._searchUntil > 0);
  a._setState(STATE.COMBAT);
  assert.equal(a._searchUntil, 0, 'combat cancels search');
  assert.equal(a.wantFire, false);

  a._setState(STATE.ALERT);
  assert.ok(a._searchUntil > 0);
  a.colliders = [];
  a.group = { parent: null };
  a.ragdoll = null;
  a.controller = null;
  a.phys = null;
  a.dispose();
  assert.equal(a._searchUntil, 0, 'dispose cancels search');
}

/* ---- no stale firing from sound or search -------------------------------- */
{
  const a = makeSearchAgent({
    state: STATE.COMBAT, stateTime: 2, hasTarget: true, targetVisible: false,
    lastKnown: seen.clone(), lastKnownKind: EVIDENCE.SOUND, lastKnownAge: 0.2,
    cover: null,
  });
  a._combat(0.05);
  assert.equal(a.wantFire, false, 'sound evidence must not grant aimed fire');

  const v = makeSearchAgent({
    state: STATE.COMBAT, stateTime: 2, hasTarget: true, targetVisible: false,
    lastKnown: seen.clone(), lastKnownKind: EVIDENCE.VISUAL, lastKnownAge: 0.2,
    cover: null,
  });
  v._combat(0.05);
  assert.equal(v.wantFire, true, 'fresh visual memory may still suppress');

  const s = makeSearchAgent({ position: origin.clone(), wantFire: true });
  s._noteEvidence(seen, EVIDENCE.VISUAL, 0);
  s._setState(STATE.ALERT);
  s._think(0.05);
  assert.equal(s.wantFire, false);
  assert.equal(s.state, STATE.ALERT);
}

/* ---- in-world: relocate unseen, destinations stay on old evidence -------- */
{
  const grid = makeGrid();
  const ai = makeAi(grid);
  const a = makeSearchAgent({
    ai, position: origin.clone(), yaw: 0,
  });
  a._noteEvidence(seen, EVIDENCE.VISUAL, 0);
  a._setState(STATE.ALERT);
  assert.ok(a._searchUntil > 0);

  const dests = [];
  const visited = [];
  let lastIdx = -1;
  let fired = 0;
  let frames = 0;
  let maxFramePaths = 0;
  const origPath = AiSystem.prototype.requestPath.bind(ai);
  ai.requestPath = function (from, dest, out) {
    this._framePaths = (this._framePaths ?? 0) + 1;
    return origPath(from, dest, out);
  };

  for (let i = 0; i < 900; i++) {
    ai._framePaths = 0;
    pump(a);
    frames++;
    maxFramePaths = Math.max(maxFramePaths, ai._framePaths ?? 0);
    if (a.wantFire) fired++;
    if (a.hasMoveTarget) dests.push(a.moveTarget.clone());
    dests.push(a.searchPoint.clone());
    if (a._searchUntil > 0 && a._searchIndex !== lastIdx) {
      lastIdx = a._searchIndex;
      visited.push(a.searchPoint.clone());
    }
    if (a.state === STATE.IDLE || a.state === STATE.PATROL) break;
  }

  assert.ok(frames > 10, 'search should run for a while');
  assert.ok(a.state === STATE.IDLE || a.state === STATE.PATROL, `ended in ${a.state}`);
  assert.equal(a._searchUntil, 0);
  assert.equal(fired, 0, 'search must not fire');
  assert.ok(visited.length <= SEARCH_CANDIDATES, `visited ${visited.length}`);
  assert.ok(maxFramePaths <= 2, `pathsPerFrame=2, saw ${maxFramePaths} in one frame`);
  for (const d of dests) {
    assert.ok(d.distanceTo(hidden) > 4, `tracked unseen relocate to ${d.x.toFixed(1)},${d.z.toFixed(1)}`);
    assert.ok(
      d.distanceTo(seen) < SEARCH_RADIUS + 4,
      `search dest ${d.x.toFixed(1)},${d.z.toFixed(1)} left the evidence area`,
    );
  }
}

/* ---- genuine reacquisition returns to combat ----------------------------- */
{
  const grid = makeGrid();
  const ai = makeAi(grid);
  const a = makeSearchAgent({ ai, position: origin.clone(), yaw: 0 });
  a._noteEvidence(seen, EVIDENCE.VISUAL, 0);
  a._setState(STATE.ALERT);
  assert.equal(a.state, STATE.ALERT);
  ai.playerPosition = (out) => out.copy(seen);
  a.awareness = 1;
  a._sense(0.2);
  assert.equal(a.hasTarget, true);
  assert.equal(a.lastKnownKind, EVIDENCE.VISUAL);
  a._think(0.05);
  assert.equal(a.state, STATE.COMBAT);
  assert.equal(a._searchUntil, 0);
}

/* ---- unreachable candidates skip without flooding or looping ------------- */
{
  const grid = makeGrid();
  grid.flags.fill(0);
  grid.flags[grid.index(0, 0)] = 1;
  grid.flags[grid.index(10, 10)] = 1;
  const ai = makeAi(grid);
  let paths = 0;
  const origPath = AiSystem.prototype.requestPath.bind(ai);
  ai.requestPath = function (from, dest, out) {
    paths++;
    return origPath(from, dest, out);
  };
  const a = makeSearchAgent({
    ai, position: new THREE.Vector3(0, 0, 0),
  });
  a._noteEvidence(new THREE.Vector3(10, 0, 10), EVIDENCE.VISUAL, 0);
  a._setState(STATE.ALERT);
  for (let i = 0; i < 30; i++) pump(a);
  assert.ok(a.state === STATE.IDLE || a.state === STATE.PATROL, `ended in ${a.state}`);
  assert.equal(a._searchUntil, 0);
  assert.ok(paths < 16, `unreachable flooded paths (${paths})`);
  assert.ok(ai.stats.pathsDeferred < 12, `deferred ${ai.stats.pathsDeferred}`);
}

/* ---- new sound may redirect; reports do not extend ----------------------- */
{
  const a = makeSearchAgent({ position: origin.clone() });
  a._noteEvidence(seen, EVIDENCE.VISUAL, 0);
  a._setState(STATE.ALERT);
  a.stateTime = 4;
  a.lastKnownAge = VISUAL_LOCK + 0.3;
  const until = a._searchUntil;
  a.hear(new THREE.Vector3(8, 0, 2), 40);
  assert.equal(a.lastKnownKind, EVIDENCE.SOUND);
  assert.ok(a._searchUntil >= until, 'fresh sound may keep/extend the clock');
  const afterSound = a._searchUntil;
  assert.equal(a._noteEvidence(hidden, EVIDENCE.REPORT, 0), false);
  assert.equal(a._searchUntil, afterSound, 'report must not extend search');
}

/* ---- expired evidence does not start a search ---------------------------- */
{
  const a = makeSearchAgent({ lastKnownAge: EVIDENCE_TTL, lastKnownKind: EVIDENCE.VISUAL });
  a.lastKnown.copy(seen);
  a._setState(STATE.ALERT);
  assert.equal(a._searchUntil, 0);
  assert.equal(a.state, STATE.ALERT);
  a.stateTime = 13;
  a._think(0.05);
  assert.equal(a.state, STATE.IDLE);
}

console.log('ok  smoke-ai-search');
