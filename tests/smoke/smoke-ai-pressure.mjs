import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeAgent, makeAi } from '../../tools/lib/agent-fixture.mjs';
import { TACTICS } from '../../src/ai/tuning.js';
import { CoverMap } from '../../src/ai/nav.js';
import { Squad } from '../../src/ai/squad.js';

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
// A combat label (or suppression) isn't covering fire for someone else's move.
{
  const holder = fighter(), mover = fighter(); mover.id = 2;
  const sq = new Squad(holder.rng); sq.add(holder); sq.add(mover);
  assert.equal(sq.canFlank(mover), false);
  holder.wantFire = true;
  assert.equal(sq.canFlank(mover), true);
  for (const field of ['_muzzleBlocked', 'reloading', '_friendlyBlock']) {
    if (field === 'reloading') holder.animator.reloading = true;
    else holder[field] = 1;
    assert.equal(sq.canFlank(mover), false, field);
    holder.animator.reloading = false; holder._muzzleBlocked = false; holder._friendlyBlock = 0;
  }
  holder.suppression = 1.3;
  assert.equal(sq.canFlank(mover), false);
  holder.suppression = 0; sq.holder = holder;
  assert.equal(sq.canFlank(holder), false, 'the designated holder cannot abandon support');
}

// A fresh squad report can start one climb, never grant a personal target.
{
  const holder = fighter(), climber = fighter(); climber.id = 2;
  climber.hasTarget = climber.targetVisible = false;
  climber.lastKnownKind = 'report';
  const sq = new Squad(holder.rng); sq.add(holder); sq.add(climber);
  sq.ai = climber.ai;
  const point = { x: 8, y: 3.5, z: 12, high: true };
  let picks = 0;
  sq.ai.cover = { pick(_from, _target, opts) { picks++; assert.equal(opts.elevated, true); return point; }, release() {} };
  climber._goTo = function (p) {
    this.path = [this.position.clone(), new THREE.Vector3().copy(p)]; this.pathLen = 2;
    this.moveTarget.copy(p); this.hasMoveTarget = true; return true;
  };
  holder.wantFire = true; sq.holder = holder; sq.hasContact = true;
  sq.contact.copy(holder.lastKnown); sq.contactAge = 0;
  sq._updateElevation(TACTICS.elevatedCheck);
  assert.equal(sq.elevated, climber);
  assert.equal(climber.hasTarget, false);
  assert.equal(climber._tryElevation(.1), true);
  assert.equal(climber.combatAction, 'elevated-travel');
  assert.equal(climber.wantFire, false);
  sq._updateElevation(.1);
  assert.equal(picks, 1, 'one active assignment, no repeated route/cover requests');
  holder.wantFire = false;
  sq._updateElevation(TACTICS.elevatedSupportGrace + .1);
  assert.equal(sq.elevated, null, 'unsupported climb is reassessed');
  assert.equal(climber.hasMoveTarget, false);
  assert.equal(climber.coverFailure, 'elevated-reassess');
  holder.wantFire = true; sq.contactAge = TACTICS.elevatedContactAge + 1;
  sq._updateElevation(10);
  assert.equal(sq.elevated, null, 'stale contact cannot start a climb');
  sq.contactAge = 0;
  sq._updateElevation(10);
  assert.equal(sq.elevated, climber);
  climber.path[0].set(100, 0, 100);
  assert.equal(climber._tryElevation(.1), false);
  assert.equal(climber.coverFailure, 'elevated-route-cost');
  assert.equal(climber.cover, null, 'complete but tactically excessive paths are rejected');
}
console.log('ok smoke-ai-pressure');
