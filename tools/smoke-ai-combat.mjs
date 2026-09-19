/**
 * Headless regressions for issue 267: player hit detection, cover peeking,
 * stale fire intent, squad peek tokens, nav smoothing, cover reservations,
 * and grenade-flush fallback.
 *
 *   node tools/smoke-ai-combat.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../src/core/registry.js';
import { AiSystem } from '../src/ai/index.js';
import { Agent, STATE } from '../src/ai/agent.js';
import { Squad } from '../src/ai/squad.js';
import { NavGrid, CoverMap } from '../src/ai/nav.js';
import {
  INTENT, FLUSH_MAX_FAILS, decideIntent,
} from '../src/ai/intent.js';
import { PhysicsSystem } from '../src/physics/index.js';

const events = new EventBus();
const phys = new PhysicsSystem();
phys.ctx = { events, scene: null, camera: null, time: { alpha: 0, elapsed: 0, dt: 1 / 60 } };

function makePlayer(opts) {
  const {
    x = 0, y = 0, z = 0, height = 1.78, stance = 'stand',
  } = opts;
  const player = {
    isPlayer: true,
    position: new THREE.Vector3(x, y, z),
    height,
    stance,
    eyePosition: new THREE.Vector3(x, y + (stance === 'prone' ? 0.4 : stance === 'crouch' ? 1.02 : 1.66), z),
    hitbox: null,
    nearMiss: 0,
    onNearMiss() { this.nearMiss++; },
  };
  player.hitbox = phys.addCollider({
    shape: 'capsule',
    layer: phys.LAYER.PLAYER,
    surface: 'flesh',
    owner: player,
    part: 'torso',
    radius: 0.3,
  });
  const r = 0.3;
  player.hitbox.setSegment(x, y + r, z, x, y + Math.max(r, height - r), z, r);
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
  const off = events.on('damage:dealt', (e) => dealt.push({ amount: e.amount, target: e.target }));
  const origin = new THREE.Vector3(0, y, 8);
  const dir = new THREE.Vector3(0, 0, -1);
  const end = endZ == null ? null : new THREE.Vector3(0, y, endZ);
  const t = ai._testPlayerHit({ weaponDamage: 17, staged: null }, origin, dir, end);
  off();
  return { t, dealt };
}

/* ======================================================================== */
/* 1. stance-aware player hits                                              */
/* ======================================================================== */

{
  const stances = [
    { stance: 'stand', height: 1.78, through: 1.35, through2: 0.35, above: 2.2 },
    { stance: 'crouch', height: 1.12, through: 0.6, through2: 0.4, above: 1.35 },
    { stance: 'prone', height: 0.7, through: 0.35, through2: 0.45, above: 1.35 },
    { stance: 'slide', height: 1.12, through: 0.55, through2: 0.4, above: 1.6 },
  ];
  for (const s of stances) {
    const player = makePlayer({ height: s.height, stance: s.stance === 'slide' ? 'crouch' : s.stance });
    const ai = makeAi(player);
    const body = ai.playerPosition(new THREE.Vector3());
    assert.ok(body.y < s.height + 0.01, `${s.stance} body y=${body.y} above capsule`);
    if (s.stance === 'prone' || s.stance === 'crouch' || s.stance === 'slide') {
      assert.ok(body.y < 1.2, `${s.stance} must not use the standing 1.35 m point (y=${body.y})`);
    }

    const hit = fireAt(ai, s.through);
    assert.ok(Number.isFinite(hit.t), `${s.stance} shot at ${s.through} m must hit`);
    assert.equal(hit.dealt.length, 1, `${s.stance} through-body: exactly one damage event`);

    const hit2 = fireAt(ai, s.through2);
    assert.ok(Number.isFinite(hit2.t), `${s.stance} shot at ${s.through2} m must hit`);
    assert.equal(hit2.dealt.length, 1, `${s.stance} second through-body: one event`);

    const miss = fireAt(ai, s.above);
    assert.equal(miss.t, null, `${s.stance} shot at ${s.above} m must miss`);
    assert.equal(miss.dealt.length, 0, `${s.stance} above-body: no damage`);

    phys.removeCollider(player.hitbox);
  }

  // Solid cover between muzzle and player: world impact closer than the body.
  {
    const player = makePlayer({ height: 1.78, stance: 'stand' });
    const ai = makeAi(player);
    const blocked = fireAt(ai, 1.2, 4);
    assert.equal(blocked.t, null, 'cover in front of the player blocks the round');
    assert.equal(blocked.dealt.length, 0, 'cover: no damage');
    phys.removeCollider(player.hitbox);
  }
}

/* ======================================================================== */
/* 2. cover peek executes a real exposure                                   */
/* ======================================================================== */

function combatAgent(over = {}) {
  const cover = over.cover ?? { x: 0, y: 0, z: 0, dx: 0, dz: 1, high: false };
  const a = Object.create(Agent.prototype);
  Object.assign(a, {
    id: 1,
    alive: true,
    state: STATE.COMBAT,
    stateTime: 2,
    hasTarget: true,
    targetVisible: false,
    lastKnown: new THREE.Vector3(0, 1, 12),
    lastKnownAge: 0.3,
    position: new THREE.Vector3(0, 0, 0),
    cover,
    coverPos: new THREE.Vector3(cover.x, cover.y, cover.z),
    firePos: new THREE.Vector3(),
    peeking: false,
    _returning: false,
    _peekFail: 0,
    peekTimer: 0,
    peekSide: 0,
    wantFire: false,
    crouch: true,
    aimWeight: 0,
    desiredSpeed: 0,
    hasMoveTarget: false,
    pathPending: false,
    path: [],
    pathLen: 0,
    pathIndex: 0,
    moveTarget: new THREE.Vector3(),
    health: 100,
    weaponRange: 80,
    hasGrenade: false,
    grenadeCooldown: 99,
    role: 'pin',
    wrapWait: 0,
    _wrapDone: true,
    repathTimer: 5,
    suppression: 0,
    eyeHeight: 1.5,
    squad: null,
    rng: { float: () => 0.01, range: (lo, hi) => (lo + hi) * 0.5, int: (lo) => lo },
    ai: {
      cover: {
        pick() { return cover; },
        release() {},
        peekOffset(c, threat, eyeH, out) {
          out.set(c.x + 0.95, c.y, c.z);
          return 1;
        },
      },
      stats: { grenadeHolds: 0, friendlyHolds: 0 },
    },
    phys: { lineOfSight: () => true, MASK: { SIGHT: 1 } },
    animator: {
      muzzleWorld: new THREE.Vector3(0.95, 1.4, 0.2),
      reloading: false,
      vaulting: false,
    },
    _v: new THREE.Vector3(),
    _v2: new THREE.Vector3(),
    _v3: new THREE.Vector3(),
    _eye: new THREE.Vector3(),
    _dir: new THREE.Vector3(),
  }, over);
  return a;
}

{
  const low = combatAgent();
  low._combat(0.05);
  assert.equal(low.peeking, true, 'recent contact starts an exposure even without hide-LOS');
  assert.ok(low.firePos.distanceTo(low.coverPos) > 0.85, 'fire pos sits outside hide arrival');
  assert.equal(low.crouch, false, 'low cover stands up to expose');
  assert.equal(low.wantFire, false, 'must not shoot until the body is at the fire pos');
  assert.equal(low.hasMoveTarget, true, 'exposure is a real step, not a flag');
  assert.ok(low.pathLen === 1 && low.path[0].distanceTo(low.firePos) < 1e-6);

  low.position.copy(low.firePos);
  low._combat(0.05);
  assert.equal(low.peeking, true);
  assert.equal(low.wantFire, true, 'cleared muzzle at fire pos is allowed to shoot');
  assert.equal(low.crouch, false);

  low.phys.lineOfSight = () => false;
  low.peekTimer = 1;
  low._combat(0.05);
  assert.equal(low.peeking, false, 'blocked muzzle abandons the exposure');
  assert.equal(low.wantFire, false);
  assert.equal(low._returning, true);

  const high = combatAgent({
    cover: { x: 0, y: 0, z: 0, dx: 0, dz: 1, high: true },
    crouch: false,
  });
  high.coverPos.set(0, 0, 0);
  high._combat(0.05);
  assert.equal(high.peeking, true);
  assert.equal(high.crouch, false, 'high cover stays standing');
  assert.ok(high.firePos.distanceTo(high.coverPos) > 0.85);

  const hide = combatAgent({ peekTimer: 2, peeking: false });
  hide._combat(0.05);
  assert.equal(hide.peeking, false);
  assert.equal(hide.crouch, true, 'low cover crouches while hidden');
  assert.equal(hide.wantFire, false);
}

/* ======================================================================== */
/* 3. stale firing intent                                                   */
/* ======================================================================== */

{
  const a = combatAgent({ wantFire: true, hasTarget: false, lastKnownAge: 10 });
  a._think(0.05);
  assert.equal(a.state, STATE.ALERT);
  assert.equal(a.wantFire, false, 'combat → alert clears fire');
  a.stateTime = 13;
  a.patrolPoints = [new THREE.Vector3(1, 0, 0)];
  a.hasMoveTarget = false;
  a.pathPending = false;
  a._think(0.05);
  assert.equal(a.state, STATE.PATROL);
  assert.equal(a.wantFire, false, 'alert → patrol stays silent');

  const idle = combatAgent({ wantFire: true });
  idle.state = STATE.IDLE;
  idle.hasTarget = false;
  idle._think(0.05);
  assert.equal(idle.wantFire, false);

  const shots = [];
  const shooter = combatAgent({
    wantFire: true,
    state: STATE.ALERT,
    hasTarget: false,
    lastKnownAge: 10,
    aimTarget: new THREE.Vector3(),
    animator: {
      reloading: false,
      vaulting: false,
      muzzleWorld: new THREE.Vector3(),
      muzzleDir: new THREE.Vector3(0, 0, 1),
      fire() { shots.push(1); },
    },
    burstLeft: 3,
    fireCooldown: 0,
    burstCooldown: 0,
    ammo: 30,
    fireRate: 10,
    spread: 0,
    suppression: 0,
    ai: { onAgentFire() { shots.push(1); }, stats: { friendlyHolds: 0 } },
    rng: { gauss: () => 0, int: () => 3, range: (lo, hi) => (lo + hi) * 0.5, float: () => 0 },
    _muzzleDir: new THREE.Vector3(),
    _friendlyBlock: 0,
    ctx: { time: { elapsed: 0 } },
  });
  shooter._shoot(0.05);
  assert.equal(shots.length, 0, '_shoot refuses outside combat');
}

/* ======================================================================== */
/* 4. peek tokens bound to actual exposure                                  */
/* ======================================================================== */

{
  const rng = { float: () => 0.5, range: (lo, hi) => (lo + hi) * 0.5 };
  const sq = new Squad(rng);
  sq.peekTokens = 1;
  const a1 = { id: 1, alive: true, cover: {}, state: 'combat' };
  const a2 = { id: 2, alive: true, cover: {}, state: 'combat' };
  const a3 = { id: 3, alive: true, cover: {}, state: 'combat' };
  sq.members = [a1, a2, a3];
  sq.time = 10;
  assert.equal(sq.requestPeek(a1), true);
  assert.equal(sq.requestPeek(a2), false, 'cap holds while a1 is exposed');
  sq.peekTimer = 0;
  sq.update(0.2);
  assert.equal(sq.peekHolders.has(1), true, 'timer must not drop a live exposure');
  assert.equal(sq.requestPeek(a2), false, 'cap still holds across the timer');
  sq.releasePeek(a1);
  assert.equal(sq.requestPeek(a1), false, 'just-exposed member yields the slot');
  assert.equal(sq.requestPeek(a2), true, 'next member gets the token');
  sq.releasePeek(a2);
  sq.time = 12;
  assert.equal(sq.requestPeek(a3), true, 'every eligible member eventually peeks');

  sq.releasePeek(a3);
  a1.alive = false;
  sq.remove(a1);
  assert.equal(sq.peekHolders.has(1), false, 'removal drops the token');
}

/* ======================================================================== */
/* 5. string-pull keeps the corner-cut detour                               */
/* ======================================================================== */

function makeGrid(nx, nz, cell, blocked) {
  const g = new NavGrid({}, {
    cell,
    radius: 0.36,
    bounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: (nx - 0.5) * cell, y: 2, z: (nz - 0.5) * cell },
    },
  });
  g.flags.fill(1);
  g.floor.fill(0);
  g.walkableCount = nx * nz;
  for (const [ix, iz] of blocked) {
    g.flags[g.index(ix, iz)] = 0;
    g.walkableCount--;
  }
  return g;
}

{
  // 2x2: (0,1) blocked. A* forbids (0,0)→(1,1); smoothing must not restore it.
  const g = makeGrid(2, 2, 1, [[0, 1]]);
  const from = { x: 0, y: 0, z: 0 };
  const to = { x: 1, y: 0, z: 1 };
  assert.equal(g.lineOfWalk(from, to), false, 'diagonal between blocked neighbours is not a walk');
  const out = [];
  const n = g.findPath(from, to, out);
  assert.ok(n >= 2, `detour must survive smoothing (n=${n})`);
  for (let i = 0; i < n; i++) {
    const ix = g.cellX(out[i].x), iz = g.cellZ(out[i].z);
    assert.equal(g.walkable(ix, iz), true, `waypoint ${i} in blocked cell`);
  }
  // Follow the route as a 0.36 m character: no blocked cell, no teleport.
  let x = from.x, z = from.z;
  let prevIx = g.cellX(x), prevIz = g.cellZ(z);
  for (let i = 0; i < n; i++) {
    const wx = out[i].x, wz = out[i].z;
    const d = Math.hypot(wx - x, wz - z);
    const steps = Math.max(1, Math.ceil(d / 0.1));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const px = x + (wx - x) * t, pz = z + (wz - z) * t;
      const ix = g.cellX(px), iz = g.cellZ(pz);
      assert.equal(g.walkable(ix, iz), true, 'character centre entered a blocked cell');
      if (ix !== prevIx && iz !== prevIz) {
        assert.ok(
          g.walkable(prevIx, iz) && g.walkable(ix, prevIz),
          'followed path cut a blocked corner'
        );
      }
      prevIx = ix;
      prevIz = iz;
    }
    x = wx; z = wz;
  }

  const ai = Object.create(AiSystem.prototype);
  ai.grid = g;
  ai.pathsPerFrame = 2;
  ai._pathBudget = 2;
  ai.stats = { pathsDeferred: 0 };
  const p0 = [], p1 = [], p2 = [];
  assert.ok(ai.requestPath(from, to, p0) >= 0);
  assert.ok(ai.requestPath(from, to, p1) >= 0);
  assert.equal(ai.requestPath(from, to, p2), -1, 'production budget of 2 solves per frame');
  assert.equal(ai.stats.pathsDeferred, 1);
}

/* ======================================================================== */
/* 6. cover reservations on dispose / reset                                 */
/* ======================================================================== */

{
  const cover = new CoverMap(null, null);
  cover.points = [
    { x: 0, y: 0, z: 0, dx: 0, dz: 1, high: true, claimed: 7, score: 0 },
    { x: 4, y: 0, z: 0, dx: 1, dz: 0, high: false, claimed: 8, score: 0 },
  ];
  const agent = Object.create(Agent.prototype);
  agent.id = 7;
  agent.ai = { cover };
  agent.controller = null;
  agent.colliders = [];
  agent.ragdoll = null;
  agent.group = { parent: null };
  agent.phys = null;
  agent.squad = null;
  agent.dispose();
  assert.equal(cover.points[0].claimed, -1, 'dispose releases the living claim');
  assert.equal(cover.points[1].claimed, 8);

  const ai = makeAi(null);
  ai.cover = cover;
  const living = Object.create(Agent.prototype);
  living.id = 8;
  living.ai = { cover };
  living.controller = null;
  living.colliders = [];
  living.ragdoll = null;
  living.group = { parent: null };
  living.phys = null;
  living.squad = null;
  ai.agents = [living];
  ai.resetForNewGame();
  assert.equal(cover.points[0].claimed, -1);
  assert.equal(cover.points[1].claimed, -1, 'reset clears leftover claims');
  ai.resetForNewGame();
  assert.equal(cover.points.every((p) => p.claimed === -1), true, 'repeated reset stays clean');
}

/* ======================================================================== */
/* 7. flush fallback when the throw cannot execute                          */
/* ======================================================================== */

{
  const blocked = decideIntent({
    planted: true, plantAge: 0.2, lastKnownAge: 0.2, cluster: null, hasGrenade: true,
    flushFails: FLUSH_MAX_FAILS,
  });
  assert.equal(blocked.intent, INTENT.WRAP);
  assert.equal(blocked.why, 'flush-blocked');

  const clear = decideIntent({
    planted: true, plantAge: 0.2, lastKnownAge: 0.2, cluster: null, hasGrenade: true,
    flushFails: 0,
  });
  assert.equal(clear.intent, INTENT.FLUSH);
  assert.equal(clear.wantFlush, true);

  const rng = { float: () => 0.5, range: (lo, hi) => (lo + hi) * 0.5 };
  const sq = new Squad(rng);
  sq.ai = { grid: null, cover: null };
  const a = combatAgent({
    hasGrenade: true,
    grenadeCooldown: 0,
    lastKnown: new THREE.Vector3(0, 0, 15),
    lastKnownAge: 0.2,
    position: new THREE.Vector3(0, 0, 0),
    squad: sq,
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
  assert.ok(sq.flushFails >= FLUSH_MAX_FAILS, `flushFails=${sq.flushFails}`);
  assert.equal(thrown, 0, 'unsafe flush must not throw');
  sq._updateIntent();
  assert.equal(sq.intent, INTENT.WRAP, 'repeated unsafe flush hands off to wrap');

  const g = combatAgent({
    hasGrenade: true,
    grenadeCooldown: 0,
    lastKnown: new THREE.Vector3(0, 0, 15),
    lastKnownAge: 0.2,
    position: new THREE.Vector3(0, 0, 0),
  });
  let didThrow = 0;
  g._grenadeUnsafe = () => false;
  g._throwGrenade = () => { didThrow++; g.hasGrenade = false; };
  const sq2 = new Squad(rng);
  sq2.wantFlush = true;
  sq2.flushUsed = false;
  g.squad = sq2;
  sq2.add(g);
  g._combat(0.05);
  assert.equal(didThrow, 1, 'a clear throw still executes');
  assert.equal(g.hasGrenade, false);
}

console.log('ok  smoke-ai-combat');
