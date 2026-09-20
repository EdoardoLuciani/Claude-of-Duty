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
import { FRIENDLY_HOLD } from '../src/ai/intent.js';

const DT = 1 / 60;
const rng = {
  float: () => 0.5, range: (a, b) => (a + b) * 0.5,
  int: (a) => a, gauss: () => 0,
};

function stubAgent(over = {}) {
  const a = Object.create(Agent.prototype);
  Object.assign(a, {
    id: 1, alive: true, state: STATE.COMBAT, stateTime: 2,
    hasTarget: true, targetVisible: true, awareness: 1, alertness: 1,
    lastKnown: new THREE.Vector3(0, 1.1, 0), lastKnownAge: 0.2,
    lastKnownKind: 'visual',
    position: new THREE.Vector3(0, 0, 10),
    yaw: Math.PI, targetYaw: Math.PI,
    cover: null, coverPos: new THREE.Vector3(), firePos: new THREE.Vector3(),
    peeking: false, _returning: false, _peekFail: 0, peekTimer: 9, peekSide: 0,
    wantFire: false, crouch: false, aimWeight: 1, desiredSpeed: 0, speed: 0,
    aimTarget: new THREE.Vector3(0, 1.1, 0),
    hasMoveTarget: false, pathPending: false, path: [], pathLen: 0, pathIndex: 0,
    moveTarget: new THREE.Vector3(),
    velocity: new THREE.Vector3(), _steer: new THREE.Vector3(),
    controller: null, grounded: true, vaultCooldown: 0, stuckTimer: 0, stuckHits: 0,
    health: 100, weaponRange: COMBAT.viewRange, fireRate: COMBAT.fireRate,
    spread: 0, weaponDamage: COMBAT.damage, magSize: 30, ammo: 30,
    burstLeft: 0, fireCooldown: 0, burstCooldown: 0, suppression: 0,
    hasGrenade: false, grenadeCooldown: 99, role: 'pin', wrapWait: 0, _wrapDone: true,
    repathTimer: 5, eyeHeight: 1.62, squad: null, rng,
    _friendlyBlock: 0, _muzzleBlocked: false, fireBlock: null,
    _relocWait: 0, _peekWait: 0,
    pathOutcome: null, pathObjective: null, pathReqFloor: NaN, pathResFloor: NaN,
    _pendingDest: new THREE.Vector3(),
    ctx: { time: { elapsed: 0, dt: DT, frame: 0 } },
    ai: {
      cover: { pick() { return null; }, release() {}, peekOffset(_c, _t, _e, out) { out.copy(a.coverPos); return 0; } },
      stats: { grenadeHolds: 0, friendlyHolds: 0, pathsDeferred: 0 },
      agents: [],
      onAgentFire() {},
      emitReload() {},
      grid: null,
      lastPathOutcome: null,
      lastPathResFloor: 0,
    },
    phys: { lineOfSight: () => true, raycast: () => ({ hit: false }), MASK: { SIGHT: 1, WORLD: 2 } },
    animator: {
      muzzleWorld: new THREE.Vector3(0.15, 1.42, 10),
      muzzleDir: new THREE.Vector3(0, 0, -1),
      reloading: false, vaulting: false, fire() {}, turn() {}, reload() {},
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
  a.animator.muzzleDir.copy(a.lastKnown).sub(o);
  if (a.animator.muzzleDir.lengthSq() < 1e-8) a.animator.muzzleDir.set(0, 0, -1);
  else a.animator.muzzleDir.normalize();
}

function attachShots(a) {
  const shots = [];
  a.ai.onAgentFire = (_agent, origin, dir) => {
    shots.push({
      origin: origin.clone ? origin.clone() : new THREE.Vector3().copy(origin),
      dir: dir.clone ? dir.clone() : new THREE.Vector3().copy(dir),
    });
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
  ai._pathBudget = ai.pathsPerFrame ?? 2;
  if (ai.grid && ai.requestPath) {
    ai.requestPath({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, []);
    ai.requestPath({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }, []);
  }
  tickAgent(a, dt);
}

function deferGrid() {
  return {
    findPath() { return 1; },
    nearest() { return 0; },
    floor: [0],
  };
}

function wirePath(a) {
  a.ai.grid = deferGrid();
  a.ai.pathsPerFrame = 2;
  a.ai._pathBudget = 2;
  a.ai.requestPath = AiSystem.prototype.requestPath;
  a.ai.lastPathOutcome = null;
  a.ai.lastPathResFloor = 0;
}

function holdReason(reason) {
  return reason === FIRE_BLOCK.RELOAD
    || reason === FIRE_BLOCK.SUPPRESSED
    || reason === FIRE_BLOCK.FRIENDLY
    || reason === FIRE_BLOCK.MUZZLE
    || reason === FIRE_BLOCK.BURST
    || reason === FIRE_BLOCK.ACQUIRING;
}

/* 1. clear shot — fires after acquire, not a relocate stall */
{
  const a = stubAgent({ cover: null, repathTimer: 9 });
  const shots = attachShots(a);
  aimMuzzle(a);
  let t = 0;
  while (t < 0.6 && shots.length === 0) {
    tickAgent(a, DT);
    t += DT;
  }
  assert.ok(shots.length >= 1, `clear shot never fired (t=${t.toFixed(3)} block=${a.fireBlock})`);
  assert.ok(t < 0.35, `clear shot waited ${t.toFixed(3)}s`);
  assert.notEqual(a.fireBlock, FIRE_BLOCK.RELOCATING);
}

/* 2. invalid / unreachable cover drops and fires */
{
  const cover = { x: 8, y: 0, z: 10, dx: 1, dz: 0, high: true };
  const a = stubAgent({ cover, position: new THREE.Vector3(0, 0, 10), repathTimer: 9 });
  a.coverPos.set(8, 0, 10);
  wirePath(a);
  a.ai.requestPath = function () {
    this.lastPathOutcome = PATH_OUTCOME.UNREACHABLE;
    this.lastPathResFloor = 0;
    return 0;
  };
  const shots = attachShots(a);
  a._goTo(a.coverPos);
  assert.equal(a.hasMoveTarget, false);
  assert.equal(a.pathPending, false);
  tickAgent(a, DT);
  assert.equal(a.cover, null, 'unreachable cover must drop');
  assert.ok(a.wantFire, 'open-ground fire after dropping dead cover');
  assert.ok(shots.length >= 1, 'unreachable cover must still produce a shot');
}

/* 3. deferred navigation — hold, then bounded exposed fire */
{
  const cover = { x: 8, y: 0, z: 10, dx: 1, dz: 0, high: true };
  const a = stubAgent({ cover, position: new THREE.Vector3(0, 0, 10), repathTimer: 9 });
  a.coverPos.set(8, 0, 10);
  wirePath(a);
  a.ai._pathBudget = 0;
  a._goTo(a.coverPos);
  assert.equal(a.pathPending, true, 'cover path must start deferred');
  assert.equal(a.hasMoveTarget, false);
  const shots = attachShots(a);
  a.ai.pathsPerFrame = 2;
  let t = 0;
  let held = 0;
  while (t < RELOCATE_GIVE_UP - 2 * DT) {
    tickStarved(a, DT);
    t += DT;
    if (a.fireBlock === FIRE_BLOCK.RELOCATING) held++;
    assert.equal(shots.length, 0, `fired at t=${t.toFixed(3)} before the relocate bound`);
  }
  assert.ok(held > 0, 'deferred cover travel must report relocating');
  assert.equal(a.pathPending, true);
  assert.equal(a.hasMoveTarget, false);
  while (t < RELOCATE_GIVE_UP + 0.2 && shots.length === 0) {
    tickStarved(a, DT);
    t += DT;
  }
  assert.ok(shots.length >= 1, `deferred nav never fell back (t=${t.toFixed(3)} block=${a.fireBlock})`);
  assert.ok(t < RELOCATE_GIVE_UP + 0.15, `fallback waited ${t.toFixed(3)}s`);
  assert.equal(a.cover, null);
  assert.notEqual(a.fireBlock, FIRE_BLOCK.RELOCATING);
}

/* 4. executing relocate must NOT start shooting just because time passed */
{
  const cover = { x: 8, y: 0, z: 10, dx: 1, dz: 0, high: true };
  const a = stubAgent({
    cover, position: new THREE.Vector3(0, 0, 10), repathTimer: 9,
    hasMoveTarget: true, pathPending: false, desiredSpeed: 4.3, speed: 4.3,
  });
  a.coverPos.set(8, 0, 10);
  a.moveTarget.copy(a.coverPos);
  a.path[0] = a.coverPos.clone();
  a.pathLen = 1;
  a.pathIndex = 0;
  const shots = attachShots(a);
  let t = 0;
  while (t < RELOCATE_GIVE_UP + 0.4) {
    tickAgent(a, DT);
    t += DT;
  }
  assert.equal(shots.length, 0, 'a walking relocate must keep the weapon down');
  assert.equal(a.fireBlock, FIRE_BLOCK.RELOCATING);
  assert.equal(a.wantFire, false);
}

/* 5. unusable peek — two blocked exposures drop cover, then a clear muzzle fires */
{
  const cover = { x: 0, y: 0, z: 10, dx: 0, dz: -1, high: false };
  const a = stubAgent({
    cover, position: new THREE.Vector3(0, 0, 10), peekTimer: 0, repathTimer: 9,
  });
  a.coverPos.set(0, 0, 10);
  a.firePos.set(0.95, 0, 10);
  a.ai.cover.peekOffset = (_c, _t, _e, out) => { out.set(0.95, 0, 10); return 1; };
  a.phys.lineOfSight = () => false;
  a._combat(DT);
  assert.equal(a.peeking, true);
  a.position.copy(a.firePos);
  a._combat(DT);
  assert.equal(a.peeking, false);
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
  tickAgent(a, DT);
  assert.ok(a.wantFire, 'clear muzzle after abandoning peek cover');
  assert.ok(shots.length >= 1, 'abandoned peek must still produce a shot');
}

/* 6. friendly obstruction holds fire with an explicit reason */
{
  const a = stubAgent({ cover: null, repathTimer: 9, burstLeft: 5 });
  const friend = stubAgent({
    id: 2, position: new THREE.Vector3(0, 0, 5),
    lastKnown: new THREE.Vector3(), hasTarget: false, targetVisible: false,
  });
  a.ai.agents = [a, friend];
  const shots = attachShots(a);
  aimMuzzle(a);
  let t = 0;
  let sawFriendly = false;
  while (t < FRIENDLY_HOLD - DT) {
    a.wantFire = true;
    a.fireCooldown = 0;
    a._shoot(DT);
    a._updateFireBlock();
    if (a.fireBlock === FIRE_BLOCK.FRIENDLY) sawFriendly = true;
    t += DT;
  }
  assert.equal(shots.length, 0, 'must not shoot a teammate');
  assert.ok(sawFriendly, 'friendly hold must report fireBlock=friendly');
  assert.ok(a.ai.stats.friendlyHolds > 0);
}

/* 7. suppression and reload keep the weapon down */
{
  const sup = stubAgent({ cover: null, state: STATE.SUPPRESSED, suppression: 1.4 });
  const shots = attachShots(sup);
  tickAgent(sup, DT);
  assert.equal(shots.length, 0);
  assert.equal(sup.wantFire, false);
  assert.equal(sup.fireBlock, FIRE_BLOCK.SUPPRESSED);

  const rel = stubAgent({ cover: null, repathTimer: 9 });
  rel.animator.reloading = true;
  const rShots = attachShots(rel);
  rel.wantFire = true;
  rel._shoot(DT);
  rel._updateFireBlock();
  assert.equal(rShots.length, 0);
  assert.equal(rel.fireBlock, FIRE_BLOCK.RELOAD);
}

/* 8. eye LOS must not authorize a muzzle shot through cover */
{
  const a = stubAgent({ cover: null, repathTimer: 9, burstLeft: 8 });
  a.phys.lineOfSight = (from) => from.y >= 1.55;
  a.targetVisible = true;
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
    role: 'wrap', _wrapDone: false, wrapWait: 0, squad: sq, repathTimer: 9,
    cover: { x: 4, y: 0, z: 10, dx: 1, dz: 0, high: true },
  });
  a.coverPos.set(4, 0, 10);
  sq.add(a);
  wirePath(a);
  sq.hasWrapDest = true;
  sq.wrapDest.set(20, 0, 20);
  const shots = attachShots(a);
  let t = 0;
  while (t < RELOCATE_GIVE_UP + 0.2 && shots.length === 0) {
    tickStarved(a, DT);
    t += DT;
  }
  assert.ok(shots.length >= 1, `wrap-pending never fell back (t=${t.toFixed(3)} block=${a.fireBlock})`);
  assert.equal(a._wrapDone, true);
  assert.equal(a.role, 'hold');
}

/* 10. peek-wait with no one peeking recovers; a live token is expected delay */
{
  const cover = { x: 0, y: 0, z: 10, dx: 0, dz: -1, high: true };
  const a = stubAgent({
    cover, position: new THREE.Vector3(0, 0, 10), peekTimer: 0.4, repathTimer: 9,
  });
  a.coverPos.set(0, 0, 10);
  const sq = new Squad(rng);
  sq.ai = { grid: null, cover: null };
  sq.peekTokens = 1;
  sq.add(a);
  a.squad = sq;
  sq.requestPeek = () => false;
  const shots = attachShots(a);
  let t = 0;
  while (t < PEEK_WAIT_GIVE_UP - 2 * DT) {
    tickAgent(a, DT);
    t += DT;
    assert.equal(shots.length, 0, `peek-wait fired early at ${t.toFixed(3)}`);
  }
  assert.equal(a.fireBlock, FIRE_BLOCK.PEEK_WAIT);
  while (t < PEEK_WAIT_GIVE_UP + 0.2 && shots.length === 0) {
    tickAgent(a, DT);
    t += DT;
  }
  assert.ok(shots.length >= 1, `empty-token peek-wait never recovered (block=${a.fireBlock})`);

  const waiter = stubAgent({
    id: 3, cover, position: new THREE.Vector3(0, 0, 10), peekTimer: 0.4, repathTimer: 9,
  });
  waiter.coverPos.set(0, 0, 10);
  const sq2 = new Squad(rng);
  sq2.ai = { grid: null, cover: null };
  sq2.peekTokens = 1;
  sq2.peekHolders.add(99);
  waiter.squad = sq2;
  sq2.members = [waiter];
  sq2.requestPeek = () => false;
  const wShots = attachShots(waiter);
  let wt = 0;
  while (wt < PEEK_WAIT_GIVE_UP + 0.3) {
    tickAgent(waiter, DT);
    wt += DT;
  }
  assert.equal(wShots.length, 0, 'a live peek token is expected delay, not a fallback');
  assert.equal(waiter.fireBlock, FIRE_BLOCK.PEEK_WAIT);
}

/* 11. alert / patrol never inherit a combat shot */
{
  const a = stubAgent({
    state: STATE.COMBAT, hasTarget: false, targetVisible: false, lastKnownAge: 10,
    wantFire: true, cover: null,
  });
  a._think(DT);
  assert.equal(a.state, STATE.ALERT);
  assert.equal(a.wantFire, false);
  const shots = attachShots(a);
  a._shoot(DT);
  assert.equal(shots.length, 0);
}

/* 12. a long combat hold must name a valid reason or have already recovered */
{
  const a = stubAgent({ cover: null, repathTimer: 9, burstCooldown: 0.8, burstLeft: 0 });
  a.phys.lineOfSight = () => false;
  tickAgent(a, DT);
  assert.ok(holdReason(a.fireBlock) || a.wantFire, `nameless hold (${a.fireBlock})`);
  const cover = { x: 6, y: 0, z: 10, dx: 1, dz: 0, high: true };
  const stuck = stubAgent({ cover, position: new THREE.Vector3(0, 0, 10), repathTimer: 9 });
  stuck.coverPos.set(6, 0, 10);
  wirePath(stuck);
  const sShots = attachShots(stuck);
  let t = 0;
  while (t < RELOCATE_GIVE_UP + 0.35) {
    tickStarved(stuck, DT);
    t += DT;
  }
  if (sShots.length === 0) {
    assert.ok(
      holdReason(stuck.fireBlock),
      `prolonged combat hold is ${stuck.fireBlock}`,
    );
    assert.notEqual(stuck.fireBlock, FIRE_BLOCK.RELOCATING);
    assert.notEqual(stuck.fireBlock, FIRE_BLOCK.PEEK_WAIT);
  }
}

console.log('ok  smoke-ai-fire');
