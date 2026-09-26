/** Recovery must execute local movement, including failed-start/no-target cases. */
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { testNav } from './lib/test-nav.mjs';
import { makeWalker } from './nav240/harness.mjs';

const grid = await testNav(), fixture = { grid, physics: grid.physics };
const candidate = { query(from, to) {
  const points = [], n = grid.findPath(from, to, points);
  return { outcome: grid.lastOutcome, points: points.slice(0, n) };
} };
const a = makeWalker(fixture, candidate, new Vector3(1, 0, 1), 7, true);
const dest = new Vector3(6, 0, 1), origin = a.position.clone();
const requested = [], go = a._goTo.bind(a), move = a.controller.move.bind(a.controller);
a._goTo = p => { requested.push(p.clone()); const ok = go(p); a.pathIndex = a.pathLen - 1; return ok; };
a._goTo(dest);
a.controller.move = () => { a.controller.lastMoveBlocked = true; };
a.ai._pathBudget = 2;
a._move(1.2);
assert.equal(a.stuckHits, 1, 'first blocked trip repaths');
assert.equal(requested.length, 2);
assert.ok(requested[1].distanceTo(dest) < 1e-6, 'first trip keeps the original objective');
a._move(1.2);
assert.equal(a.recoveryAttempts, 1);
assert.equal(a.recoveryOutcome, 'moving');
assert.equal(requested.length, 2, 'local physical recovery is not a hidden path solve');
assert.ok(a.position.distanceTo(origin) < 1e-6, 'starting recovery must not reposition the actor');
assert.ok(Math.abs(a.moveTarget.distanceTo(origin) - 1.2) < .05);
assert.equal(a.recoveries.length, 0);

const sidestep = a.moveTarget.clone();
a.controller.move = move;
for (let i = 0; i < 180 && a._recovering; i++) { a._move(1 / 60); a._tickNoProgress(1 / 60); }
assert.equal(a.recoveryOutcome, 'arrived', 'real controller must walk the sidestep');
assert.ok(a.position.distanceTo(origin) > 1);
assert.ok(a.position.distanceTo(sidestep) < .25);
assert.ok(a.moveTarget.distanceTo(dest) < 1e-6, 'a completed sidestep resumes the original route');
assert.ok(a.hasMoveTarget || a.pathPending);
assert.equal(a.stuckHits, 0, 'free movement resets blocked trips');
assert.equal(a.recoveries.length, 0, 'no recovery teleport');

// Depenetration stalls need not set lastMoveBlocked.
a._recoveryWait = 0;
a.hasMoveTarget = true; a.speed = 1.5; a._steer.set(1, 0, 0);
a._progressPos.copy(a.position);
const stalledAt = a.position.clone();
a._tickNoProgress(3.1);
assert.equal(a.recoveryAttempts, 2);
assert.equal(a.recoveryOutcome, 'moving');
assert.ok(a.position.distanceTo(stalledAt) < 1e-6);
a._tickNoProgress(3.1);
assert.equal(a.recoveryOutcome, 'blocked', 'a timed-out step is not arrival');
assert.equal(a.hasMoveTarget, false);

// A rejected start used to evade the watchdog because _goTo cleared the target.
a._recoveryWait = 0; a.speed = 0; a.pathReason = 'disconnected'; a.pathObjective = 'patrol';
a._tickNoProgress(3.1);
assert.equal(a.recoveryAttempts, 3, 'stationary failed routes get a bounded physical retry');
assert.equal(a.recoveryOutcome, 'moving');
assert.equal(a.recoveries.length, 0);
a._tickNoProgress(3.1);
a.ai.grid = { project() { return 0; }, sampleGround() { return 0; }, canAttach() { return false; } };
a.pathObjective = 'patrol';
a._recoveryWait = 0;
a._tickNoProgress(3.1);
assert.equal(a.recoveryOutcome, 'failed', 'exhausted recovery fails closed instead of looping');
assert.equal(a.pathReason, 'execution-blocked');
assert.equal(a.hasMoveTarget, false);
assert.ok(a.position.distanceTo(stalledAt) < 1e-6);
a.ai.grid = null;
assert.equal(a._unstickDest(a._v), null, 'missing navigation cannot authorize a step');

a.hasMoveTarget = true; a.speed = 1.5; a._steer.set(1, 0, 0);
a._progressPos.copy(a.position); a.noProgressTime = 2.5;
a.position.x += .6;
a._tickNoProgress(.6);
assert.equal(a.noProgressTime, 0, 'real displacement resets progress');
// Corner consumption and deferred replans preserve a sustained stall clock.
a._progressPos.copy(a.position); a.noProgressTime = 2;
a.hasMoveTarget = true; a.desiredSpeed = 1.5; a.speed = 0; a._steer.set(0, 0, 0);
a._tickNoProgress(.2);
assert.equal(a.noProgressTime, 2.2);
a.hasMoveTarget = false; a.pathPending = true;
a._tickNoProgress(.2);
assert.equal(a.noProgressTime, 2.2, 'budget wait neither erases nor charges movement progress');
a.pathPending = false; a.desiredSpeed = 0;
a._tickNoProgress(.2);
assert.equal(a.noProgressTime, 0, 'deliberate dwell is not a movement stall');
a._noRouteTime = 2; a.pathReason = 'start-attachment'; a.pathObjective = 'patrol';
a.pathPending = true;
a._tickNoProgress(.2);
assert.equal(a._noRouteTime, 2, 'deferred failed-start retries preserve the stranded clock too');
a.pathPending = false;
a._tickNoProgress(.2);
assert.equal(a._noRouteTime, 2.2);
a.hasMoveTarget = true; a.pathIndex = 0; a.pathLen = 1; a.path[0].copy(a.position);
a.pathObjective = 'patrol'; a._recoveryCount = 3; a._failStreak = 2;
a._move(0);
assert.equal(a._recoveryCount, 0, 'real objective arrival restores the local recovery allowance');
assert.equal(a._failStreak, 0, 'real objective arrival clears patrol failure history');
a._stepTo(a.position.clone().add(new Vector3(.2, 0, 0)), 'patrol');
a._recovering = true; a._recoveryCount = 3; a._failStreak = 2;
a._move(0);
assert.equal(a.hasMoveTarget, true, 'a patrol recovery sidestep retains the tighter local arrival radius');
a._stepTo(a.position, 'patrol'); a._move(0);
assert.equal(a._recoveryCount, 3, 'a local sidestep does not erase repeated objective failure');
assert.equal(a._failStreak, 2, 'a recovery sidestep must not clear patrol failure history');
fixture.physics.removeCharacter(a.controller); grid.dispose();
console.log('ok  physical stuck/no-progress/failed-start recovery, bounded and teleport-free');
