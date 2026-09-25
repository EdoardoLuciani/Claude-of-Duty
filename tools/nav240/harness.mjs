import * as THREE from 'three';
import { Agent, STATE } from '../../src/ai/agent.js';
import { PROFILE } from './fixtures.mjs';

export function legacy(grid) {
  return {
    name: 'legacy',
    query(from, to) {
      const points = [];
      const n = grid.findPath(from, to, points);
      return { outcome: n ? 'success' : 'unreachable', points: points.slice(0, n) };
    },
  };
}

// A narrow, collision-executed endpoint attachment check, shared by prototypes.
// This is deliberately measured as query work, not hidden in a bake metric.
export function canConnect(physics, from, to) {
  const c = physics.createCharacter({ radius: PROFILE.radius, height: PROFILE.height,
    stepHeight: PROFILE.step, slopeLimit: PROFILE.slope * Math.PI / 180, position: from });
  c.probeGround();
  let vy = 0;
  let ok = false;
  const frames = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 1.5 * 60) + 20;
  for (let i = 0; i < frames; i++) {
    const dx = to.x - c.position.x, dz = to.z - c.position.z, d = Math.hypot(dx, dz);
    if (d < 0.12 && Math.abs(to.y - c.position.y) < 0.18) { ok = true; break; }
    const step = Math.min(d, 1.5 / 60);
    vy += physics.gravity / 60;
    c.move(d ? dx / d * step : 0, vy / 60, d ? dz / d * step : 0);
    if (c.grounded) vy = 0;
  }
  physics.removeCharacter(c);
  return ok;
}

export function makeWalker(fixture, candidate, from, id = 1, corrected = false) {
  const physics = fixture.physics;
  const scale = corrected ? 1.025 : 1;
  const radius = 0.34 * scale, height = 1.78 * scale;
  const ai = { agents: [], grid: fixture.grid, _pathBudget: 2, deferred: 0 };
  ai.requestPath = (start, to, out) => {
    if (ai._pathBudget <= 0) { ai.lastPathOutcome = 'deferred'; ai.deferred++; return -1; }
    ai._pathBudget--;
    const result = candidate.query(start, to);
    ai.lastPathOutcome = result.outcome;
    ai.lastPathResFloor = result.points.at(-1)?.y ?? NaN;
    for (let i = 0; i < result.points.length; i++) (out[i] ??= new THREE.Vector3()).copy(result.points[i]);
    return result.points.length;
  };
  // Real Agent movement/navigation methods; omit only rendering, senses and gun.
  const a = Object.assign(Object.create(Agent.prototype), {
    id, ai, phys: physics, alive: true, state: STATE.COMBAT, stateTime: 0,
    position: from.clone(), velocity: new THREE.Vector3(), scale, radius, height,
    controller: physics.createCharacter({ radius, height, position: from, stepHeight: 0.42,
      slopeLimit: corrected ? 48 * Math.PI / 180 : 48 }),
    animator: { turn() {} },
    yaw: 0, targetYaw: 0, lastKnownAge: Infinity, hasTarget: false,
    crouch: false, suppression: 0, desiredSpeed: 1.5, speed: 0,
    grounded: true, vaultCooldown: 0, stuckTimer: 0, stuckHits: 0,
    noProgressTime: 0, _progressPos: from.clone(),
    path: [], pathLen: 0, pathIndex: 0, hasMoveTarget: false, pathPending: false,
    moveTarget: from.clone(), _pendingDest: from.clone(),
    _v: new THREE.Vector3(), _v2: new THREE.Vector3(), _v3: new THREE.Vector3(),
    _steer: new THREE.Vector3(), recoveries: [],
  });
  const snap = a._snapUnstuck;
  a._snapUnstuck = function (p) {
    this.recoveries.push({ from: this.position.toArray(), to: p.toArray() });
    snap.call(this, p);
  };
  ai.agents.push(a);
  return a;
}

export function execute(fixture, candidate, sample, corrected = false) {
  const a = makeWalker(fixture, candidate, sample.from, sample.recorded ?? 1, corrected);
  a._goTo(sample.to);
  const initialOutcome = a.pathOutcome;
  const initialPath = a.path.slice(0, a.pathLen).map(p => p.toArray());
  let elapsed = 0, maxStall = 0, stall = 0, maxJump = 0;
  const progressPos = a.position.clone(), prev = a.position.clone();
  const trace = [a.position.toArray()];
  let pathDistance = 0, anchor = sample.from;
  for (const p of a.path.slice(0, a.pathLen)) { pathDistance += anchor.distanceTo(p); anchor = p; }
  const seconds = Math.min(240, Math.max(15, pathDistance / 1.5 * 1.6 + 8));
  for (; elapsed < seconds && a.hasMoveTarget; elapsed += 1 / 60) {
    a.ai._pathBudget = 2;
    if (a.pathPending) a._goTo(a._pendingDest);
    prev.copy(a.position);
    a._move(1 / 60);
    a._tickNoProgress(1 / 60);
    maxJump = Math.max(maxJump, prev.distanceTo(a.position));
    if (a.position.distanceTo(progressPos) >= 0.5) { stall = 0; progressPos.copy(a.position); }
    else { stall += 1 / 60; maxStall = Math.max(maxStall, stall); }
    if (Math.round(elapsed * 60) % 12 === 0) trace.push(a.position.toArray());
    if (a.recoveries.length) break; // never credit emergency repositioning as traversal
  }
  const horizontalError = Math.hypot(a.position.x - sample.to.x, a.position.z - sample.to.z);
  const floorError = Math.abs(a.position.y - sample.to.y);
  const alreadyAtGoal = Math.hypot(sample.from.x - sample.to.x, sample.from.z - sample.to.z) <= 0.5
    && Math.abs(sample.from.y - sample.to.y) <= 0.18;
  const arrived = initialOutcome === 'success' && !a.recoveries.length && horizontalError <= 0.5 && floorError <= 0.18;
  const result = { name: sample.name, initialOutcome, finalOutcome: a.pathOutcome, arrived,
    status: alreadyAtGoal ? 'already-at-goal' : arrived ? 'arrived' : a.recoveries.length ? 'recovery' : initialOutcome !== 'success' ? initialOutcome
      : maxStall >= 3 ? 'stalled' : a.hasMoveTarget ? 'timeout-progress' : a.pathOutcome !== 'success' ? 'execution-failure' : 'wrong-arrival',
    elapsed, pathDistance, horizontalError, floorError, maxStall, maxJump,
    end: a.position.toArray(), recovery: a.recoveries, initialPath, trace };
  fixture.physics.removeCharacter(a.controller);
  return result;
}

export function budgetRun(fixture, candidate, cases, corrected) {
  const walkers = cases.map((s, i) => makeWalker(fixture, candidate, s.from, i + 1, corrected));
  const ai = walkers[0].ai;
  ai.agents = walkers;
  for (const a of walkers) a.ai = ai;
  const frames = [], firstService = new Array(walkers.length).fill(null);
  let frameSolves = 0, maxSolves = 0, totalSolves = 0;
  const request = ai.requestPath;
  ai.requestPath = (...args) => {
    const n = request(...args);
    if (n >= 0) { frameSolves++; totalSolves++; }
    return n;
  };
  for (let f = 0; f < 600; f++) {
    ai._pathBudget = 2; frameSolves = 0;
    const t = performance.now();
    for (let i = 0; i < walkers.length; i++) {
      const a = walkers[i];
      // Five synchronized request bursts exercise sustained service, not just boot.
      if (f % 120 === 0 || a.pathPending) a._goTo(cases[i].to);
      if (firstService[i] === null && a.pathOutcome !== 'deferred') firstService[i] = f;
      if (!a.recoveries.length) { a._move(1 / 60); a._tickNoProgress(1 / 60); }
    }
    frames.push(performance.now() - t);
    maxSolves = Math.max(maxSolves, frameSolves);
  }
  const progress = walkers.map((a, i) => ({ distance: a.position.distanceTo(cases[i].from), recovery: a.recoveries.length }));
  for (const a of walkers) fixture.physics.removeCharacter(a.controller);
  return { agents: cases.map(c => c.name), firstService, deferred: ai.deferred, maxSolves, totalSolves,
    frameMs: distribution(frames), progress };
}
export function distribution(values) {
  const a = values.slice().sort((x, y) => x - y);
  return { p50: a[Math.floor(a.length * 0.5)], p95: a[Math.floor(a.length * 0.95)], max: a.at(-1) };
}
