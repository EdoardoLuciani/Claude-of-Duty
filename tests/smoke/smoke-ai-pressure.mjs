import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeAgent, makeAi } from '../../tools/lib/agent-fixture.mjs';
import { TACTICS } from '../../src/ai/tuning.js';
import { CoverMap } from '../../src/ai/nav.js';

function fighter(state = 'combat') {
  const ai = makeAi();
  const a = makeAgent({ ai, state, stateTime: 2, hasTarget: true, targetVisible: true,
    lastKnownKind: 'visual', lastKnownAge: 0, visualAge: 0,
    lastKnown: new THREE.Vector3(0, 1.2, 8), hasGrenade: false,
    phys: { lineOfSight: () => true, MASK: { SIGHT: 1 } },
    animator: { muzzleWorld: new THREE.Vector3(), muzzleDir: new THREE.Vector3(0, 0, 1), turn() {} },
  });
  ai.agents.push(a);
  return a;
}

// Hearing can keep evidence fresh, but must not prolong visual acquisition.
{
  const a = fighter();
  a.ai.playerPosition = out => out.set(0, 1.2, 8);
  a.phys.lineOfSight = () => false;
  for (let i = 0; i < 50; i++) {
    a.lastKnownAge += .1;
    a._sense(.1);
    a.hear(new THREE.Vector3(0, 0, 8), 40);
  }
  assert.equal(a.hasTarget, false);
  assert.equal(a.targetVisible, false);
  assert.ok(a.visualAge > TACTICS.visualMemory);
  assert.ok(a.lastKnownAge < .2, 'sound still guides investigation');
  assert.equal(a._canFireAtLastKnown(), false);
  a.phys.lineOfSight = () => true;
  a.yaw = 0;
  for (let i = 0; i < 30; i++) a._sense(.05);
  assert.equal(a.hasTarget, true, 'real reacquisition restores combat');
  assert.equal(a.visualAge, 0);
}

for (const state of ['combat', 'flank', 'retreat']) {
  const a = fighter(state);
  a.hasMoveTarget = true; a.pathLen = 1; a.moveTarget.set(20, 0, 0);
  a._think(.05);
  assert.equal(a.state, state, 'interrupt does not discard the underlying state');
  assert.equal(a.combatAction, 'close-engage');
  assert.equal(a.wantFire, true);
  assert.equal(a.desiredSpeed, 0);
  if (state !== 'combat') assert.equal(a.hasMoveTarget, true, 'route is paused, not lost');
  for (let i = 0; i < 40; i++) a._think(.05);
  assert.equal(a.wantFire, true, 'visible close threat sustains the fight, including retreat');
  a.targetVisible = false; a.visualAge = 2;
  assert.equal(a._engageClose(.1), false);
  assert.equal(a._engaging, false);
  assert.ok(a._engageCooldown > 0);
}

for (const reason of ['reload', 'vault', 'suppression', 'muzzle', 'unacquired', 'unseen']) {
  const a = fighter('flank');
  if (reason === 'reload') a.animator.reloading = true;
  if (reason === 'vault') a.vaultT = .3;
  if (reason === 'suppression') a.suppression = 1.3;
  if (reason === 'muzzle') a.phys.lineOfSight = () => false;
  if (reason === 'unacquired') a.hasTarget = false;
  if (reason === 'unseen') a.targetVisible = false;
  assert.equal(a._engageClose(.05), false, reason);
}

// No late/random suppression extension beyond the common visual-memory gate.
{
  const a = fighter(); a.targetVisible = false;
  a.lastKnownAge = TACTICS.suppressFireAge + .01;
  assert.equal(a._canFireAtLastKnown(), false);
  a.lastKnownAge = .2;
  assert.equal(a._canFireAtLastKnown(), true);
  a.lastKnownKind = 'report';
  assert.equal(a._canFireAtLastKnown(), false);
}
// A walkable peek with no firing lane is a failure, not a fallback exposure.
{
  const p = { x: 0, y: 0, z: 0, dx: 0, dz: 1, high: true, component: 1, claimed: -1 };
  const grid = { coverPoints: [p], components: new Map([[1, 1]]),
    project(pos, out) { out.copy(pos); return 1; }, lineOfWalk: () => true };
  const phys = { MASK: { SIGHT: 1 }, lineOfSight: () => false };
  const cover = new CoverMap(grid, phys), out = new THREE.Vector3(), threat = new THREE.Vector3(0, 1.5, 12);
  assert.equal(cover.peekOffset(p, threat, 1.5, out), null);
  assert.equal(cover.pick(out, threat, { id: 1 }), null, 'protected but blind cover is not a fighting position');
  assert.equal(p.claimed, -1);
  cover.protects = () => true;
  phys.lineOfSight = () => true;
  grid.lineOfWalk = () => false;
  assert.equal(cover.pick(out, threat, { id: 1 }), null, 'clear sight cannot override a blocked exposure walk');
  grid.lineOfWalk = () => true;
  assert.equal(cover.pick(out, threat, { id: 1 }), p);
  const a = fighter(); a.cover = p; a.lastKnown.copy(threat); a.ai.cover = cover;
  a._rejectCover('peek-muzzle');
  const opts = { id: 1, failed: a._failedCovers, now: a._combatClock };
  assert.equal(cover.pick(out, threat, opts), null, 'do not immediately reclaim a failed firing position');
  opts.now += TACTICS.failedCoverAge + .1;
  assert.equal(cover.pick(out, threat, opts), p, 'failure memory is bounded');
  opts.now = 0;
  assert.equal(cover.pick(out, threat.clone().add(new THREE.Vector3(5, 0, 0)), opts), p,
    'a materially different threat invalidates the old failure');
}

// Travel must not consume the firing window; blocked execution still times out.
{
  const a = fighter();
  a.cover = { x: 0, y: 0, z: 0, high: true };
  a.firePos.set(1.9, 0, 0); a.peeking = true; a.peekTimer = TACTICS.peekFireTime;
  for (let i = 0; i < 20; i++) {
    a.peekTimer -= .1;
    a._updatePeek(null, a.lastKnown, 8, .1);
  }
  assert.equal(a.peeking, true);
  assert.ok(Math.abs(a.peekTimer - TACTICS.peekFireTime) < 1e-6);
  for (let i = 0; i < 10 && a.cover; i++) a._updatePeek(null, a.lastKnown, 8, .1);
  assert.equal(a.cover, null);
  assert.equal(a.coverFailure, 'peek-execution');
}
console.log('ok smoke-ai-pressure');
