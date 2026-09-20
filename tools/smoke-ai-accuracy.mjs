/**
 * Deterministic accuracy / reaction baselines for issue 276.
 *
 * Separates acquisition, decision-to-fire, aim tracking, dispersion and
 * world occlusion. Unsuppressed, exposed, clear-LOS only — cover and
 * navigation waits are out of scope.
 *
 *   node tools/smoke-ai-accuracy.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../src/core/registry.js';
import { Rng } from '../src/core/rng.js';
import { AiSystem } from '../src/ai/index.js';
import { Agent, STATE } from '../src/ai/agent.js';
import { Animator } from '../src/ai/animator.js';
import { RIG } from '../src/ai/rig.js';
import { COMBAT, BASELINE, acquireSeconds } from '../src/ai/tuning.js';
import { PhysicsSystem } from '../src/physics/index.js';

const DT = 1 / 60;
const SEEDS = [0x51eed01, 0xa11e5, 0xc0ffee];
const MOVE_SPEED = 4.57;

const events = new EventBus();
const phys = new PhysicsSystem();
phys.ctx = { events, scene: null, camera: null, time: { alpha: 0, elapsed: 0, dt: DT } };

const STANCES = {
  stand: 1.78,
  crouch: 1.12,
  prone: 0.7,
};

function inRange(name, value, [lo, hi]) {
  assert.ok(
    value >= lo && value <= hi,
    `${name}=${value.toFixed(3)} outside [${lo}, ${hi}]`,
  );
}

function mean(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function makePlayer(stance = 'stand') {
  const height = STANCES[stance];
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
  syncHitbox(player);
  return player;
}

function syncHitbox(player) {
  const r = 0.3;
  const h = player.height;
  const p = player.position;
  player.hitbox.setSegment(
    p.x, p.y + r, p.z,
    p.x, p.y + Math.max(r, h - r), p.z,
    r,
  );
}

function makeAi(player) {
  const ai = Object.create(AiSystem.prototype);
  const time = { elapsed: 0, dt: DT, frame: 0 };
  ai.ctx = {
    peek: (id) => (id === 'player' ? player : id === 'physics' ? phys : null),
    events,
    camera: { matrixWorld: new THREE.Matrix4() },
    has: () => false,
    config: { deterministic: true },
    time,
  };
  ai._phys = phys;
  ai._v = new THREE.Vector3();
  ai._v2 = new THREE.Vector3();
  ai._v3 = new THREE.Vector3();
  ai.cover = null;
  ai.grid = null;
  ai.agents = [];
  ai.stats = { agents: 0, alive: 0, grenadeHolds: 0, pathsDeferred: 0, friendlyHolds: 0 };
  ai.playerPosition = AiSystem.prototype.playerPosition;
  ai.emitReload = () => {};
  return ai;
}

function makeShooter(ai, dist, rng, over = {}) {
  const a = Object.create(Agent.prototype);
  const muzzleWorld = new THREE.Vector3(0.15, 1.42, dist);
  const muzzleDir = new THREE.Vector3(0, 0, -1);
  Object.assign(a, {
    id: 7, alive: true, state: STATE.IDLE, stateTime: 0,
    hasTarget: false, targetVisible: false, awareness: 0, alertness: 0,
    lastKnown: new THREE.Vector3(), lastKnownAge: Infinity, lastKnownKind: null,
    target: null,
    position: new THREE.Vector3(0, 0, dist),
    yaw: Math.PI, targetYaw: Math.PI,
    eyeHeight: 1.62, viewRange: COMBAT.viewRange,
    viewCos: Math.cos((COMBAT.viewConeDeg * Math.PI) / 180 / 2),
    suppression: 0, health: 100, weaponRange: COMBAT.viewRange,
    fireRate: COMBAT.fireRate, spread: COMBAT.spread, weaponDamage: COMBAT.damage,
    magSize: COMBAT.magSize, ammo: 200,
    burstLeft: 0, fireCooldown: 0, burstCooldown: 0,
    aimTarget: new THREE.Vector3(0, 1.1, dist - 12),
    aimWeight: 1, wantFire: false, crouch: false,
    desiredSpeed: 0, speed: 0, hasMoveTarget: false, pathPending: false,
    path: [], pathLen: 0, pathIndex: 0,
    moveTarget: new THREE.Vector3(), velocity: new THREE.Vector3(),
    _steer: new THREE.Vector3(),
    controller: null, grounded: true, vaultCooldown: 0,
    stuckTimer: 0, stuckHits: 0, radius: 0.34,
    hasGrenade: false, grenadeCooldown: 99, role: 'pin',
    wrapWait: 0, _wrapDone: true, cover: null, repathTimer: 5,
    peeking: false, _returning: false, peekTimer: 9, peekSide: 0,
    coverPos: new THREE.Vector3(), firePos: new THREE.Vector3(),
    _peekFail: 0, _friendlyBlock: 0, _muzzleBlocked: false,
    squad: null, rng, ai, ctx: ai.ctx, phys,
    variantName: 'vanguard',
    animator: {
      muzzleWorld, muzzleDir,
      reloading: false, vaulting: false,
      fire() {}, turn() {}, reload() {},
    },
    _v: new THREE.Vector3(), _v2: new THREE.Vector3(), _v3: new THREE.Vector3(),
    _eye: new THREE.Vector3(), _dir: new THREE.Vector3(),
    _muzzleDir: new THREE.Vector3(),
  }, over);
  if (!ai.agents.includes(a)) ai.agents.push(a);
  return a;
}

function alignMuzzle(a) {
  const o = a.animator.muzzleWorld;
  o.set(a.position.x + 0.15, a.position.y + 1.42, a.position.z);
  a.animator.muzzleDir.copy(a.aimTarget).sub(o);
  if (a.animator.muzzleDir.lengthSq() < 1e-8) a.animator.muzzleDir.set(0, 0, -1);
  else a.animator.muzzleDir.normalize();
}

function aimAt(a) {
  const p = a.ai.playerPosition(a._v3);
  a.aimTarget.set(p.x, p.y + COMBAT.aimChest, p.z);
  alignMuzzle(a);
}

function recordShots(ai) {
  const shots = [];
  ai.onAgentFire = (_agent, origin, dir) => {
    const maxT = 200;
    const wall = phys.raycast(
      origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxT, phys.MASK.WORLD,
    );
    const cap = wall.hit ? wall.distance : maxT;
    const hit = phys.raycast(
      origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, cap, phys.LAYER.PLAYER,
    );
    shots.push({ hit: !!hit.hit, blocked: !!(wall.hit && !hit.hit) });
  };
  return shots;
}

function tickSenseThink(a, dt) {
  a.ctx.time.elapsed += dt;
  a.ctx.time.frame++;
  a.fireCooldown -= dt;
  a.burstCooldown -= dt;
  if (a.lastKnownAge < 1e6) a.lastKnownAge += dt;
  a._sense(dt);
  a._think(dt);
  a._move(dt);
}

function tickFire(a, dt) {
  const want = a.wantFire;
  a.wantFire = false;
  a._shoot(dt);
  a.wantFire = want;
  alignMuzzle(a);
  a._shoot(dt);
}

/* ------------------------------------------------------------------ */
/* 1. acquisition delay matches the tuning formula                     */
/* ------------------------------------------------------------------ */
const acquireRows = [];
for (const dist of [10, 25, 50]) {
  for (const kind of ['alert', 'cold']) {
    const player = makePlayer();
    const ai = makeAi(player);
    const a = makeShooter(ai, dist, new Rng(1), {
      alertness: kind === 'alert' ? 1 : 0,
    });
    let t = 0;
    while (t < 2.5 && !a.hasTarget) {
      tickSenseThink(a, DT);
      t += DT;
    }
    phys.removeCollider(player.hitbox);
    // Alertness becomes 1 on the first visible frame, so the cold term only
    // stretches that frame; the rest of the stare uses the alert delay.
    const expect = acquireSeconds(dist, 1);
    assert.ok(a.hasTarget, `acquire ${dist}m ${kind} never locked`);
    assert.ok(
      Math.abs(t - expect) <= 4 * DT,
      `acquire ${dist}m ${kind} t=${t.toFixed(3)} formula=${expect.toFixed(3)}`,
    );
    inRange(`acquire ${dist}m ${kind}`, t, BASELINE.acquire[dist][kind]);
    acquireRows.push({ dist, kind, t, expect });
  }
}

/* ------------------------------------------------------------------ */
/* 2. dispersion only — perfect muzzle, no aim lag                     */
/* ------------------------------------------------------------------ */
const spreadRows = [];
function spreadRate(dist, stance, seed, n = 220) {
  const player = makePlayer(stance);
  const ai = makeAi(player);
  const a = makeShooter(ai, dist, new Rng(seed), {
    state: STATE.COMBAT, hasTarget: true, wantFire: true, burstLeft: n + 2,
  });
  const shots = recordShots(ai);
  aimAt(a);
  for (let i = 0; i < n; i++) {
    a.fireCooldown = 0;
    a._shoot(0);
  }
  phys.removeCollider(player.hitbox);
  const hits = shots.filter((s) => s.hit).length;
  return hits / shots.length;
}

for (const dist of [10, 25, 50]) {
  const rates = SEEDS.map((s) => spreadRate(dist, 'stand', s));
  const r = mean(rates);
  inRange(`spread stand ${dist}m`, r, BASELINE.spread.stand[dist]);
  spreadRows.push({ dist, stance: 'stand', r });
}
{
  const crouch = mean(SEEDS.map((s) => spreadRate(10, 'crouch', s)));
  const prone = mean(SEEDS.map((s) => spreadRate(10, 'prone', s)));
  inRange('spread crouch 10m', crouch, BASELINE.spread.crouch[10]);
  inRange('spread prone 10m', prone, BASELINE.spread.prone[10]);
  assert.ok(prone < spreadRows[0].r, `prone ${prone.toFixed(3)} !< stand ${spreadRows[0].r.toFixed(3)}`);
  spreadRows.push({ dist: 10, stance: 'crouch', r: crouch }, { dist: 10, stance: 'prone', r: prone });
}

/* suppression widens dispersion */
{
  const player = makePlayer();
  const ai = makeAi(player);
  const a = makeShooter(ai, 10, new Rng(SEEDS[0]), {
    state: STATE.COMBAT, hasTarget: true, wantFire: true, burstLeft: 400,
    suppression: 1,
  });
  const shots = recordShots(ai);
  aimAt(a);
  for (let i = 0; i < 220; i++) {
    a.fireCooldown = 0;
    a._shoot(0);
  }
  phys.removeCollider(player.hitbox);
  const r = shots.filter((s) => s.hit).length / shots.length;
  assert.ok(r < spreadRows[0].r - 0.04, `suppressed ${r.toFixed(3)} should miss more than ${spreadRows[0].r.toFixed(3)}`);
}

/* ------------------------------------------------------------------ */
/* 3. aimed fire — lerp + wobble + spread, muzzle follows aimTarget    */
/* ------------------------------------------------------------------ */
function runEncounter({ dist, stance, move, seed, seconds = 2.4 }) {
  const player = makePlayer(stance);
  const ai = makeAi(player);
  const a = makeShooter(ai, dist, new Rng(seed), { burstCooldown: 0 });
  const shots = recordShots(ai);
  let t = 0;
  let first = null;
  const vx = move ? MOVE_SPEED : 0;
  while (t < seconds) {
    if (vx) {
      player.position.x += vx * DT;
      syncHitbox(player);
    }
    tickSenseThink(a, DT);
    tickFire(a, DT);
    t += DT;
    if (first == null && shots.length) first = t;
  }
  phys.removeCollider(player.hitbox);
  const after = first == null ? [] : shots.slice(0);
  const hits = after.filter((s) => s.hit).length;
  return {
    ttfs: first,
    shots: after.length,
    hits,
    rate: after.length ? hits / after.length : 0,
  };
}

const aimedRows = [];
for (const dist of [10, 25]) {
  const runs = SEEDS.map((s) => runEncounter({ dist, stance: 'stand', move: false, seed: s }));
  const ttfs = mean(runs.map((r) => r.ttfs));
  const rate = mean(runs.map((r) => r.rate));
  for (const r of runs) {
    assert.ok(r.ttfs != null, `no shot at ${dist}m seed`);
    assert.ok(r.shots >= 8, `${dist}m only ${r.shots} shots`);
  }
  inRange(`ttfs ${dist}m`, ttfs, BASELINE.ttfs[dist]);
  inRange(`aimed stand still ${dist}m`, rate, BASELINE.aimed.standStill[dist]);
  aimedRows.push({ dist, stance: 'stand', move: false, ttfs, rate });
}
{
  const crouchRuns = SEEDS.map((s) => runEncounter({ dist: 10, stance: 'crouch', move: false, seed: s }));
  const proneRuns = SEEDS.map((s) => runEncounter({ dist: 10, stance: 'prone', move: false, seed: s }));
  const moveRuns = SEEDS.map((s) => runEncounter({ dist: 10, stance: 'stand', move: true, seed: s }));
  const crouch = mean(crouchRuns.map((r) => r.rate));
  const prone = mean(proneRuns.map((r) => r.rate));
  const moving = mean(moveRuns.map((r) => r.rate));
  inRange('aimed crouch 10m', crouch, BASELINE.aimed.crouchStill[10]);
  inRange('aimed prone 10m', prone, BASELINE.aimed.proneStill[10]);
  inRange('aimed stand move 10m', moving, BASELINE.aimed.standMove[10]);
  assert.ok(moving < aimedRows[0].rate - 0.08, 'relocation must cut the hit rate');
  aimedRows.push(
    { dist: 10, stance: 'crouch', move: false, rate: crouch, ttfs: mean(crouchRuns.map((r) => r.ttfs)) },
    { dist: 10, stance: 'prone', move: false, rate: prone, ttfs: mean(proneRuns.map((r) => r.ttfs)) },
    { dist: 10, stance: 'stand', move: true, rate: moving, ttfs: mean(moveRuns.map((r) => r.ttfs)) },
  );
}

// Decision-to-fire is the gap after acquisition; it must stay a beat, not a stall.
assert.ok(
  aimedRows[0].ttfs - acquireRows[0].t <= 0.12,
  `10m decision ${aimedRows[0].ttfs.toFixed(3)} - acquire ${acquireRows[0].t.toFixed(3)}`,
);

/* ------------------------------------------------------------------ */
/* 4. animated bore residual, separate from spread                     */
/* ------------------------------------------------------------------ */
function aimIkDeg(dist) {
  const { bones, root } = RIG.createSkeleton();
  const group = new THREE.Group();
  group.add(root);
  group.position.set(0, 0, dist);
  group.rotation.y = Math.PI;
  group.updateMatrixWorld(true);
  const an = new Animator(RIG, bones, { rng: new Rng(2) });
  const target = new THREE.Vector3(0, 1.1, 0);
  an.setState({ clip: 'idle', aimTarget: target, lookTarget: target, aimWeight: 1 });
  for (let i = 0; i < 36; i++) {
    group.updateMatrixWorld(true);
    an.update(DT, i * DT);
  }
  const to = target.clone().sub(an.muzzleWorld);
  const m = to.length();
  assert.ok(m > 1, `muzzle did not leave the shooter (d=${m.toFixed(3)})`);
  to.multiplyScalar(1 / m);
  const dot = Math.max(-1, Math.min(1, an.muzzleDir.dot(to)));
  return (Math.acos(dot) * 180) / Math.PI;
}

const ikRows = [];
for (const dist of [10, 25, 50]) {
  const deg = aimIkDeg(dist);
  assert.ok(deg < 4, `aim IK ${dist}m is ${deg.toFixed(2)} deg off — barrel never settled`);
  ikRows.push({ dist, deg });
}

/* ------------------------------------------------------------------ */
/* 5. world occlusion — seeing through a wall must not authorize hits  */
/* ------------------------------------------------------------------ */
{
  const wallPhys = new PhysicsSystem();
  const wall = new Float32Array([
    -2, 0, 5, 2, 0, 5, 2, 2.4, 5,
    -2, 0, 5, 2, 2.4, 5, -2, 2.4, 5,
  ]);
  wallPhys.staticWorld.addTriangles(wall, 2, 'concrete', wallPhys.LAYER.STATIC, 'wall');
  wallPhys.staticWorld.build();

  const player = {
    isPlayer: true,
    position: new THREE.Vector3(),
    height: 1.78,
    stance: 'stand',
    hitbox: wallPhys.addCollider({
      shape: 'capsule', layer: wallPhys.LAYER.PLAYER, surface: 'flesh',
      owner: null, part: 'torso', radius: 0.3,
    }),
  };
  player.hitbox.owner = player;
  player.hitbox.setSegment(0, 0.3, 0, 0, 1.48, 0, 0.3);

  const ai = makeAi(player);
  ai._phys = wallPhys;
  ai.ctx.peek = (id) => (id === 'player' ? player : id === 'physics' ? wallPhys : null);
  const a = makeShooter(ai, 10, new Rng(3), { phys: wallPhys });

  let t = 0;
  while (t < 1.2 && !a.hasTarget) {
    tickSenseThink(a, DT);
    t += DT;
  }
  assert.equal(a.hasTarget, false, 'must not acquire through a wall');
  assert.equal(a.targetVisible, false);

  a.hasTarget = true;
  a.state = STATE.COMBAT;
  a.wantFire = true;
  a.burstLeft = 40;
  a.alertness = 1;
  const hits = [];
  ai.onAgentFire = (_ag, origin, dir) => {
    const wallHit = wallPhys.raycast(
      origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 200, wallPhys.MASK.WORLD,
    );
    const cap = wallHit.hit ? wallHit.distance : 200;
    const playerHit = wallPhys.raycast(
      origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, cap, wallPhys.LAYER.PLAYER,
    );
    if (playerHit.hit) hits.push(playerHit);
  };
  aimAt(a);
  for (let i = 0; i < 30; i++) {
    a.fireCooldown = 0;
    a._shoot(0);
  }
  assert.equal(hits.length, 0, 'rounds must not pass the wall');
  wallPhys.removeCollider(player.hitbox);
}

/* ------------------------------------------------------------------ */
/* invariants — do not chase hit rate with damage or fat capsules      */
/* ------------------------------------------------------------------ */
assert.equal(COMBAT.damage, 17, 'do not inflate damage');
assert.equal(COMBAT.magSize, 30);
assert.ok(COMBAT.spread >= 0.018 && COMBAT.spread <= 0.04, `spread ${COMBAT.spread} is laser or shotgun`);
assert.ok(COMBAT.aimTrack <= 12, 'aim tracking must stay human');
assert.ok(COMBAT.firstBurstMin >= 0.1, 'no instant first shot on spawn');

const report = {
  acquire: acquireRows.map((r) => ({ ...r, t: +r.t.toFixed(3), expect: +r.expect.toFixed(3) })),
  spread: spreadRows.map((r) => ({ ...r, r: +r.r.toFixed(3) })),
  aimed: aimedRows.map((r) => ({
    ...r,
    rate: +r.rate.toFixed(3),
    ttfs: r.ttfs != null ? +r.ttfs.toFixed(3) : null,
  })),
  aimIkDeg: ikRows.map((r) => ({ dist: r.dist, deg: +r.deg.toFixed(2) })),
};
console.log(JSON.stringify(report, null, 2));
console.log('ok  smoke-ai-accuracy');
