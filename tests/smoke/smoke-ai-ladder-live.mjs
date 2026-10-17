import assert from 'node:assert/strict';

import { BoxGeometry, Group, Vector3 } from 'three';

import { Agent, STATE, EVIDENCE } from '../../src/ai/agent.ts';
import { AttachmentQueries } from '../../src/ai/attachment-queries.js';
import { ladderMoveBudget } from '../../src/ai/ladder.ts';
import { SurfaceNav } from '../../src/ai/nav.ts';
import { VARIANTS } from '../../src/ai/soldier.ts';
import { Rng } from '../../src/core/rng.ts';
import { makeAi } from '../../tools/lib/agent-fixture.mjs';
import { NativeWorker } from '../../tools/lib/attachment-worker-fixture.mjs';
import { loadMap } from '../../tools/nav240/fixtures.mjs';

// Browser transport adapter only; queries execute the actual production worker.
const f = await loadMap(),
  nav = await SurfaceNav.load(f.surfaceRaw, f.physics);
const service = (nav.worker = new AttachmentQueries(nav, {
  profile: true,
  workerFactory: () => new NativeWorker(),
}));
const ai = makeAi(nav),
  geometry = new BoxGeometry();
let player = null,
  frame = 0;
Object.assign(ai, {
  grid: nav,
  root: new Group(),
  playerPosition: () => null,
  rng: new Rng(347),
  ctx: {
    get: () => f.physics,
    peek: (id) => (id === 'physics' ? f.physics : id === 'player' ? player : null),
    time: { elapsed: 0, frame: 0 },
    events: { emit() {} },
  },
});
ai.variant = (name) => ({ geometry, materials: [], variant: VARIANTS[name], weapon: null });
const calls = [],
  checkLadder = service.checkLadder.bind(service);
service.checkLadder = (descriptor, direction, foot, cursor, options) => {
  const result = checkLadder(descriptor, direction, foot, cursor, options);
  calls.push({
    kind: service.current.kind,
    descriptor,
    direction,
    foot: { ...foot },
    cursor: { ...cursor },
    options: { ...options },
    result,
  });
  return result;
};
const v = (p) => new Vector3().copy(p);
function actor(from, variant = 'vanguard') {
  const a = new Agent(ai, { position: from, variant, silentDeath: true });
  a.state = STATE.PATROL;
  a.controller.probeGround();
  a.desiredSpeed = 1.5;
  ai.agents.push(a);
  // Every position write after construction must be a native collision sweep.
  a.controller.setPosition = a.controller.teleport = () => assert.fail('live relocation');
  const move = a.controller.move.bind(a.controller);
  a.controller.move = (...args) => {
    assert.equal(a.controller.mask, f.physics.MASK.CHARACTER);
    return move(...args);
  };
  const height = a.controller.setHeight.bind(a.controller);
  a.controller.setHeight = (h) => {
    assert.ok(h >= a.height, 'no capsule shrink');
    return height(h);
  };
  return a;
}
function remove(a) {
  a.dispose();
  ai.agents.splice(ai.agents.indexOf(a), 1);
}
async function tick(a, { brain = false, search = false } = {}) {
  ai.ctx.time.elapsed += 1 / 60;
  ai.ctx.time.frame = ++frame;
  service.update(frame, new Set(ai.agents.filter((o) => o.alive).map((o) => o.id)));
  ai._pathBudget = 2;
  const live = a.ladder,
    travel = live?.travel,
    y = a.controller.position.y;
  if (a.pathPending) a._goTo(a._pendingDest);
  if (brain) a.update(1 / 60);
  else if (search) {
    if (!a.ladder) a._think(1 / 60);
    a._move(1 / 60);
    a._drive(1 / 60);
  } else {
    a.desiredSpeed = 1.5;
    a._move(1 / 60);
    a._tickNoProgress(1 / 60);
    a._drive(1 / 60);
  }
  a.syncHitboxes();
  if (live)
    assert.ok(
      Math.abs(live.travel - travel - Math.abs(a.position.y - y)) < 1e-9,
      'animation travel counts actual native vertical metres, continuously across resume'
    );
  assert.equal(a.relocations, 0);
  assert.deepEqual(a.group.position, a.position, 'visual root follows native foot');
  await new Promise((resolve) => setTimeout(resolve, 1));
}
async function until(a, predicate, label, limit = 1800, options) {
  for (let n = 0; n < limit; n++) {
    if (predicate()) return;
    await tick(a, options);
  }
  assert.fail(
    `${label}: ${JSON.stringify({
      foot: a.position,
      index: a.pathIndex,
      pending: a.pathPending,
      reason: a.pathReason,
      ladder: a.ladder && { status: a.ladder.status, cursor: a.ladder.motor?.cursor },
    })}`
  );
}
const results = [];
try {
  await service.start();
  for (const d of nav.ladders)
    for (const direction of ['up', 'down'])
      for (const variant of Object.keys(VARIANTS)) {
        const from = v(d.points[direction === 'up' ? 0 : 3]).addScaledVector(v(d.normal), 0.2);
        const goal = v(d.points[direction === 'up' ? 3 : 0]).addScaledVector(v(d.normal), 0.6);
        const callStart = calls.length,
          a = actor(from, variant),
          snapshot = JSON.stringify(a.route);
        a._goTo(goal);
        assert.equal(a.pathPending, true);
        assert.equal(JSON.stringify(a.route), snapshot, 'pending atomic');
        await until(a, () => !!a.ladder?.motor, `${d.id}/${direction} motor`);
        const l = a.ladder,
          c = a.controller;
        const admitted = calls.slice(callStart);
        for (const kind of ['path', 'ladder']) {
          const proof = admitted.findLast((call) => call.kind === kind && call.result === true);
          assert.ok(proof, `${kind} explicitly requested and awaited a valid proof`);
          assert.equal(proof.descriptor, d);
          assert.equal(proof.direction, direction);
          assert.deepEqual(proof.foot, d.points[direction === 'up' ? 0 : 3]);
          assert.deepEqual(proof.cursor, { segment: 0, distance: 0, moves: 0, pendingTime: 0 });
          assert.equal(proof.options.radius, a.radius);
          assert.equal(proof.options.height, a.height);
          assert.equal(proof.options.maxMoves, ladderMoveBudget(d));
        }
        const live = admitted.findLast((call) => call.kind === 'ladder');
        assert.equal(live.options.stepHeight, 0.42);
        assert.equal(live.options.snapDistance, 0.32);
        assert.ok(c && c.height === a.height && c.radius === a.radius);
        assert.equal(live.options.maxIterations, c.maxIterations);
        assert.equal(live.options.mask, c.mask);
        assert.ok(
          a.position.distanceTo(v(d.points[direction === 'up' ? 0 : 3])) <= 1e-6,
          'exact native entry'
        );
        assert.equal(ai.ladderClaims.get(d.id), a);
        const foot = a.position.clone(),
          cursor = JSON.stringify(l.motor.cursor),
          travel = a.animator.climbTravel;
        for (let i = 0; i < 8; i++) a.update(0);
        assert.deepEqual(a.position, foot);
        assert.equal(JSON.stringify(l.motor.cursor), cursor);
        assert.equal(a.animator.climbTravel, travel);
        assert.equal(ai.ladderClaims.get(d.id), a);
        // Direct entry points cannot bypass gameplay guards, even if wantFire is forced.
        a.state = STATE.COMBAT;
        a.wantFire = true;
        a.ammo = 0;
        a.hasGrenade = true;
        a.hasTarget = true;
        a.lastKnownKind = EVIDENCE.VISUAL;
        a.lastKnownAge = 0;
        a.lastKnown.copy(a.position).addScaledVector(v(d.normal), 2);
        a.targetVisible = true;
        a.suppression = 0;
        a.grenadeCooldown = 0;
        const muzzleOk = a._muzzleOk,
          grenadeUnsafe = a._grenadeUnsafe,
          throwGrenade = a._throwGrenade;
        a._muzzleOk = () => true;
        a._grenadeUnsafe = () => false;
        a._throwGrenade = () => assert.fail('ladder grenade admitted');
        a._shoot(1 / 60);
        a._tryGrenade(goal, 12);
        assert.equal(a.ammo, 0);
        assert.equal(a.hasGrenade, true);
        assert.equal(a.animator.reloading, false);
        assert.equal(a._engageClose(1 / 60), false);
        a._muzzleOk = muzzleOk;
        a._grenadeUnsafe = grenadeUnsafe;
        a._throwGrenade = throwGrenade;
        a.state = STATE.PATROL;
        a.suppress(10);
        a._combat(1 / 60);
        a._think(1 / 60);
        assert.equal(a.ladder, l);
        assert.equal(a._rollback(), false);
        await until(a, () => !a.ladder, `${d.id}/${direction} supported exit`);
        assert.equal(a.animator.climbing, false);
        assert.equal(ai.ladderClaims.has(d.id), false);
        assert.equal(c.stepHeight, 0.42);
        assert.equal(c.snapDistance, 0.32);
        assert.ok(a.grounded);
        assert.ok(a._safeSurface);
        await until(
          a,
          () => !a.hasMoveTarget && !a.pathPending,
          `${d.id}/${direction} walking goal`
        );
        assert.ok(a.position.distanceTo(goal) < 0.5);
        assert.ok(
          Math.hypot(
            a.position.x - d.points[direction === 'up' ? 3 : 0].x,
            a.position.z - d.points[direction === 'up' ? 3 : 0].z
          ) > 0.1,
          'actual post-exit walking, not endpoint arrival'
        );
        results.push({
          id: d.id,
          direction,
          variant,
          foot: a.position.toArray(),
          relocations: a.relocations,
        });
        remove(a);
      }
  const d = nav.ladders[0],
    lower = v(d.points[0]),
    upper = v(d.points[3]),
    normal = v(d.normal);
  const start = (direction = 'up') => {
    const a = actor(v(d.points[direction === 'up' ? 0 : 3]).addScaledVector(normal, 0.2));
    a._goTo(v(d.points[direction === 'up' ? 3 : 0]).addScaledVector(normal, 0.6));
    return a;
  };
  const shaft = (a) => a.ladder?.motor?.phase === 'shaft' && a.ladder.motor.cursor.distance > 0.2;
  function playerAt(point, yOffset = 0) {
    if (player) f.physics.removeCollider(player.hitbox);
    const hitbox = f.physics.addCollider({
      shape: 'capsule',
      layer: f.physics.LAYER.PLAYER,
      radius: 0.3,
      owner: { isPlayer: true },
    });
    hitbox.setSegment(
      point.x,
      point.y + yOffset + 0.3,
      point.z,
      point.x,
      point.y + yOffset + 1.48,
      point.z
    );
    player = { hitbox, position: point, height: 1.78 };
  }
  function clearPlayer() {
    if (player) f.physics.removeCollider(player.hitbox);
    player = null;
  }
  // Player entry blocking is height-sensitive and ground waits poll at intent cadence.
  playerAt(lower, 10);
  let a = start();
  assert.equal(ai.ladderClear(a, d), true, 'different floor does not occupy this shaft/landing');
  playerAt(lower);
  await until(a, () => !!a.ladder, 'entry waiting');
  const waitingFoot = a.position.clone();
  let attempts = 0;
  const claim = ai.claimLadder.bind(ai);
  ai.claimLadder = (...args) => {
    attempts++;
    return claim(...args);
  };
  for (let i = 0; i < 120; i++) await tick(a);
  assert.ok(attempts <= 6, 'bounded ground retries, not a per-frame busy loop');
  assert.deepEqual(a.position, waitingFoot);
  assert.equal(ai.ladderClaims.size, 0);
  clearPlayer();
  ai.claimLadder = claim;
  await until(a, () => shaft(a), 'unblocked entry climbs');
  // A newly occupied landing freezes the exact native cursor/pose/claim, even
  // after the bounded wait becomes explicitly blocked. No fake arrival/release.
  playerAt(upper);
  const blockedFoot = a.position.clone(),
    blockedCursor = JSON.stringify(a.ladder.motor.cursor);
  const blockedTravel = a.animator.climbTravel;
  const pausedWait = a.ladder.wait,
    pausedRetry = a.ladder.retry;
  for (let i = 0; i < 8; i++) a.update(0);
  assert.equal(a.ladder.wait, pausedWait);
  assert.equal(a.ladder.retry, pausedRetry);
  assert.equal(JSON.stringify(a.ladder.motor.cursor), blockedCursor);
  for (let i = 0; i < 180; i++) await tick(a);
  assert.equal(a.ladder.status, 'blocked');
  assert.equal(ai.ladderClaims.get(d.id), a);
  assert.deepEqual(a.position, blockedFoot);
  assert.equal(JSON.stringify(a.ladder.motor.cursor), blockedCursor);
  assert.equal(a.animator.climbTravel, blockedTravel);
  assert.equal(a.hasMoveTarget, true);
  const changedGoal = upper.clone().addScaledVector(normal, 0.6);
  a._goTo(changedGoal);
  a._stepTo(lower);
  a._setState(STATE.SUPPRESSED);
  assert.equal(a.ladder.deferred, true);
  assert.equal(a.ladder.motor.phase, 'shaft');
  clearPlayer();
  await until(a, () => !a.ladder, 'resume exact held cursor', 1000, { brain: true });
  await until(a, () => !a.pathPending && !a.hasMoveTarget, 'changed objective actual-foot replan');
  assert.ok(a.position.distanceTo(changedGoal) < 0.5);
  remove(a);

  // Both live contenders must finish without deleting the owner to free its landing.
  for (const d of nav.ladders)
    for (const direction of ['up', 'down']) {
      const normal = v(d.normal);
      const entry = direction === 'up' ? 0 : 3,
        exit = 3 - entry;
      const first = actor(v(d.points[entry]).addScaledVector(normal, 0.2));
      const firstGoal = v(d.points[exit]).addScaledVector(normal, 0.6);
      first._goTo(firstGoal);
      await until(first, () => shaft(first), 'contended owner enters shaft');
      const second = actor(v(d.points[exit]).addScaledVector(normal, 0.2), 'breacher');
      const secondGoal = v(d.points[entry]).addScaledVector(normal, 0.6);
      second._goTo(secondGoal);
      await until(second, () => !!second.ladder, 'opposite contender arrives');
      assert.equal(ai.ladderClaims.get(d.id), first, 'waiter cannot steal the shaft');
      assert.equal(second.ladder.claimed, false);
      for (let frame = 0; frame < 1800; frame++) {
        for (const agent of [first, second]) {
          await tick(agent, { brain: true });
          assert.ok(!(first.ladder?.claimed && second.ladder?.claimed), 'one shaft owner');
          if (
            Math.abs(first.position.y - second.position.y) < Math.min(first.height, second.height)
          )
            assert.ok(
              Math.hypot(
                first.position.x - second.position.x,
                first.position.z - second.position.z
              ) >=
                first.radius + second.radius,
              'contenders never pass through each other'
            );
        }
        if (
          !first.ladder &&
          !second.ladder &&
          !first.pathPending &&
          !second.pathPending &&
          first.position.distanceTo(firstGoal) < 0.5 &&
          second.position.distanceTo(secondGoal) < 0.5
        )
          break;
      }
      for (const [agent, goal] of [
        [first, firstGoal],
        [second, secondGoal],
      ]) {
        assert.ok(!agent.ladder, 'contention resolves without deleting an actor');
        assert.ok(agent.position.distanceTo(goal) < 0.5, 'original nearby objective is retained');
        remove(agent);
      }
      assert.equal(ai.ladderClaims.size, 0);
    }

  // Replacing a nonempty live route while fresh worker proofs are unresolved
  // leaves both arrays and every retained vector/step identity untouched.
  a = start();
  await until(a, () => !a.pathPending && a.hasMoveTarget, 'old complete route');
  const routeSnapshot = JSON.stringify(a.route),
    oldPoints = a.path.slice(),
    oldSteps = a.route.ladderSteps.slice();
  service.clear();
  a._goTo(a.moveTarget);
  assert.equal(a.pathPending, true);
  assert.equal(JSON.stringify(a.route), routeSnapshot);
  assert.ok(oldPoints.every((point, i) => point === a.path[i]));
  assert.ok(oldSteps.every((step, i) => step === a.route.ladderSteps[i]));
  remove(a);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    JSON.stringify(a.route),
    routeSnapshot,
    'cancelled reply cannot publish into the old route'
  );

  // An approach vault already in flight keeps its native owner until it lands;
  // merely advancing to an entry index must not start a second movement owner.
  a = start();
  await until(a, () => !a.pathPending && a.hasMoveTarget, 'vault approach route');
  a.pathIndex = a.route.ladderSteps[0].entryIndex;
  const moveVault = a._moveVault;
  let vaultMoves = 0;
  a.vaultT = 0;
  a._moveVault = () => {
    vaultMoves++;
  };
  a._move(1 / 60);
  assert.equal(vaultMoves, 1);
  assert.equal(a.ladder, null);
  a.vaultT = -1;
  a._moveVault = moveVault;
  remove(a);

  // A changed live controller profile cannot use only the original route proof.
  // Force a fresh key and dispose while that actual worker response is pending.
  a = start();
  await until(a, () => !a.pathPending && a.hasMoveTarget, 'route before profile change');
  a.controller.maxIterations = 6;
  await until(
    a,
    () => a.ladder?.status === 'proof' && service.jobs.size > 0,
    'pending exact changed-profile entry'
  );
  assert.equal(a.ladder.motor, null);
  const id = a.id,
    disposedFoot = a.position.clone();
  a.dispose();
  a.update(1 / 60);
  assert.deepEqual(a.position, disposedFoot);
  assert.equal(a.alive, false);
  remove(a);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok([...service.jobs.values()].every((job) => job.scope.actor !== id));
  assert.equal(ai.ladderClaims.size, 0);

  // Collision revision/replacement inhibit old proofs and retain ownership.
  a = start();
  await until(a, () => shaft(a), 'revision shaft');
  const revisionFoot = a.position.clone(),
    oldMotor = a.ladder.motor;
  f.physics.staticWorld.version++;
  await tick(a);
  assert.equal(oldMotor.status, 'failed');
  assert.deepEqual(a.position, revisionFoot);
  assert.equal(ai.ladderClaims.get(d.id), a);
  await until(
    a,
    () => !!a.ladder?.motor && a.ladder.motor !== oldMotor,
    'fresh revision/cursor worker proof'
  );
  const replacementFoot = a.position.clone();
  ai.grid = null;
  for (let i = 0; i < 30; i++) await tick(a);
  assert.deepEqual(a.position, replacementFoot);
  assert.equal(ai.ladderClaims.get(d.id), a);
  ai.grid = nav;
  await until(
    a,
    () => !!a.ladder?.motor && a.ladder.motor.status === 'active',
    'replacement restored/revalidated'
  );
  // Native external disturbance is not repaired from the old cursor or checkpoint.
  a.controller.move(normal.x * 0.02, 0, normal.z * 0.02);
  a.position.copy(a.controller.position);
  await tick(a);
  const failedFoot = a.position.clone(),
    failedTravel = a.animator.climbTravel;
  for (let i = 0; i < 90; i++) await tick(a);
  assert.equal(a.ladder.status, 'blocked');
  assert.equal(a.ladder.motor, null);
  assert.deepEqual(a.position, failedFoot);
  assert.equal(a.animator.climbTravel, failedTravel);
  assert.equal(a._rollback(), false);
  assert.equal(ai.ladderClaims.get(d.id), a);
  remove(a);

  // Health and live bone hitboxes remain real while all attack admissions are off.
  a = start();
  await until(a, () => shaft(a), 'death shaft');
  assert.ok(a.colliders.length > 0 && a.colliders.every((c) => c.enabled && Number.isFinite(c.ay)));
  const health = a.health;
  a.applyDamage(3, 'torso', a.position.clone());
  assert.equal(a.health, health - 3);
  let releases = 0;
  const release = ai.releaseLadder.bind(ai);
  ai.releaseLadder = (agent) => {
    releases++;
    release(agent);
  };
  a.applyDamage(1000, 'head', a.position.clone());
  assert.equal(a.alive, false);
  assert.ok(a.ragdoll, 'current-pose native ragdoll');
  assert.equal(a.colliders.length, 0);
  assert.equal(ai.ladderClaims.size, 0);
  remove(a);
  assert.equal(releases, 1, 'death then dispose releases once');
  ai.releaseLadder = release;

  a = start();
  await until(a, () => shaft(a), 'restart shaft');
  ai.ctx.config = { deterministic: true };
  ai.squads = [];
  ai._grenades = [];
  ai.resetForNewGame();
  assert.equal(ai.agents.length, 0);
  assert.equal(ai.ladderClaims.size, 0);
  assert.equal(service.jobs.size, 0);
  assert.equal(a.ladder, null);
  assert.equal(a.animator.climbing, false);

  // Normal sound investigation, not a diagnostic _goTo, chooses a complete
  // ladder route from its retained cue and executes through the same live owner.
  a = actor(lower.clone().addScaledVector(normal, 0.2));
  a.state = STATE.ALERT;
  a.lastKnown.copy(upper);
  a.lastKnownKind = EVIDENCE.SOUND;
  a.lastKnownAge = 0;
  a._beginSearch();
  await until(a, () => !!a.ladder?.motor, 'normal brain sound search chooses ladder', 1800, {
    search: true,
  });
  await until(a, () => !a.ladder, 'normal search supported exit', 1000, { search: true });
  assert.ok(Math.abs(a.position.y - upper.y) < 0.04);
  remove(a);
  console.log(
    'Live controls: height/player entry and blocked exit; bounded/FIFO claims; objective/pause; pending dispose; revision/replacement; native off-trajectory fail-closed; live damage/death/ragdoll/restart; normal sound search passed'
  );

  const checks = service.samples.filter((s) => s.type === 'query' && s.key?.kind === 'ladder');
  assert.ok(checks.length >= 36, 'worker-proven routes reused at identical live entry only');
  for (const { key } of checks) assert.equal(key.maxMoves, ladderMoveBudget(key.descriptor));
  console.log(
    'AI live ladder: 36 actual Agent/controller/baked-world/production-worker climbs, pause/fire/native-entry/postgoal passed',
    results
  );
} finally {
  for (const a of ai.agents.slice()) remove(a);
  nav.dispose();
  f.physics.dispose();
  geometry.dispose();
}
