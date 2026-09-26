import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { SurfaceNav } from '../src/ai/nav.js';
import { EVIDENCE, STATE, SEARCH_DURATION } from '../src/ai/agent.js';
import { Rng } from '../src/core/rng.js';
import { loadMap, addFollowupCases, vec } from './nav240/fixtures.mjs';
import { execute, makeWalker } from './nav240/harness.mjs';

const f = await loadMap(), baseCount = f.cases.length;
addFollowupCases(f);
f.grid = await SurfaceNav.load(f.surfaceRaw, f.physics);
const candidate = { query(from, to) {
  const points = [], n = f.grid.findPath(from, to, points);
  return { points: points.slice(0, n), outcome: f.grid.lastOutcome, reason: f.grid.lastReason };
} };
for (const c of f.cases.slice(baseCount)) {
  for (const options of [{ speed: 1.5 }, { speed: 4.3, dt: 1 / 30 }]) {
    const r = execute(f, candidate, c, true, options);
    assert.ok(r.arrived, `${c.name} at ${options.speed}: ${r.status}, ${r.horizontalError}/${r.floorError}`);
    assert.equal(r.recovery.length, 0, 'never credit teleporting');
    assert.equal(r.recoveryAttempts, 0, 'these routes must not require local recovery either');
  }
}

// Real search timing + real controller, with the long captured W2 route. Nearby
// noisy sound evidence must not destroy the route before the stair is reached.
const c = f.cases[baseCount], a = makeWalker(f, candidate, c.from, 7, true);
Object.assign(a, {
  state: STATE.ALERT, stateTime: 0, lastKnown: c.to.clone(), lastKnownAge: 0,
  lastKnownKind: EVIDENCE.SOUND, rng: new Rng(17), searchPoint: new Vector3(),
  _searchCand: [new Vector3(), new Vector3(), new Vector3()], _searchUntil: 0,
  patrolPoints: null, wantFire: false,
});
a._beginSearch();
const initialGoal = a.moveTarget.clone(), deadline = a._searchTravelUntil;
assert.ok(deadline > SEARCH_DURATION * 3 && deadline <= 90);
assert.equal(a._searchReached, false, 'a solved path is not arrival');
for (let frame = 0; frame < 6000 && !a._searchReached; frame++) {
  const dt = 1 / 60;
  a.ai._pathBudget = 2; a.stateTime += dt; a.lastKnownAge += dt;
  if (frame % 120 === 60) a._noteEvidence(c.to.clone().add(new Vector3(frame % 240 ? 3 : -3, 0, 0)), EVIDENCE.SOUND, 0);
  a._think(dt); a._move(dt); a._tickNoProgress(dt);
  assert.equal(a.state, STATE.ALERT, 'search must survive real travel time');
  assert.ok(a.moveTarget.distanceTo(initialGoal) < 1e-6, 'nearby noise must preserve the active destination');
  assert.equal(a._searchTravelUntil, deadline, 'noise must not indefinitely renew the travel budget');
}
assert.equal(a._searchReached, true);
assert.ok(a.position.distanceTo(initialGoal) < .5);
assert.ok(Math.abs(a.position.y - c.to.y) <= .18);
assert.ok(a.stateTime > SEARCH_DURATION, 'fixture must exceed the old search deadline');
assert.ok(a._searchUntil >= a.stateTime + SEARCH_DURATION - .02, 'arrival gets investigation time');
assert.equal(a.recoveries.length, 0);
f.physics.removeCharacter(a.controller);

// The recorded hop strands soldier 1 on a three-polygon prop island.
assert.equal(f.grid.canVault(vec([-2.431, .151, -12.384]),
  vec([-2.0395839327, .96740094275, -10.93596910866]), vec([0, .1, -8])), false);
const stranded = makeWalker(f, candidate, vec([-2.431, .151, -12.384]), 1, true);
stranded.yaw = .264;
stranded._stepTo(vec([0, .1, -8]));
stranded._tryVault();
assert.equal(stranded.vaultT, -1, 'real agent must reject the recorded stranded hop');
assert.equal(stranded.vaultOutcome, 'rejected');
assert.equal(stranded.recoveries.length, 0);
f.physics.removeCharacter(stranded.controller);
f.grid.dispose();
console.log('ok  captured upstairs routes at walk/run speeds, terrace access, search continuity and stranded-vault rejection');
