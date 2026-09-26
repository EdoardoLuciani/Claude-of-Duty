/**
 * Headless regressions for issue 267.
 *
 *   node tools/smoke-ai-combat.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../src/core/registry.js';
import { AiSystem } from '../src/ai/index.js';
import { Agent, STATE } from '../src/ai/agent.js';
import { Squad } from '../src/ai/squad.js';
import { CoverMap, SurfaceNav } from '../src/ai/nav.js';
import { bakePhysicsNav } from './worldgen/nav-bake.js';
import { synthetic } from './nav240/fixtures.mjs';
import { INTENT, FLUSH_MAX_FAILS } from '../src/ai/intent.js';
import { PhysicsSystem } from '../src/physics/index.js';

const events = new EventBus();
const phys = new PhysicsSystem();
phys.ctx = { events, scene: null, camera: null, time: { alpha: 0, elapsed: 0, dt: 1 / 60 } };
const rng = { float: () => 0.5, range: (a, b) => (a + b) * 0.5, int: (a) => a, gauss: () => 0 };

function makePlayer({ height = 1.78, stance = 'stand' } = {}) {
  const player = {
    isPlayer: true,
    position: new THREE.Vector3(),
    height,
    stance,
    hitbox: phys.addCollider({
      shape: 'capsule', layer: phys.LAYER.PLAYER, surface: 'flesh',
      owner: null, part: 'torso', radius: 0.3,
    }),
  };
  player.hitbox.owner = player;
  const r = 0.3;
  player.hitbox.setSegment(0, r, 0, 0, Math.max(r, height - r), 0, r);
  return player;
}

function makeAi(player) {
  const ai = Object.create(AiSystem.prototype);
  ai.ctx = {
    peek: (id) => (id === 'player' ? player : id === 'physics' ? phys : null),
    events,
    camera: { matrixWorld: new THREE.Matrix4() },
    has: () => false,
    config: { deterministic: true },
  };
  ai._phys = phys;
  ai._v = new THREE.Vector3();
  ai._v2 = new THREE.Vector3();
  ai._v3 = new THREE.Vector3();
  ai.cover = null;
  ai.grid = null;
  ai.agents = [];
  ai.squads = [];
  ai._grenades = [];
  ai.stats = { agents: 0, alive: 0, grenadeHolds: 0, pathsDeferred: 0 };
  return ai;
}

function fireAt(ai, y, endZ = null) {
  const dealt = [];
  const off = events.on('damage:dealt', (e) => dealt.push(e));
  const t = ai._testPlayerHit(
    { weaponDamage: 17, staged: null },
    new THREE.Vector3(0, y, 8),
    new THREE.Vector3(0, 0, -1),
    endZ == null ? null : new THREE.Vector3(0, y, endZ),
  );
  off();
  return { t, n: dealt.length };
}

function stubAgent(over = {}) {
  const a = Object.create(Agent.prototype);
  Object.assign(a, {
    id: 1, alive: true, state: STATE.COMBAT, stateTime: 2,
    hasTarget: true, targetVisible: false,
    lastKnown: new THREE.Vector3(0, 1, 12), lastKnownAge: 0.3,
    lastKnownKind: 'visual',
    position: new THREE.Vector3(),
    cover: { x: 0, y: 0, z: 0, dx: 0, dz: 1, high: false },
    coverPos: new THREE.Vector3(), firePos: new THREE.Vector3(),
    peeking: false, _returning: false, _peekFail: 0, peekTimer: 0, peekSide: 0,
    wantFire: false, crouch: true, aimWeight: 0, desiredSpeed: 0,
    hasMoveTarget: false, pathPending: false, path: [], pathLen: 0, pathIndex: 0,
    moveTarget: new THREE.Vector3(), speed: 0, yaw: 0, targetYaw: 0,
    velocity: new THREE.Vector3(), _steer: new THREE.Vector3(),
    controller: null, grounded: true, vaultCooldown: 0, stuckTimer: 0, stuckHits: 0,
    health: 100, weaponRange: 80,
    hasGrenade: false, grenadeCooldown: 99, role: 'pin', wrapWait: 0, _wrapDone: true,
    repathTimer: 5, suppression: 0, eyeHeight: 1.5, squad: null, rng,
    ai: {
      cover: {
        pick() { return a.cover; },
        protects() { return true; },
        release() {},
        peekOffset(c, _t, _e, out) { out.set(c.x + 0.95, c.y, c.z); return 1; },
      },
      stats: { grenadeHolds: 0 },
    },
    phys: { lineOfSight: () => true, MASK: { SIGHT: 1 } },
    animator: {
      muzzleWorld: new THREE.Vector3(0.95, 1.4, 0.2),
      reloading: false, vaulting: false, turn() {},
    },
    _v: new THREE.Vector3(), _v2: new THREE.Vector3(), _v3: new THREE.Vector3(),
    _eye: new THREE.Vector3(), _dir: new THREE.Vector3(),
  }, over);
  if (over.cover) a.coverPos.set(over.cover.x, over.cover.y, over.cover.z);
  return a;
}

function deadAgent(id, cover) {
  const a = Object.create(Agent.prototype);
  a.id = id;
  a.ai = { cover };
  a.controller = null;
  a.colliders = [];
  a.ragdoll = null;
  a.group = { parent: null };
  a.phys = null;
  a.squad = null;
  a.peeking = false;
  a._returning = false;
  a.wantFire = false;
  return a;
}

/* 1. stance-aware player hits */
for (const s of [
  { stance: 'stand', height: 1.78, through: 1.35, above: 2.2 },
  { stance: 'crouch', height: 1.12, through: 0.6, above: 1.35 },
  { stance: 'prone', height: 0.7, through: 0.35, above: 1.35 },
  { stance: 'slide', height: 1.12, through: 0.55, above: 1.6 },
]) {
  const player = makePlayer({ height: s.height, stance: s.stance === 'slide' ? 'crouch' : s.stance });
  const ai = makeAi(player);
  const body = ai.playerPosition(new THREE.Vector3());
  assert.ok(body.y < s.height + 0.01, `${s.stance} body y=${body.y}`);
  if (s.stance !== 'stand') assert.ok(body.y < 1.2, `${s.stance} must not use 1.35 m`);

  const hit = fireAt(ai, s.through);
  assert.ok(Number.isFinite(hit.t), `${s.stance} ${s.through} m hits`);
  assert.equal(hit.n, 1, `${s.stance} exactly one damage event`);

  const miss = fireAt(ai, s.above);
  assert.equal(miss.t, null, `${s.stance} ${s.above} m misses`);
  assert.equal(miss.n, 0);

  phys.removeCollider(player.hitbox);
}

{
  const player = makePlayer();
  const blocked = fireAt(makeAi(player), 1.2, 4);
  assert.equal(blocked.t, null, 'cover blocks the round');
  assert.equal(blocked.n, 0);
  phys.removeCollider(player.hitbox);
}

/* 2. cover peek is a real exposure */
{
  const low = stubAgent();
  low._combat(0.05);
  assert.equal(low.peeking, true, 'recent contact exposes without hide-LOS');
  assert.ok(low.firePos.distanceTo(low.coverPos) > 0.85);
  assert.equal(low.crouch, false, 'low cover stands to expose');
  assert.equal(low.wantFire, false, 'no shot until at fire pos');
  assert.equal(low.hasMoveTarget, true);

  low.position.copy(low.firePos);
  low._combat(0.05);
  assert.equal(low.wantFire, true, 'cleared muzzle may fire');

  low.phys.lineOfSight = () => false;
  low.peekTimer = 1;
  low._combat(0.05);
  low._updateFireBlock();
  assert.equal(low.peeking, false, 'blocked muzzle abandons');
  assert.equal(low.wantFire, false);
  assert.equal(low._returning, true);
  assert.equal(low.fireBlock, 'muzzle', 'muzzle fail is not relocating');

  const high = stubAgent({ cover: { x: 0, y: 0, z: 0, dx: 0, dz: 1, high: true }, crouch: false });
  high._combat(0.05);
  assert.equal(high.crouch, false, 'high cover stays standing');
  assert.ok(high.firePos.distanceTo(high.coverPos) > 0.85);

  const hide = stubAgent({ peekTimer: 2 });
  hide._combat(0.05);
  assert.equal(hide.peeking, false);
  assert.equal(hide.crouch, true, 'low cover crouches while hidden');

  const walker = stubAgent();
  walker.ai.agents = [walker];
  let fired = 0;
  let closest = Infinity;
  for (let i = 0; i < 240; i++) {
    walker.peekTimer -= 1 / 60;
    walker._think(1 / 60);
    walker._move(1 / 60);
    closest = Math.min(closest, walker.position.distanceTo(walker.firePos));
    if (walker.wantFire) fired++;
  }
  assert.ok(fired > 0, `peek via _move never fired (closest=${closest})`);

  const open = stubAgent({ cover: null, targetVisible: true });
  open.cover = null;
  open._combat(0.05);
  assert.equal(open.wantFire, true, 'no cover still fires at a visible target');
}

/* 3. stale firing intent */
{
  const a = stubAgent({ wantFire: true, hasTarget: false, lastKnownAge: 10 });
  a._think(0.05);
  assert.equal(a.state, STATE.ALERT);
  assert.equal(a.wantFire, false, 'combat → alert clears fire');
  a.stateTime = 13;
  a.patrolPoints = [new THREE.Vector3(1, 0, 0)];
  a.hasMoveTarget = false;
  a.pathPending = false;
  a._think(0.05);
  assert.equal(a.state, STATE.PATROL);
  assert.equal(a.wantFire, false);

  const idle = stubAgent({ wantFire: true, state: STATE.IDLE, hasTarget: false });
  idle._think(0.05);
  assert.equal(idle.wantFire, false);
}

/* 4. peek tokens bound to actual exposure */
{
  const sq = new Squad(rng);
  sq.peekTokens = 1;
  sq.ai = { grid: null, cover: null };
  const a1 = { id: 1, alive: true, cover: {}, state: 'combat' };
  const a2 = { id: 2, alive: true, cover: {}, state: 'combat' };
  const a3 = { id: 3, alive: true, cover: {}, state: 'combat' };
  sq.members = [a1, a2, a3];
  sq.time = 10;
  assert.equal(sq.requestPeek(a1), true);
  assert.equal(sq.requestPeek(a2), false, 'cap holds while a1 is exposed');
  sq.update(0.2);
  assert.equal(sq.peekHolders.has(1), true, 'update must not drop a live exposure');
  assert.equal(sq.requestPeek(a2), false);
  sq.releasePeek(a1);
  assert.equal(sq.requestPeek(a1), false, 'just-exposed member yields');
  assert.equal(sq.requestPeek(a2), true);
  sq.releasePeek(a2);
  sq.time = 12;
  assert.equal(sq.requestPeek(a3), true, 'every member eventually peeks');
  sq.remove(a1);
  assert.equal(sq.peekHolders.has(1), false);

  const ready = stubAgent({ id: 10 });
  const traveler = stubAgent({ id: 11, position: new THREE.Vector3(15, 0, 0) });
  const sq2 = new Squad(rng);
  sq2.peekTokens = 1;
  sq2.ai = { grid: null, cover: null };
  sq2.members = [ready, traveler];
  sq2.time = 10;
  assert.equal(sq2.requestPeek(ready), true);
  sq2.releasePeek(ready);
  sq2.time = 11;
  assert.equal(sq2.requestPeek(ready), true, 'a 15 m traveler must not starve a ready peeker');

  const A = stubAgent({ id: 21, squad: null });
  const B = stubAgent({ id: 22 });
  const sq3 = new Squad(rng);
  sq3.peekTokens = 1;
  sq3.ai = { grid: null, cover: null };
  sq3.add(A);
  sq3.add(B);
  A.squad = sq3;
  B.squad = sq3;
  A.firePos.set(0.95, 0, 0);
  A.position.copy(A.firePos);
  A.peeking = true;
  A.peekTimer = 0;
  sq3.peekHolders.add(A.id);
  A._combat(0.05);
  assert.equal(A._returning, true);
  assert.equal(sq3.peekHolders.has(A.id), true, 'token held while returning');
  assert.equal(sq3.requestPeek(B), false, 'cap holds until the peeker is hidden');
  A.position.copy(A.coverPos);
  A._combat(0.05);
  assert.equal(A._returning, false);
  assert.equal(sq3.peekHolders.has(A.id), false);
}

/* 5. string-pull keeps the corner-cut detour */
{
  const fixture = synthetic(), bake = await bakePhysicsNav(fixture.physics, fixture.bounds);
  const g = await SurfaceNav.load(bake.buffer, fixture.physics);
  const from = new THREE.Vector3(-.6, 0, 2.8), to = new THREE.Vector3(.6, 0, 2.8);
  assert.equal(g.lineOfWalk(from, to), false, 'blocked diagonal is not a walk');
  assert.equal(g.canAttach(from, to), false, 'real collision must reject the direct shortcut');
  const out = [];
  const n = g.findPath(from, to, out);
  assert.ok(n >= 2, `detour survives smoothing (n=${n})`);
  const floor = g.resolvedFloor;
  let prev = from;
  for (let i = 0; i < n; i++) {
    assert.ok(g.project(out[i], new THREE.Vector3()), `wp ${i} blocked`);
    // Execute short capsule links, rather than using a raster walkability oracle.
    const steps = Math.max(1, Math.ceil(prev.distanceTo(out[i]) / .5));
    let start = prev;
    for (let j = 1; j <= steps; j++) {
      const end = prev.clone().lerp(out[i], j / steps);
      assert.ok(g.canAttach(start, end), `segment ${i} cuts a corner`);
      start = end;
    }
    prev = out[i];
  }

  const ai = Object.create(AiSystem.prototype);
  ai.grid = g;
  ai.pathsPerFrame = 2;
  ai._pathBudget = 2;
  ai.stats = { pathsDeferred: 0 };
  assert.ok(ai.requestPath(from, to, []) >= 0);
  assert.equal(ai.lastPathOutcome, 'success');
  ai._pathBudget = 2;
  assert.ok(ai.requestPath(from, to.clone().setY(.1), []) >= 0);
  assert.ok(Math.abs(floor) < .1, 'flat fixture resolves to its ground surface');
  assert.equal(ai.lastPathResFloor, floor, 'resolved floor is the surface, not a small request-height error');
  assert.ok(ai.requestPath(from, to, []) >= 0);
  assert.equal(ai.requestPath(from, to, []), -1);
  assert.equal(ai.lastPathOutcome, 'deferred');
  assert.equal(ai.stats.pathsDeferred, 1);
  ai._pathBudget = 2; // next frame: a genuinely different floor must be rejected
  assert.equal(ai.requestPath(from, to.clone().setY(2), []), 0);
  assert.equal(ai.lastPathOutcome, 'invalid');
  assert.ok(Number.isNaN(ai.lastPathResFloor));
  g.dispose();
}

/* 6. cover reservations on dispose / reset */
{
  const cover = new CoverMap(null, null);
  cover.points = [
    { x: 0, y: 0, z: 0, dx: 0, dz: 1, high: true, claimed: 7, score: 0 },
    { x: 4, y: 0, z: 0, dx: 1, dz: 0, high: false, claimed: 8, score: 0 },
  ];
  deadAgent(7, cover).dispose();
  assert.equal(cover.points[0].claimed, -1);
  assert.equal(cover.points[1].claimed, 8);

  const ai = makeAi(null);
  ai.cover = cover;
  ai.agents = [deadAgent(8, cover)];
  ai.resetForNewGame();
  assert.ok(cover.points.every((p) => p.claimed === -1));
  ai.resetForNewGame();
  assert.ok(cover.points.every((p) => p.claimed === -1));
}

/* 7. flush fallback when the throw cannot execute */
{
  const sq = new Squad(rng);
  sq.ai = { grid: null, cover: null };
  const a = stubAgent({
    hasGrenade: true, grenadeCooldown: 0,
    lastKnown: new THREE.Vector3(0, 0, 15), lastKnownAge: 0.2, squad: sq,
  });
  let thrown = 0;
  a._grenadeUnsafe = () => true;
  a._throwGrenade = () => { thrown++; };
  sq.add(a);
  sq.wantFlush = true;
  sq.planted = true;
  sq.plantAge = 0.4;
  sq.hasContact = true;
  sq.contactAge = 0;
  sq.contact.set(0, 0, 15);
  for (let i = 0; i < FLUSH_MAX_FAILS; i++) {
    a.grenadeCooldown = 0;
    a._combat(0.05);
  }
  assert.ok(sq.flushFails >= FLUSH_MAX_FAILS);
  assert.equal(thrown, 0);
  sq._updateIntent();
  assert.equal(sq.intent, INTENT.WRAP, 'unsafe flush hands off to wrap');

  const g = stubAgent({
    hasGrenade: true, grenadeCooldown: 0,
    lastKnown: new THREE.Vector3(0, 0, 15), lastKnownAge: 0.2,
  });
  let didThrow = 0;
  g._grenadeUnsafe = () => false;
  g._throwGrenade = () => { didThrow++; g.hasGrenade = false; };
  const sq2 = new Squad(rng);
  sq2.ai = { grid: null, cover: null };
  sq2.wantFlush = true;
  g.squad = sq2;
  sq2.add(g);
  g._combat(0.05);
  assert.equal(didThrow, 1, 'a clear throw still executes');
}

// Suppression must not freeze a soldier three metres short of assigned cover.
{
  const a = stubAgent({ state: STATE.SUPPRESSED, suppression: 1.3, scale: 1,
    cover: { x: 3, y: 0, z: 0, high: false }, repathTimer: 0 });
  a._goTo = function (p) { this.moveTarget.copy(p); this.hasMoveTarget = true; return true; };
  a._think(.1);
  assert.equal(a.state, STATE.SUPPRESSED);
  assert.ok(a.desiredSpeed > 0);
  assert.equal(a.crouch, false);
  assert.equal(a.wantFire, false);
  assert.ok(a.moveTarget.distanceTo(a.coverPos) < 1e-8);
  a.position.copy(a.coverPos);
  a._think(.1);
  assert.equal(a.desiredSpeed, 0, 'only stop after reaching protected cover');
  assert.equal(a.crouch, true);
  a.ai.cover.protects = () => false;
  a._think(.1);
  assert.equal(a.cover, null, 'elevated exposure invalidates the cover claim');
  assert.equal(a.state, STATE.COMBAT);
  assert.equal(a.wantFire, false, 'suppression still inhibits firing');
}

console.log('ok  smoke-ai-combat');
