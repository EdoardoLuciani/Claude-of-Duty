import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

import * as THREE from 'three';

import { AttachmentQueries, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/attachment-queries.js';
import { AiSystem } from '../../src/ai/index.ts';
import { SurfaceNav } from '../../src/ai/nav.ts';
import { TACTICS, acquireSeconds } from '../../src/ai/tuning.ts';
import { EventBus } from '../../src/core/registry.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { makeAgent, makeAi } from '../../tools/lib/agent-fixture.mjs';
import { loadMap, physicsFor } from '../../tools/nav240/fixtures.mjs';
import { bakePhysicsNav } from '../../tools/worldgen/nav-bake.js';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function fixture(height = 1.78, barrier = 0, width = 5) {
  const scene = new THREE.Scene();
  if (barrier) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, barrier, 0.15));
    wall.position.set(0, barrier / 2, 9);
    scene.add(wall);
  }
  const phys = physicsFor(scene),
    player = { position: v(0, 0, 10), height };
  player.hitbox = phys.addCollider({
    shape: 'capsule',
    layer: phys.LAYER.PLAYER,
    owner: player,
    radius: 0.3,
  });
  player.hitbox.setSegment(0, 0.3, 10, 0, Math.max(0.3, height - 0.3), 10, 0.3);
  const ai = makeAi();
  ai.ctx = { peek: (id) => (id === 'player' ? player : null) };
  ai.playerPosition = AiSystem.prototype.playerPosition;
  const a = makeAgent({ ai, phys, yaw: 0 });
  ai.agents.push(a);
  return {
    a,
    ai,
    phys,
    player,
    scene,
    dispose() {
      phys.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    },
  };
}

// Each stance can expose a damageable head without exposing the chest.
for (const height of [1.78, 1.12, 0.7]) {
  const f = fixture(height, height * 0.62 + 0.16),
    { a, ai, phys, player } = f;
  assert.equal(phys.lineOfSight(a.eye, ai.playerPosition(v())), false);
  const head = ai.playerPosition(v(), 1);
  const distance = a.eye.distanceTo(head);
  a._sense(0.01);
  assert.equal(a.targetVisible, true);
  assert.ok(a.lastKnown.distanceTo(head) < 1e-8, 'remember and aim at the exposed point');
  assert.ok(
    Math.abs(a.awareness - 0.01 / acquireSeconds(distance, 0)) < 1e-8,
    'one awareness increment, not one per ray'
  );
  assert.equal(a.hasTarget, false, 'no instant acquisition');
  for (let i = 0; i < 60; i++) a._sense(1 / 60);
  assert.equal(a.hasTarget, true);
  const dir = a.lastKnown.clone().sub(a.eye).normalize(),
    eye = a.eye;
  const hit = phys.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 20, phys.LAYER.PLAYER);
  assert.equal(hit.actor, player, 'exposed sample must be damageable, not a cosmetic camera point');
  a.yaw = Math.PI;
  a.hasTarget = false;
  a.alertness = 0;
  a._sense(0.1);
  assert.equal(a.targetVisible, false, 'head fallback cannot bypass the view cone');
  f.dispose();
}
{
  const f = fixture(1.78, 1.25);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 0.15));
  beam.position.set(0, 2.55, 9);
  f.scene.add(beam);
  f.scene.updateMatrixWorld(true);
  f.phys.addStatic(beam, 'concrete');
  f.phys.rebuildStatic();
  f.a._sense(0.01);
  assert.equal(
    f.a.targetSample,
    2,
    'upper-body slit remains visible when both chest and head are blocked'
  );
  assert.equal(f.a.targetVisible, true);
  f.dispose();
}
{
  const f = fixture(1.78, 4);
  for (let i = 0; i < 100; i++) f.a._sense(0.02);
  assert.equal(f.a.hasTarget, false, 'fully concealed body never acquires');
  assert.equal(f.a.targetVisible, false);
  f.dispose();
}
{
  const f = fixture();
  let rays = 0;
  const los = f.phys.lineOfSight.bind(f.phys);
  f.phys.lineOfSight = (...args) => {
    rays++;
    return los(...args);
  };
  f.a._sense(0.01);
  assert.equal(rays, 1, 'open chest preserves the common one-ray cost');
  f.player.hitbox.enabled = false;
  assert.ok(
    f.ai.playerPosition(v()),
    'non-perception callers still need the last physical position after death'
  );
  f.a._sense(0.01);
  assert.equal(f.a.targetVisible, false, 'disabled/dead hitbox is not a target');
  f.dispose();
}
// Gameplay lean, not camera bob/recoil, moves the damageable upper capsule.
{
  const f = fixture(1.78, 3, 0.5),
    { player, a, phys } = f;
  player.movement = {
    renderPosition: player.position,
    stance: 'stand',
    leanAmount: 1,
    leanOffsetX: 0.36,
    leanOffsetZ: 0,
  };
  player.health = { dead: false };
  PlayerSystem.prototype._syncHitbox.call(player);
  assert.equal(player.hitbox.ax, 0);
  assert.equal(player.hitbox.bx, 0.36);
  assert.equal(player.hitbox.radius, 0.3, 'do not inflate the player');
  a._sense(0.1);
  assert.equal(a.targetVisible, true, 'a leaning exposed head can be seen');
  const eye = a.eye,
    dir = a.lastKnown.clone().sub(eye).normalize();
  assert.equal(
    phys.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 20, phys.LAYER.PLAYER).actor,
    player
  );
  f.dispose();
}
// Impact spam cannot relocate or refresh a suspect, nor stack penetration exits.
{
  const a = makeAgent({ ai: makeAi() });
  a.hear(v(0, 2, 15), 90, 'gunfire');
  const known = a.lastKnown.clone(),
    until = a._searchUntil;
  a.lastKnownAge = 0.5;
  for (let i = 0; i < 12; i++) a.hearImpact(v(1, 0, 0));
  assert.ok(a.lastKnown.equals(known));
  assert.equal(a.lastKnownKind, 'gunfire');
  assert.equal(a.lastKnownAge, 0.5);
  assert.equal(a._searchUntil, until);
  assert.ok(a.suppression > 0 && a.suppression <= 0.5, 'one bounded danger reaction');
  a.hear(v(20, 0, 0), 40);
  assert.ok(a.lastKnown.equals(known), 'fresh firing origin outranks weaker sounds');
  assert.equal(a.hasTarget, false);
  assert.equal(a._canFireAtLastKnown(), false);
  a.lastKnownAge = TACTICS.gunfireLock + 0.1;
  a.hear(v(20, 0, 0), 40);
  assert.equal(a.lastKnownKind, 'sound', 'sound priority is bounded');
}

// Exercise actual event wiring: impact locations cannot replace a gunshot.
{
  const ai = makeAi(),
    events = new EventBus();
  ai._wireEvents({ events });
  const a = makeAgent({ ai });
  ai.agents.push(a);
  events.emit('weapon:fire', { weapon: 'sniper', origin: v(0, 2, 20), dir: v(0, 0, -1) });
  const known = a.lastKnown.clone();
  events.emit('bullet:impact', { point: v(5, 0, 0) });
  assert.equal(a.lastKnownKind, 'gunfire');
  assert.ok(a.lastKnown.equals(known));
  assert.equal(a.hasTarget, false);
  for (const off of ai._off) off();
}

// Narrow wall: local firing step. Wide wall on flat ground: no local step
// clears it, so investigation must physically route around the obstruction.
for (const width of [1, 14]) {
  const scene = new THREE.Scene();
  for (const [x, y, z, w, h, d] of [
    [0, -0.2, 6, 20, 0.4, 26],
    [0, 0.7, 2, width, 1.4, 0.25],
  ]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }
  const phys = physicsFor(scene),
    bake = await bakePhysicsNav(phys, new THREE.Box3().setFromObject(scene));
  const nav = await SurfaceNav.load(bake.buffer, phys),
    ai = makeAi(nav);
  let shots = 0,
    maxSolves = 0,
    moved = false,
    searched = false;
  ai.onAgentFire = () => {
    shots++;
  };
  const a = makeAgent({
    ai,
    phys,
    position: v(0, 0.02, 0),
    state: 'combat',
    hasTarget: true,
    targetVisible: true,
    lastKnown: v(0, 1.1, 10),
    lastKnownKind: 'visual',
    lastKnownAge: 0,
    visualAge: 0,
    hasGrenade: false,
    ctx: { time: { elapsed: 0 } },
    ammo: 100,
    burstCooldown: 0,
    animator: { muzzleWorld: v(), muzzleDir: v(0, 0, 1), turn() {}, fire() {} },
  });
  ai.agents.push(a);
  a.controller = phys.createCharacter({
    position: a.position,
    radius: a.radius,
    height: a.height,
    stepHeight: 0.45,
  });
  const initial = a.position.clone();
  assert.equal(phys.lineOfSight(a.eye, a.lastKnown), true);
  for (let frame = 0; frame < (width === 1 ? 300 : 1200); frame++) {
    const dt = 1 / 60,
      before = nav.stats.queries;
    ai._pathBudget = 2;
    a.ctx.time.elapsed += dt;
    a.fireCooldown -= dt;
    a.burstCooldown -= dt;
    a.repathTimer -= dt;
    if (a.pathPending) a._goTo(a._pendingDest);
    a._think(dt);
    a._move(dt);
    a.animator.muzzleWorld.copy(a.position).add(v(0, 1.315, 0.6));
    a.animator.muzzleDir.copy(a.lastKnown).sub(a.animator.muzzleWorld).normalize();
    a._shoot(dt);
    if (frame < 40) assert.equal(shots, 0, 'do not shoot through the low wall while settling');
    moved ||= a.combatAction === 'firing-reposition' || (a._firingSearch && a.hasMoveTarget);
    if (a._firingSearch && !searched) {
      a._firingLaneClear = () => true;
      a._think(dt);
      assert.equal(a.state, 'alert', 'one clear frame cannot cancel the recovery route');
      a._firingLaneClear = () => false;
      a._think(dt);
      assert.equal(a._searchLaneTime, 0);
      delete a._firingLaneClear;
      searched = true;
    }
    maxSolves = Math.max(maxSolves, nav.stats.queries - before);
  }
  assert.ok(
    moved && a.position.distanceTo(initial) > 0.5,
    'real character must execute a lateral adjustment'
  );
  assert.ok(shots > 0, 'adjustment must produce actual fire, not merely a new label');
  assert.equal(searched, width > 1, 'only a failed local adjustment needs wider investigation');
  assert.ok(maxSolves <= 2);
  assert.equal(a.relocations, 0);
  assert.ok(
    a._failedCovers.some((f) => f.until > 0 && Math.hypot(f.x - initial.x, f.z - initial.z) < 0.1)
  );
  // Turning/raising alone must not trigger navigation churn.
  a._laneBlockedTime = 0;
  a._repositioning = false;
  a._positionRetry = 0;
  a.phys = { ...phys, MASK: phys.MASK, lineOfSight: () => true };
  a.animator.muzzleDir.set(1, 0, 0);
  a.wantFire = true;
  for (let i = 0; i < 120; i++) a._shoot(1 / 60);
  assert.equal(a._repositioning, false);
  a._laneBlockedTime = 0.6;
  a._shoot(1 / 60);
  assert.ok(a._laneBlockedTime > 0.5, 'one clear/raising frame only decays obstruction history');
  a.animator.reloading = true;
  a._shoot(1 / 60);
  assert.equal(a._laneBlockedTime, 0, 'reload is not a blocked-position failure');
  nav.dispose();
  phys.dispose();
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
}

// Only adapt browser transport; route eligibility uses the production worker.
class NativeWorker {
  constructor() {
    this.thread = new Worker(
      `const { parentPort } = require('node:worker_threads');
      globalThis.self = { postMessage: m => parentPort.postMessage(m) };
      import(${JSON.stringify(new URL('../../src/ai/attachment-worker.js', import.meta.url).href)}).then(() => {
        parentPort.on('message', data => self.onmessage({ data }));
      });`,
      { eval: true }
    );
    this.thread.on('message', (data) => this.onmessage?.({ data }));
    this.thread.on('error', (error) => this.onerror?.({ message: error.message }));
  }
  postMessage(message, transfer) {
    this.thread.postMessage(message, transfer);
  }
  terminate() {
    void this.thread.terminate();
  }
}

// Exact September 27 eye-height clues. Native v2 connects only the first roof;
// the second remains disconnected and must retain visible observation alternatives.
const map = await loadMap(),
  grid = await SurfaceNav.load(map.surfaceRaw, map.physics);
for (const [from, target, reachable] of [
  [[-3.384, 0.091, -3.351], [-5.65, 8.16, 8.512], true],
  [[-12, 0.074, -17.265], [-12.943, 8.165, -6.762], false],
]) {
  const ai = makeAi(grid);
  const a = makeAgent({
    ai,
    phys: map.physics,
    position: v(...from),
    lastKnown: v(...target),
    lastKnownAge: 0,
    lastKnownKind: 'gunfire',
    animator: { muzzleWorld: v(), turn() {} },
  });
  ai.agents.push(a);
  const origin = a.lastKnown.clone(),
    projected = v(),
    start = grid.project(a.position, v());
  const roof = grid.sampleGround(origin.x, origin.z, origin.y, projected);
  assert.ok(start && roof, 'both physical surfaces exist');
  assert.notEqual(
    grid.walkingComponents.get(start),
    grid.walkingComponents.get(roof),
    'historical walking-only roofs remain unreachable'
  );
  assert.equal(
    grid.components.get(start) === grid.components.get(roof),
    reachable,
    'native connectivity is not a walking shortcut'
  );
  a._setState('alert');
  assert.equal(a._observationSearch, !reachable);
  assert.ok(a._searchCount > 0 && a._searchCount <= 3, 'investigation retains bounded candidates');
  assert.equal(a.hasTarget, false);
  assert.equal(a.wantFire, false);
  if (reachable) {
    assert.ok(
      a._searchCand[0].equals(projected),
      'investigate the reachable roof, not a street substitute'
    );
    const foot = v(
      origin.x,
      map.physics.groundHeight(origin.x, origin.z, origin.y) + 0.008,
      origin.z
    );
    assert.ok(origin.y - foot.y > 1, 'the elevated clue is not a valid route foot');
    assert.equal(grid.project(foot, v()), roof);
    const service = (grid.worker = new AttachmentQueries(grid, {
      workerFactory: () => new NativeWorker(),
    }));
    const nativeCheck = grid._checkAttachment;
    grid._checkAttachment = () =>
      assert.fail('full route eligibility must not run on the main thread');
    try {
      await service.start();
      const route = { points: [], ladderSteps: [] },
        deadline = performance.now() + 10000;
      let result,
        pending = 0;
      do {
        result = service.run(
          a.id,
          'route',
          () => grid.findRoute(a.position, foot, route, a),
          a.position
        );
        assert.notEqual(result, NAV_CANCELLED, 'frozen route intent must not be superseded');
        if (result === NAV_PENDING) {
          pending++;
          assert.deepEqual(route, { points: [], ladderSteps: [] }, 'no partial admission');
          assert.ok(performance.now() < deadline, 'bounded worker drain');
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      } while (result === NAV_PENDING);
      assert.ok(pending > 0 && service.stats.submitted > 0, 'actual asynchronous worker proof');
      assert.ok(result > 0, grid.lastReason);
      assert.equal(grid.lastReason, 'complete');
      assert.equal(
        route.ladderSteps.length,
        1,
        'the newly reachable roof requires its native ladder'
      );
      assert.equal(route.ladderSteps[0].direction, 'up');
      assert.ok(
        route.points[result - 1].equals(foot),
        'complete route ends at the physically grounded roof destination'
      );
    } finally {
      grid._checkAttachment = nativeCheck;
      service.dispose();
      grid.worker = null;
    }
  } else
    for (let i = 0; i < a._searchCount; i++) {
      const p = a._searchCand[i],
        eye = p.clone();
      eye.y += a.eyeHeight;
      assert.equal(
        map.physics.lineOfSight(eye, origin, map.physics.MASK.SIGHT),
        true,
        'not a blind point underneath the roof'
      );
      const ref = grid.project(p, v());
      assert.equal(grid.components.get(ref), grid.components.get(start));
    }
  assert.equal(a.wantFire, false);
  assert.ok(a.lastKnown.equals(origin), 'do not replace the elevated clue with a street position');
}
// September 30: a 6.8m cover change proposed a ~99m stair circuit. Check
// selection and the deferred-solve path, then accept a genuinely local move.
for (const deferred of [false, true]) {
  const ai = makeAi(grid),
    from = v(8.182, 9.598, -1.093);
  let pick = { x: 13.188, y: 9.573, z: 3.48 };
  ai.cover = { pick: () => pick, release() {} };
  const a = makeAgent({
    ai,
    phys: map.physics,
    position: from,
    state: 'combat',
    hasTarget: true,
    targetVisible: true,
    lastKnown: v(-13.278, 5.115, -4.621),
    lastKnownKind: 'visual',
    lastKnownAge: 0,
    hasGrenade: false,
  });
  if (deferred) ai._pathBudget = 0;
  const before = grid.stats.queries;
  a._combat(0.016);
  if (deferred) {
    assert.equal(a.pathPending, true);
    assert.equal(grid.stats.queries, before, 'deferral must not solve a path');
    ai._pathBudget = 2;
    a._goTo(a._pendingDest);
  }
  assert.equal(grid.stats.queries - before, 1, 'cost rejection uses the existing solve only');
  assert.equal(a.coverFailure, 'cover-route-cost');
  assert.equal(a.cover, null);
  assert.equal(a.hasMoveTarget || a.pathPending, false);
  assert.ok(
    a._failedCovers.some((f) => f.x === pick.x && f.until > 0),
    'do not immediately retry rejected cover'
  );
  pick = { x: 6.773, y: 9.573, z: -2.676 };
  a.repathTimer = 0;
  ai._pathBudget = 2;
  a._combat(0.016);
  assert.equal(a.cover, pick, 'short physical cover approach still works');
  assert.equal(a.hasMoveTarget, true);
  // A deliberate route is not subject to the ordinary cover limit.
  a.cover = null;
  ai._pathBudget = 2;
  assert.equal(a._goTo(v(13.188, 9.573, 3.48)), true);
}

// Lost personal contact begins a real investigation, without clearing memory,
// chasing the live player, or bouncing back to combat on retained acquisition.
{
  const ai = makeAi(grid);
  const a = makeAgent({
    ai,
    phys: map.physics,
    position: v(10.419, 0.2, 24.284),
    state: 'combat',
    hasTarget: true,
    targetVisible: false,
    lastKnown: v(-5.65, 8.16, 8.512),
    lastKnownKind: 'visual',
    lastKnownAge: TACTICS.suppressFireAge + 0.1,
    visualAge: TACTICS.suppressFireAge + 0.1,
    hasGrenade: false,
    repathTimer: 10,
    ctx: { time: { elapsed: 0 } },
    animator: { muzzleWorld: v() },
    _muzzleBlocked: true,
  });
  const known = a.lastKnown.clone();
  const service = (grid.worker = new AttachmentQueries(grid, {
    workerFactory: () => new NativeWorker(),
  }));
  await service.start();
  a._think(0.016);
  a._shoot(0.016);
  a._updateFireBlock();
  // Lost contact is an asynchronous intent, not an unscoped ladder shortcut.
  // Settle the real candidate/route worker while retaining the exact cue and
  // all original movement, acquisition and no-fire assertions below.
  const deadline = performance.now() + 10000;
  for (let frame = 0; a._searchPending || a.pathPending; frame++) {
    assert.ok(performance.now() < deadline, 'bounded contact-loss admission');
    service.update(frame, new Set([a.id]));
    ai._pathBudget = 2;
    if (a.pathPending) a._goTo(a._pendingDest);
    a._think(0.016);
    assert.equal(a.wantFire, false);
    assert.ok(a.lastKnown.equals(known));
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(a.state, 'alert');
  assert.equal(a.hasTarget, true, 'retain acquisition memory');
  assert.ok(service.stats.submitted > 0, 'real worker admission, not an unscoped success');
  assert.equal(
    a.route.ladderSteps.length,
    1,
    'complete route reaches the connected roof through a ladder'
  );
  assert.ok(known.y - a.moveTarget.y > 1, 'route uses ground, not the floating sighting');
  assert.equal(a.hasMoveTarget, true, 'seek a reachable observation lane');
  assert.ok(a.desiredSpeed > 0);
  assert.equal(a.wantFire, false);
  assert.equal(a._muzzleBlocked, false, 'do not retain a stale obstruction label');
  assert.ok(a.lastKnown.equals(known));
  a._think(0.016);
  assert.equal(a.state, 'alert', 'stale acquisition must not bounce back to combat');
  a.targetVisible = true;
  a.lastKnownAge = a.visualAge = 0;
  const goal = a.moveTarget.clone(),
    queries = grid.stats.queries;
  a.phys = { MASK: { SIGHT: 1 }, lineOfSight: () => false };
  a._think(0.016);
  assert.equal(a.state, 'alert', 'eye contact must not cancel a rifle-blocked approach');
  assert.ok(a.hasMoveTarget && a.moveTarget.equals(goal));
  assert.ok(a.desiredSpeed > 0);
  assert.equal(a.wantFire, false);
  assert.equal(grid.stats.queries, queries, 'continue the existing route without another solve');
  a.phys.lineOfSight = () => true;
  a._think(0.016);
  assert.equal(a.state, 'combat', 'personal contact with a clear rifle lane resumes combat');

  a.hasMoveTarget = true;
  a.pathLen = 1;
  a.pathIndex = 0;
  a.path[0].copy(goal);
  a.targetVisible = false;
  a.lastKnownAge = a.visualAge = TACTICS.suppressFireAge + 0.1;
  a.repathTimer = 10;
  a.desiredSpeed = 0;
  a._think(0.016);
  assert.equal(a.combatAction, 'contact-travel');
  assert.ok(a.hasMoveTarget && a.moveTarget.equals(goal));
  assert.ok(a.desiredSpeed > 0, 'resume a retained route instead of freezing it');
  assert.equal(a.wantFire, false, 'expired sighting still cannot authorize fire');
  assert.equal(grid.stats.queries, queries);
  service.dispose();
  grid.worker = null;
}
grid.dispose();
map.physics.dispose();
console.log('ok smoke-ai-observation');
