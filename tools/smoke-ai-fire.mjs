/**
 * Headless regressions for issue 275.
 *
 * Combat fire must not stall forever on failed/deferred navigation or
 * cover waits. Assert shots and wait bounds, not just wantFire.
 *
 *   node tools/smoke-ai-fire.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AiSystem } from '../src/ai/index.js';
import {
  Agent, STATE, FIRE_BLOCK, PATH_OUTCOME,
  RELOCATE_GIVE_UP, PEEK_WAIT_GIVE_UP,
} from '../src/ai/agent.js';
import { Squad } from '../src/ai/squad.js';
import { COMBAT } from '../src/ai/tuning.js';

const DT = 1 / 60;
const rng = {
  float: () => 0.5, range: (a, b) => (a + b) * 0.5,
  int: (a) => a, gauss: () => 0,
};

function stubAgent(over = {}) {
  const a = Object.create(Agent.prototype);
  Object.assign(a, {
    id: 1, alive: true, state: STATE.COMBAT, stateTime: 2,
    hasTarget: true, targetVisible: true,
    lastKnown: new THREE.Vector3(0, 1.1, 0), lastKnownAge: 0.2,
    lastKnownKind: 'visual',
    position: new THREE.Vector3(0, 0, 10),
    yaw: Math.PI, targetYaw: Math.PI,
    cover: null, coverPos: new THREE.Vector3(), firePos: new THREE.Vector3(),
    peeking: false, _returning: false, _peekFail: 0, peekTimer: 9,
    wantFire: false, crouch: false, aimWeight: 1, desiredSpeed: 0, speed: 0,
    aimTarget: new THREE.Vector3(0, 1.1, 0),
    hasMoveTarget: false, pathPending: false, path: [], pathLen: 0, pathIndex: 0,
    moveTarget: new THREE.Vector3(),
    health: 100, weaponRange: COMBAT.viewRange, fireRate: COMBAT.fireRate,
    spread: 0, magSize: 30, ammo: 30,
    burstLeft: 0, fireCooldown: 0, burstCooldown: 0, suppression: 0,
    hasGrenade: false, grenadeCooldown: 99, role: 'pin', wrapWait: 0, _wrapDone: true,
    repathTimer: 5, eyeHeight: 1.62, squad: null, rng,
    _friendlyBlock: 0, _muzzleBlocked: false, fireBlock: null,
    _relocWait: 0, _peekWait: 0, _coverHold: 0, _pendingDest: new THREE.Vector3(),
    ctx: { time: { elapsed: 0, dt: DT, frame: 0 } },
    ai: {
      cover: { pick() { return null; }, release() {}, peekOffset(_c, _t, _e, out) { out.copy(a.coverPos); return 0; } },
      stats: { grenadeHolds: 0, friendlyHolds: 0, pathsDeferred: 0 },
      agents: [],
      onAgentFire() {},
      grid: null,
    },
    phys: { lineOfSight: () => true, raycast: () => ({ hit: false }), MASK: { SIGHT: 1, WORLD: 2 } },
    animator: {
      muzzleWorld: new THREE.Vector3(0.15, 1.42, 10),
      muzzleDir: new THREE.Vector3(0, 0, -1),
      reloading: false, vaulting: false, fire() {}, turn() {},
    },
    _v: new THREE.Vector3(), _v2: new THREE.Vector3(), _v3: new THREE.Vector3(),
    _eye: new THREE.Vector3(), _dir: new THREE.Vector3(), _muzzleDir: new THREE.Vector3(),
  }, over);
  if (over.cover) a.coverPos.set(over.cover.x, over.cover.y, over.cover.z);
  a.ai.agents = [a];
  return a;
}

function aimMuzzle(a) {
  const o = a.animator.muzzleWorld;
  o.set(a.position.x + 0.15, a.position.y + 1.42, a.position.z);
  a.animator.muzzleDir.copy(a.lastKnown).sub(o).normalize();
}

function attachShots(a) {
  const shots = [];
  a.ai.onAgentFire = (_agent, origin, dir) => {
    shots.push({ origin: origin.clone(), dir: dir.clone() });
  };
  return shots;
}

function tickAgent(a, dt = DT) {
  a.fireCooldown -= dt;
  a.burstCooldown -= dt;
  a.peekTimer -= dt;
  a.repathTimer -= dt;
  if (a.lastKnownAge < 1e6) a.lastKnownAge += dt;
  if (a.pathPending) a._goTo(a._pendingDest);
  a._think(dt);
  aimMuzzle(a);
  a._shoot(dt);
  a._updateFireBlock();
}

function tickStarved(a, dt = DT) {
  const ai = a.ai;
  ai._pathBudget = ai.pathsPerFrame;
  ai.requestPath({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, []);
  ai.requestPath({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }, []);
  tickAgent(a, dt);
}

function wirePath(a) {
  a.ai.grid = {
    findPath(_from, dest, out) {
      if (!out[0]) out[0] = new THREE.Vector3();
      out[0].copy(dest);
      return 1;
    },
    nearest() { return 0; },
    floor: [0],
  };
  a.ai.pathsPerFrame = 2;
  a.ai._pathBudget = 2;
  a.ai.requestPath = AiSystem.prototype.requestPath;
  a.ai.stats.pathsDeferred = 0;
}

function farCover(x = 8) {
  return { x, y: 0, z: 10, dx: 1, dz: 0, high: true };
}

function run(a, seconds, tick = tickAgent) {
  const shots = attachShots(a);
  let t = 0;
  while (t < seconds) {
    tick(a, DT);
    t += DT;
  }
  return { shots, t };
}

/* 1. clear shot */
{
  const a = stubAgent({ repathTimer: 9 });
  const shots = attachShots(a);
  tickAgent(a);
  assert.ok(shots.length >= 1, `clear shot never fired (block=${a.fireBlock})`);
  assert.notEqual(a.fireBlock, FIRE_BLOCK.RELOCATING);
}

/* 2. unreachable cover drops and fires */
{
  const a = stubAgent({ cover: farCover(), repathTimer: 9 });
  wirePath(a);
  a.ai.requestPath = function () {
    this.lastPathOutcome = PATH_OUTCOME.UNREACHABLE;
    return 0;
  };
  const shots = attachShots(a);
  a._goTo(a.coverPos);
  tickAgent(a);
  assert.equal(a.cover, null, 'unreachable cover must drop');
  assert.ok(shots.length >= 1, 'unreachable cover must still produce a shot');
}

/* 3. deferred navigation — hold, then bounded exposed fire */
{
  const a = stubAgent({ cover: farCover(), repathTimer: 9 });
  wirePath(a);
  a.ai._pathBudget = 0;
  a._goTo(a.coverPos);
  assert.equal(a.pathPending, true);
  assert.equal(a.hasMoveTarget, false);
  const shots = attachShots(a);
  let t = 0;
  while (t < RELOCATE_GIVE_UP - 2 * DT) {
    tickStarved(a);
    t += DT;
    assert.equal(shots.length, 0, `fired at t=${t.toFixed(3)} before the relocate bound`);
  }
  assert.equal(a.fireBlock, FIRE_BLOCK.RELOCATING);
  while (t < RELOCATE_GIVE_UP + 0.2 && shots.length === 0) {
    tickStarved(a);
    t += DT;
  }
  assert.ok(shots.length >= 1, `deferred nav never fell back (t=${t.toFixed(3)} block=${a.fireBlock})`);
  assert.ok(t < RELOCATE_GIVE_UP + 0.15, `fallback waited ${t.toFixed(3)}s`);
  assert.notEqual(a.fireBlock, FIRE_BLOCK.RELOCATING);
}

/* 4. walking relocate keeps the weapon down */
{
  const cover = farCover();
  const a = stubAgent({
    cover, repathTimer: 9, hasMoveTarget: true, desiredSpeed: 4.3, speed: 4.3,
  });
  a.moveTarget.copy(a.coverPos);
  a.path[0] = a.coverPos.clone();
  a.pathLen = 1;
  const { shots } = run(a, RELOCATE_GIVE_UP + 0.4);
  assert.equal(shots.length, 0, 'a walking relocate must keep the weapon down');
  assert.equal(a.fireBlock, FIRE_BLOCK.RELOCATING);
}

/* 5. two blocked peeks abandon, then a clear muzzle fires */
{
  const cover = { x: 0, y: 0, z: 10, dx: 0, dz: -1, high: false };
  const a = stubAgent({ cover, peekTimer: 0, repathTimer: 9 });
  a.firePos.set(0.95, 0, 10);
  a.ai.cover.peekOffset = (_c, _t, _e, out) => { out.set(0.95, 0, 10); return 1; };
  a.phys.lineOfSight = () => false;
  a._combat(DT);
  a.position.copy(a.firePos);
  a._combat(DT);
  assert.equal(a._returning, true);
  a.position.copy(a.coverPos);
  a._returning = false;
  a.peekTimer = 0;
  a._combat(DT);
  a.position.copy(a.firePos);
  a._combat(DT);
  assert.equal(a.cover, null, 'two blocked peeks abandon the point');
  a.phys.lineOfSight = () => true;
  a.peekTimer = 9;
  const shots = attachShots(a);
  tickAgent(a);
  assert.ok(shots.length >= 1, 'abandoned peek must still produce a shot');
}

/* 6. friendly obstruction */
{
  const a = stubAgent({ repathTimer: 9, burstLeft: 5 });
  a.ai.agents = [a, stubAgent({ id: 2, position: new THREE.Vector3(0, 0, 5) })];
  const shots = attachShots(a);
  aimMuzzle(a);
  a.wantFire = true;
  a._shoot(DT);
  a._updateFireBlock();
  assert.equal(shots.length, 0, 'must not shoot a teammate');
  assert.equal(a.fireBlock, FIRE_BLOCK.FRIENDLY);
}

/* 7. suppression and reload */
{
  const sup = stubAgent({ state: STATE.SUPPRESSED, suppression: 1.4 });
  const sShots = attachShots(sup);
  tickAgent(sup);
  assert.equal(sShots.length, 0);
  assert.equal(sup.fireBlock, FIRE_BLOCK.SUPPRESSED);

  const rel = stubAgent({ repathTimer: 9 });
  rel.animator.reloading = true;
  const rShots = attachShots(rel);
  rel.wantFire = true;
  rel._shoot(DT);
  rel._updateFireBlock();
  assert.equal(rShots.length, 0);
  assert.equal(rel.fireBlock, FIRE_BLOCK.RELOAD);
}

/* 8. eye LOS / barrel alignment must not authorize a shot through cover */
{
  const a = stubAgent({ repathTimer: 9, burstLeft: 8 });
  a.phys.lineOfSight = (from) => from.y >= 1.55;
  const shots = attachShots(a);
  a._think(DT);
  assert.equal(a.wantFire, true, 'eyes may still want the shot');
  a._shoot(DT);
  a._updateFireBlock();
  assert.equal(shots.length, 0, 'blocked muzzle must not fire');
  assert.equal(a.fireBlock, FIRE_BLOCK.MUZZLE);

  a.animator.muzzleDir.set(1, 0, 0);
  a.phys.lineOfSight = () => true;
  a.wantFire = true;
  a._muzzleBlocked = false;
  a._shoot(DT);
  a._updateFireBlock();
  assert.equal(shots.length, 0, 'misaligned barrel must not fire');
  assert.equal(a.fireBlock, FIRE_BLOCK.MUZZLE);
}

/* 9. wrap pending path gives up instead of mute-looping */
{
  const sq = new Squad(rng);
  sq.ai = { grid: null, cover: null };
  const a = stubAgent({
    role: 'wrap', _wrapDone: false, squad: sq, repathTimer: 9, cover: farCover(4),
  });
  sq.add(a);
  wirePath(a);
  sq.hasWrapDest = true;
  sq.wrapDest.set(20, 0, 20);
  const { shots } = run(a, RELOCATE_GIVE_UP + 0.2, tickStarved);
  assert.ok(shots.length >= 1, `wrap-pending never fell back (block=${a.fireBlock})`);
  assert.equal(a.role, 'hold');
}

/* 10. peek-wait with no one peeking recovers; a live token is expected delay */
{
  const cover = { x: 0, y: 0, z: 10, dx: 0, dz: -1, high: true };
  const a = stubAgent({ cover, peekTimer: 0.4, repathTimer: 9 });
  const sq = new Squad(rng);
  sq.ai = { grid: null, cover: null };
  sq.add(a);
  sq.requestPeek = () => false;
  const shots = attachShots(a);
  let t = 0;
  while (t < PEEK_WAIT_GIVE_UP - 2 * DT) {
    tickAgent(a);
    t += DT;
    assert.equal(shots.length, 0);
  }
  assert.equal(a.fireBlock, FIRE_BLOCK.PEEK_WAIT);
  while (t < PEEK_WAIT_GIVE_UP + 0.2 && shots.length === 0) {
    tickAgent(a);
    t += DT;
  }
  assert.ok(shots.length >= 1, `empty-token peek-wait never recovered (block=${a.fireBlock})`);

  const waiter = stubAgent({ id: 3, cover, peekTimer: 0.4, repathTimer: 9 });
  const sq2 = new Squad(rng);
  sq2.ai = { grid: null, cover: null };
  sq2.peekHolders.add(99);
  waiter.squad = sq2;
  sq2.members = [waiter];
  sq2.requestPeek = () => false;
  const { shots: wShots } = run(waiter, PEEK_WAIT_GIVE_UP + 0.3);
  assert.equal(wShots.length, 0, 'a live peek token is expected delay, not a fallback');
  assert.equal(waiter.fireBlock, FIRE_BLOCK.PEEK_WAIT);
}

/* 11. one leftover path slot must not cancel a successful wrap retry */
{
  const sq = new Squad(rng);
  sq.ai = { grid: null, cover: null };
  const a = stubAgent({
    role: 'wrap', _wrapDone: false, squad: sq, repathTimer: 9, cover: farCover(4),
    pathPending: true,
  });
  a._pendingDest.set(20, 0, 20);
  sq.add(a);
  wirePath(a);
  sq.hasWrapDest = true;
  sq.wrapDest.set(20, 0, 20);
  let kept = 0;
  for (let i = 0; i < 59; i++) {
    a.ai._pathBudget = 2;
    a.ai.requestPath({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, []);
    tickAgent(a);
    if (a.hasMoveTarget) kept++;
  }
  assert.equal(kept, 59, `1-slot wrap kept ${kept}/59 executable paths`);
}

/* 12. fallback cooldown is not eaten by the next cover pick */
{
  const point = farCover();
  const a = stubAgent({ cover: point, repathTimer: 9 });
  wirePath(a);
  a.ai.cover = {
    pick() { return point; },
    release() {},
    peekOffset(_c, _t, _e, out) { out.copy(a.coverPos); return 0; },
  };
  a.ai.requestPath = function () {
    this.lastPathOutcome = PATH_OUTCOME.DEFERRED;
    return -1;
  };
  a._goTo(a.coverPos);
  const shots = attachShots(a);
  let t = 0;
  while (t < RELOCATE_GIVE_UP + 0.5) {
    tickAgent(a);
    t += DT;
    if (t > RELOCATE_GIVE_UP + DT) {
      assert.equal(a.cover, null, `reclaimed cover at t=${t.toFixed(3)}`);
    }
  }
  assert.ok(shots.length >= 1);
  assert.ok(a._coverHold > 1, `retry timer eaten (${a._coverHold})`);
}

console.log('ok  smoke-ai-fire');
