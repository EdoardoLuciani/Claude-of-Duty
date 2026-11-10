import assert from 'node:assert/strict';

import * as THREE from 'three';

/**
 * Headless regressions for issue 275.
 *
 * Combat fire must not stall forever on failed/deferred navigation or
 * cover waits. Assert shots and wait bounds, not just wantFire.
 *
 *   bun test ./tests/smoke/smoke-ai-fire.ts
 */
import type { Agent } from '../../src/ai/agent.ts';
import {
  STATE,
  FIRE_BLOCK,
  PATH_OUTCOME,
  RELOCATE_GIVE_UP,
  PEEK_WAIT_GIVE_UP,
} from '../../src/ai/agent.ts';
import { AiSystem } from '../../src/ai/index.ts';
import type { BakedCoverPoint } from '../../src/ai/nav-format.ts';
import { CoverMap } from '../../src/ai/nav.ts';
import { Squad } from '../../src/ai/squad.ts';
import { COMBAT } from '../../src/ai/tuning.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { makeAgent, makeAi } from '../lib/agent-fixture.ts';
import { midpointRng, brainPhysics, brainAnimator, coverPoint } from '../lib/ai-brain-fixture.ts';
import { createTestContext } from '../lib/context.ts';
import { FRAME_SOURCES } from '../lib/frame-sources.ts';
import { testNav } from '../lib/test-nav.ts';

const pathGrid = await testNav();
function lastShot(times: number[]): number {
  const time = times.at(-1);
  assert.notEqual(time, undefined);
  assert.ok(typeof time === 'number');
  return time;
}
const DT = 1 / 60;
const rng = midpointRng();

function stubAgent(over: Partial<Agent> = {}): Agent {
  const ai = makeAi();
  const phys = brainPhysics();
  const cover = new CoverMap(null, phys);
  ai.cover = cover;
  const a = makeAgent({
    id: 1,
    alive: true,
    state: STATE.COMBAT,
    stateTime: 2,
    hasTarget: true,
    targetVisible: true,
    // Navigation wait contracts apply outside the new close-defense interrupt.
    lastKnown: new THREE.Vector3(0, 1.1, -10),
    lastKnownAge: 0.2,
    lastKnownKind: 'visual',
    position: new THREE.Vector3(0, 0, 10),
    yaw: Math.PI,
    targetYaw: Math.PI,
    peekTimer: 9,
    wantFire: false,
    crouch: false,
    aimWeight: 1,
    desiredSpeed: 0,
    speed: 0,
    aimTarget: new THREE.Vector3(0, 1.1, -10),
    health: 100,
    weaponRange: COMBAT.viewRange,
    fireRate: COMBAT.fireRate,
    spread: 0,
    magSize: 30,
    ammo: 30,
    burstLeft: 0,
    fireCooldown: 0,
    burstCooldown: 0,
    suppression: 0,
    hasGrenade: false,
    grenadeCooldown: 99,
    role: 'pin',
    wrapWait: 0,
    _wrapDone: true,
    repathTimer: 5,
    eyeHeight: 1.62,
    squad: null,
    rng,
    ctx: createTestContext(),
    ai,
    phys,
    animator: brainAnimator({
      muzzleWorld: new THREE.Vector3(0.15, 1.42, 10),
      muzzleDir: new THREE.Vector3(0, 0, -1),
    }),
    ...over,
  });

  cover.pick = (): null => null;
  cover.protects = (): boolean => true;
  cover.release = (): void => {};
  cover.peekOffset = (c, _t, _e, out): number => {
    out.copy(a.coverPos);
    return 0;
  };
  if (over.cover) a.coverPos.set(over.cover.x, over.cover.y, over.cover.z);
  a.ai.agents = [a];
  return a;
}

function aimMuzzle(a: Agent): void {
  const o = a.animator.muzzleWorld;
  o.set(a.position.x + 0.15, a.position.y + 1.42, a.position.z);
  a.animator.muzzleDir.copy(a.lastKnown).sub(o).normalize();
}

function attachShots(a: Agent): { origin: THREE.Vector3; dir: THREE.Vector3 }[] {
  const shots: Array<{ origin: THREE.Vector3; dir: THREE.Vector3 }> = [];
  a.ai.onAgentFire = (_agent, origin, dir): boolean => {
    shots.push({ origin: origin.clone(), dir: dir.clone() });
    return true;
  };
  return shots;
}

function tickAgent(a: Agent, dt = DT): void {
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

function tickStarved(a: Agent, dt = DT): void {
  const ai = a.ai;
  ai._pathBudget = ai.pathsPerFrame;
  ai.requestPath(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0), []);
  ai.requestPath(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 4), []);
  tickAgent(a, dt);
}

function wirePath(a: Agent): void {
  const grid = pathGrid;
  grid.findPath = (_from, dest, out): number => {
    if (!out[0]) out[0] = new THREE.Vector3();
    out[0].copy(dest);
    return 1;
  };
  grid.findRoute = (from, dest, out): number => {
    const n = grid.findPath(from, dest, out.points);
    out.ladderSteps.length = 0;
    return n;
  };
  a.ai.grid = grid;
  a.ai.pathsPerFrame = 2;
  a.ai._pathBudget = 2;
  a.ai.requestPath = AiSystem.prototype.requestPath.bind(a.ai);
  a.ai.stats.pathsDeferred = 0;
}

function farCover(x = 8): BakedCoverPoint {
  return coverPoint({ x, y: 0, z: 10, dx: 1, dz: 0, high: true });
}

function run(
  a: Agent,
  seconds: number,
  tick = tickAgent
): { shots: { origin: THREE.Vector3; dir: THREE.Vector3 }[]; t: number } {
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
  a.ai.requestPath = function (): number {
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
  assert.ok(
    shots.length >= 1,
    `deferred nav never fell back (t=${t.toFixed(3)} block=${a.fireBlock})`
  );
  assert.ok(t < RELOCATE_GIVE_UP + 0.15, `fallback waited ${t.toFixed(3)}s`);
  assert.notEqual(a.fireBlock, FIRE_BLOCK.RELOCATING);
}

/* 4. distant walking relocate keeps the weapon down */
{
  const cover = farCover();
  const a = stubAgent({
    cover,
    repathTimer: 9,
    hasMoveTarget: true,
    desiredSpeed: 4.3,
    speed: 4.3,
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
  const cover = coverPoint({ x: 0, y: 0, z: 10, dx: 0, dz: -1, high: false });
  const a = stubAgent({ cover, peekTimer: 0, repathTimer: 9 });
  a.firePos.set(0.95, 0, 10);
  assert.ok(a.ai.cover);
  a.ai.cover.peekOffset = (_c, _t, _e, out): number => {
    out.set(0.95, 0, 10);
    return 1;
  };
  a.phys.lineOfSight = (): boolean => false;
  a._combat(DT);
  a.position.copy(a.firePos);
  for (let i = 0; i < 22; i++) {
    a._combat(DT);
    assert.equal(a.wantFire, false, 'weapon settling cannot bypass a blocked muzzle');
  }
  assert.equal(a._returning, true);
  a.position.copy(a.coverPos);
  a._returning = false;
  a.peekTimer = 0;
  a._combat(DT);
  a.position.copy(a.firePos);
  for (let i = 0; i < 22; i++) a._combat(DT);
  assert.equal(a.cover, null, 'two blocked peeks abandon the point');
  a.phys.lineOfSight = (): boolean => true;
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

  // Sustained defensive fire must not turn a friendly hold into route arrival.
  a._setState(STATE.RETREAT);
  a.health = 30;
  a.suppression = 1.6;
  wirePath(a);
  const destination = new THREE.Vector3(0, 0, 30);
  a._goTo(destination);
  const pathLen = a.pathLen;
  for (let i = 0; i < 60; i++) tickAgent(a);
  assert.equal(a.state, STATE.RETREAT);
  assert.equal(a.hasMoveTarget, true);
  assert.equal(a.pathLen, pathLen);
  assert.deepEqual(a.moveTarget, destination);
  assert.ok(a.desiredSpeed > 0, 'withdrawal must continue while the shot is blocked');
  assert.equal(shots.length, 0, 'retreat cannot bypass the friendly-fire guard');

  a._setState(STATE.FLANK);
  a._breakFriendlyPeek();
  assert.equal(a.hasMoveTarget, true, 'friendly cleanup must also preserve a flank route');
  assert.equal(a.pathLen, pathLen);
}

/* 7. suppression and reload */
{
  const sup = stubAgent({
    state: STATE.SUPPRESSED,
    suppression: 1.4,
    scale: 1,
    cover: coverPoint({ x: 0, y: 0, z: 10, high: false }),
  });
  const sShots = attachShots(sup);
  tickAgent(sup);
  assert.equal(sShots.length, 0);
  assert.equal(sup.fireBlock, FIRE_BLOCK.SUPPRESSED);

  const rel = stubAgent({ repathTimer: 9 });
  rel.animator.reloadT = 0;
  const rShots = attachShots(rel);
  rel.wantFire = true;
  rel._shoot(DT);
  rel._updateFireBlock();
  assert.equal(rShots.length, 0);
  assert.equal(rel.fireBlock, FIRE_BLOCK.RELOAD);
}

/* Suppression changes tactics, not authorization to return safe fire. */
for (const state of [STATE.COMBAT, STATE.FLANK, STATE.RETREAT]) {
  const a = stubAgent({ state, suppression: 1.6, hasMoveTarget: state !== STATE.COMBAT });
  a.moveTarget.set(15, 0, 10);
  const shots = attachShots(a);
  tickAgent(a);
  assert.ok(shots.length > 0, `${state}: exposed suppressed soldier must return fire`);
  assert.equal(a.fireBlock, null, 'diagnostics must not claim shooting is suppressed');
  if (state !== STATE.COMBAT)
    assert.equal(a.hasMoveTarget, true, 'defensive fire preserves escape route');
}
{
  const a = stubAgent({ suppression: 1.6, cover: farCover(), hasMoveTarget: true });
  a.moveTarget.copy(a.coverPos);
  const shots = attachShots(a);
  tickAgent(a);
  assert.equal(a.state, STATE.SUPPRESSED);
  assert.equal(a.crouch, false, 'do not crouch in the open because shelter was claimed');
  assert.ok(a.desiredSpeed > 0);
  assert.ok(shots.length > 0, 'return fire while moving to protection');
  assert.equal(a.combatAction, 'suppressed-move');
  a.position.copy(a.coverPos);
  const fired = shots.length;
  tickAgent(a);
  assert.equal(a.crouch, true);
  assert.equal(a.desiredSpeed, 0);
  assert.equal(a.wantFire, false);
  assert.equal(a.fireBlock, FIRE_BLOCK.SUPPRESSED);
  assert.equal(a.combatAction, 'suppressed-hide');
  assert.equal(shots.length, fired, 'duck only after reaching verified protection');
  a.suppression = 0.4;
  tickAgent(a);
  assert.equal(a.state, STATE.COMBAT, 'resume normal combat after pressure subsides');
}
{
  const a = stubAgent({ suppression: 1.6, state: STATE.SUPPRESSED, cover: farCover() });
  assert.ok(a.ai.cover);
  a.ai.cover.protects = (): boolean => false;
  const shots = attachShots(a);
  tickAgent(a);
  assert.equal(a.cover, null);
  assert.equal(a.state, STATE.COMBAT);
  assert.ok(shots.length > 0, 'invalid shelter must not leave an exposed soldier mute');
}
{
  const a = stubAgent({ suppression: 1.6, repathTimer: 0 });
  wirePath(a);
  assert.ok(a.ai.cover);
  a.ai.cover.pick = (): BakedCoverPoint => farCover();
  const shots = attachShots(a);
  tickAgent(a);
  assert.ok(a.cover && a.hasMoveTarget, 'under pressure, prioritize a route to shelter');
  assert.ok(a.desiredSpeed > 0);
  assert.ok(shots.length > 0, 'selecting cover must not silence defensive fire');
}
for (const reason of [
  'unacquired',
  'stale',
  'report',
  'muzzle',
  'alignment',
  'friendly',
  'reload',
  'vault',
]) {
  const a = stubAgent({ suppression: 1.6 });
  if (reason === 'unacquired') a.hasTarget = false;
  if (reason === 'stale' || reason === 'report') {
    a.targetVisible = false;
    a.lastKnownAge = reason === 'stale' ? 2 : 0.1;
    if (reason === 'report') a.lastKnownKind = 'report';
  }
  if (reason === 'muzzle') a.phys.lineOfSight = (): boolean => false;
  if (reason === 'friendly')
    a.ai.agents.push(stubAgent({ id: 2, position: new THREE.Vector3(0, 0, 5) }));
  if (reason === 'reload') a.animator.reloadT = 0;
  if (reason === 'vault') a.animator.vaultT = 0;
  const shots = attachShots(a);
  a._think(DT);
  aimMuzzle(a);
  if (reason === 'alignment') a.animator.muzzleDir.set(1, 0, 0);
  a._shoot(DT);
  a._updateFireBlock();
  assert.equal(shots.length, 0, `suppression cannot bypass ${reason}`);
  if (reason === 'muzzle' || reason === 'alignment') assert.equal(a.fireBlock, FIRE_BLOCK.MUZZLE);
  if (reason === 'friendly') assert.equal(a.fireBlock, FIRE_BLOCK.FRIENDLY);
  if (reason === 'reload') assert.equal(a.fireBlock, FIRE_BLOCK.RELOAD);
}
{
  const cover = coverPoint({ x: 0, y: 0, z: 10, high: false });
  const a = stubAgent({ cover, suppression: 0.8, peeking: true, peekTimer: 0.5 });
  a.firePos.copy(a.position);
  a._updatePeek(null, a.lastKnown, 20, 0.2);
  assert.ok(a.peekTimer < 0.5, 'light suppression shortens an arrived exposure');
  assert.equal(a.wantFire, true, 'light suppression retains safe fire during exposure');
  a.suppression = 1.6;
  tickAgent(a);
  assert.equal(a.peeking, false, 'heavy suppression cancels exposure before another peek');
  assert.equal(a.crouch, true, 'duck at a verified hide position');
}

/* 8. eye LOS / barrel alignment must not authorize a shot through cover */
{
  const a = stubAgent({ repathTimer: 9, burstLeft: 8 });
  a.phys.lineOfSight = (from): boolean => from.y >= 1.55;
  const shots = attachShots(a);
  a._think(DT);
  assert.equal(a.wantFire, true, 'eyes may still want the shot');
  a._shoot(DT);
  a._updateFireBlock();
  assert.equal(shots.length, 0, 'blocked muzzle must not fire');
  assert.equal(a.fireBlock, FIRE_BLOCK.MUZZLE);

  a.animator.muzzleDir.set(1, 0, 0);
  a.phys.lineOfSight = (): boolean => true;
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
  sq.ai = makeAi();
  const a = stubAgent({
    role: 'wrap',
    _wrapDone: false,
    squad: sq,
    repathTimer: 9,
    cover: farCover(4),
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
  const cover = coverPoint({ x: 0, y: 0, z: 10, dx: 0, dz: -1, high: true });
  const a = stubAgent({ cover, peekTimer: 0.4, repathTimer: 9 });
  const sq = new Squad(rng);
  sq.ai = makeAi();
  sq.add(a);
  sq.requestPeek = (): boolean => false;
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
  sq2.ai = makeAi();
  sq2.peekHolders.add(99);
  waiter.squad = sq2;
  sq2.members = [waiter];
  sq2.requestPeek = (): boolean => false;
  const { shots: wShots } = run(waiter, PEEK_WAIT_GIVE_UP + 0.3);
  assert.equal(wShots.length, 0, 'a live peek token is expected delay, not a fallback');
  assert.equal(waiter.fireBlock, FIRE_BLOCK.PEEK_WAIT);
}

/* 11. one leftover path slot must not cancel a successful wrap retry */
{
  const sq = new Squad(rng);
  sq.ai = makeAi();
  const a = stubAgent({
    role: 'wrap',
    _wrapDone: false,
    squad: sq,
    repathTimer: 9,
    cover: farCover(4),
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
    a.ai.requestPath(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0), []);
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
  const cover = new CoverMap(null, a.phys);
  cover.pick = (): BakedCoverPoint => point;
  cover.protects = (): boolean => true;
  cover.release = (): void => {};
  cover.peekOffset = (_c, _t, _e, out): number => {
    out.copy(a.coverPos);
    return 0;
  };
  a.ai.cover = cover;
  a.ai.requestPath = function (): number {
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

/* 13. a deferred wrap route must enter flank and actually move */
{
  const nav = await testNav();
  assert.ok(nav.physics instanceof PhysicsSystem);
  const start = new THREE.Vector3(1, 0.008, 1);
  const dest = new THREE.Vector3(8, 0.008, 1);
  const moved = { deferred: 0, immediate: 0 };
  for (const deferred of [false, true]) {
    const ai = makeAi(nav);
    const a = makeAgent({
      ai,
      position: start.clone(),
      state: STATE.COMBAT,
      stateTime: 2,
      hasTarget: true,
      targetVisible: true,
      lastKnown: new THREE.Vector3(1, 1, 25),
      lastKnownAge: 0,
      lastKnownKind: 'visual',
      role: 'wrap',
      wrapWait: 0,
      _wrapDone: false,
      desiredSpeed: 0,
      phys: nav.physics,
      animator: brainAnimator({}),
    });
    ai.agents = [a];
    const sq = new Squad(a.rng);
    sq.ai = ai;
    sq.add(a);
    a.role = 'wrap';
    sq.hasWrapDest = true;
    sq.wrapDest.copy(dest);
    a.controller = nav.physics.createCharacter({
      radius: a.radius,
      height: a.height,
      stepHeight: 0.38,
    });
    a.controller.setPosition(start.x, start.y, start.z);
    ai._pathBudget = deferred ? 0 : 2;
    a._think(DT);
    ai._pathBudget = 2;
    ai._servePendingPaths();
    let flanked = a.state === STATE.FLANK;
    for (let i = 0; i < 120; i++) {
      a._think(DT);
      a._move(DT);
      a._tickNoProgress(DT);
      flanked = flanked || a.state === STATE.FLANK;
    }
    moved[deferred ? 'deferred' : 'immediate'] = Math.hypot(
      a.position.x - start.x,
      a.position.z - start.z
    );
    assert.equal(flanked, true, `${deferred ? 'deferred' : 'immediate'} wrap never entered flank`);
    assert.equal(a.recoveryAttempts, 0);
    nav.physics.removeCharacter(a.controller);
  }
  assert.ok(moved.immediate > 5, `immediate wrap moved ${moved.immediate.toFixed(3)} m`);
  assert.ok(
    Math.abs(moved.deferred - moved.immediate) < 0.5,
    `deferred ${moved.deferred.toFixed(3)} m vs immediate ${moved.immediate.toFixed(3)} m`
  );
  nav.dispose();
}

/* frame-rate independent cadence (issue 605): fire eligibility is held fixed */
{
  const held = new Set<Agent>();
  const shooter = (
    over: Partial<Agent> = {}
  ): { a: Agent; times: number[]; step: (dt: number) => number } => {
    const a = stubAgent({ repathTimer: 9, wantFire: true, ...over });
    a.animator.reload = function (): void {
      this.reloadT = 0;
    };
    a.ai.emitReload = (): void => {};
    const times: number[] = [];
    let t = 0;
    a.ai.onAgentFire = (): boolean => {
      if (held.has(a)) return false; // a resolved-shot friendly rejection
      times.push(t);
      return true;
    };
    const step = (dt: number): number => {
      t += dt;
      const before = times.length;
      a.fireCooldown -= dt;
      a.burstCooldown -= dt;
      a.wantFire = true;
      aimMuzzle(a);
      a._shoot(dt);
      return times.length - before;
    };
    return { a, times, step };
  };
  const endless = midpointRng();
  endless.int = (): number => 1e6;

  // A continuous burst sustains the authored fire rate at any frame rate.
  for (const fireRate of [COMBAT.fireRate, COMBAT.fireRateIrregular]) {
    const counts = [];
    for (const [label, nextDt] of FRAME_SOURCES) {
      const { a, times, step } = shooter({ rng: endless, fireRate, ammo: 1e6, magSize: 1e6 });
      while (times.length < 2 || lastShot(times) - times[0] < 10) step(nextDt());
      const expected = 1 + (lastShot(times) - times[0]) * fireRate;
      assert.ok(
        Math.abs(times.length - expected) <= 1,
        `AI ${fireRate}/s @ ${label}: ${times.length} rounds, expected ~${expected.toFixed(1)}`
      );
      for (let i = 1; i < times.length; i++) {
        assert.ok(times[i] - times[0] >= i / fireRate - 1e-9, `AI @ ${label}: round ${i} early`);
      }
      assert.equal(1e6 - a.ammo, times.length, `AI @ ${label}: one cartridge per round`);
      counts.push(times.length);
    }
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'AI cadence varies with FPS');
  }

  // Intentional burst gaps survive: each burst is burstMin rounds at the fire
  // rate, and the next burst starts no sooner than the gap after the last.
  const gap = (COMBAT.burstGapMin + COMBAT.burstGapMax) * 0.5;
  for (const [label, nextDt] of FRAME_SOURCES) {
    const { times, step } = shooter({ ammo: 1e6, magSize: 1e6 });
    let maxDt = 0;
    while (times.length < 10 * COMBAT.burstMin) step((maxDt = Math.max(maxDt, nextDt())));
    for (let b = 0; b < 10; b++) {
      const first = times[b * COMBAT.burstMin];
      const last = times[(b + 1) * COMBAT.burstMin - 1];
      const span = (COMBAT.burstMin - 1) / COMBAT.fireRate;
      assert.ok(last - first >= span - 1e-9, `AI burst @ ${label}: early round`);
      assert.ok(last - first < span + maxDt + 1e-9, `AI burst @ ${label}: late round`);
      if (b > 0) {
        const prev = times[(b - 1) * COMBAT.burstMin];
        assert.ok(first - prev >= gap - 1e-9, `AI burst @ ${label}: gap skipped`);
      }
    }
  }

  // Friendly holds and reloads do not bank rounds: the first clear frame fires
  // at most once and the authored interval follows.
  for (const name of ['friendly hold', 'reload']) {
    const { a, times, step } = shooter({ rng: endless, ammo: 1e6, magSize: 1e6 });
    for (let i = 0; i < 30; i++) step(DT);
    if (name === 'reload') a.ammo = 0;
    else held.add(a);
    const before = times.length;
    for (let i = 0; i < 60; i++) step(DT);
    assert.equal(times.length, before, `${name}: no rounds during the block`);
    assert.equal(a.ammo, name === 'reload' ? a.magSize : 1e6 - before, `${name}: ammo kept`);
    held.delete(a);
    a.animator.reloadT = -1;
    const resumed = times.length;
    assert.equal(step(DT), 1, `${name}: the clear frame fires one round`);
    while (times.length === resumed + 1) step(DT);
    assert.ok(
      lastShot(times) - times[resumed] >= 1 / COMBAT.fireRate - 1e-9,
      `${name}: banked round`
    );
  }

  // The magazine's last round does not also start the reload in its frame.
  {
    const { a, step } = shooter({ rng: endless, ammo: 1 });
    assert.equal(step(DT), 1);
    assert.equal(a.ammo, 0);
    assert.equal(a.animator.reloading, false, 'reload waits for a later frame');
  }

  // Overload: a 1 s hitch fires at most maxShotsPerFrame rounds; no backlog.
  {
    const { a, step } = shooter({ rng: endless, ammo: 1e6, magSize: 1e6 });
    step(DT);
    assert.equal(step(1), COMBAT.maxShotsPerFrame, 'AI hitch catches up to the bound');
    assert.equal(step(DT), 1, 'the next frame fires one due round');
    assert.equal(step(DT), 0, 'and does not drain a backlog');
    assert.equal(1e6 - a.ammo, 2 + COMBAT.maxShotsPerFrame);
  }
}

pathGrid.dispose();
console.log('ok  smoke-ai-fire');
