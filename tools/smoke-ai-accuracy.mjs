/**
 * Deterministic accuracy / reaction baselines for issue 276.
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
const HEIGHT = { stand: 1.78, crouch: 1.12, prone: 0.7 };

const events = new EventBus();
const phys = new PhysicsSystem();
phys.ctx = { events, scene: null, camera: null, time: { alpha: 0, elapsed: 0, dt: DT } };

function inRange(name, value, [lo, hi]) {
  assert.ok(value >= lo && value <= hi, `${name}=${value.toFixed(3)} outside [${lo}, ${hi}]`);
}

function mean(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function makePlayer(stance = 'stand', world = phys) {
  const height = HEIGHT[stance];
  const player = {
    isPlayer: true, position: new THREE.Vector3(), height, stance,
    hitbox: world.addCollider({
      shape: 'capsule', layer: world.LAYER.PLAYER, surface: 'flesh',
      owner: null, part: 'torso', radius: 0.3,
    }),
  };
  player.hitbox.owner = player;
  syncHitbox(player);
  return player;
}

function syncHitbox(player) {
  const r = 0.3, h = player.height, p = player.position;
  player.hitbox.setSegment(p.x, p.y + r, p.z, p.x, p.y + Math.max(r, h - r), p.z, r);
}

function makeAi(player, world = phys) {
  const ai = Object.create(AiSystem.prototype);
  ai.ctx = {
    peek: (id) => (id === 'player' ? player : id === 'physics' ? world : null),
    events, camera: { matrixWorld: new THREE.Matrix4() }, has: () => false,
    config: { deterministic: true }, time: { elapsed: 0, dt: DT, frame: 0 },
  };
  ai._phys = world;
  ai._v = new THREE.Vector3();
  ai.cover = null;
  ai.grid = null;
  ai.agents = [];
  ai.stats = { friendlyHolds: 0, grenadeHolds: 0 };
  ai.playerPosition = AiSystem.prototype.playerPosition;
  ai.emitReload = () => {};
  return ai;
}

function makeShooter(ai, dist, rng, over = {}) {
  const a = Object.create(Agent.prototype);
  Object.assign(a, {
    id: 7, alive: true, state: STATE.IDLE, stateTime: 0,
    hasTarget: false, targetVisible: false, awareness: 0, alertness: 0,
    lastKnown: new THREE.Vector3(), lastKnownAge: Infinity, lastKnownKind: null,
    target: null, position: new THREE.Vector3(0, 0, dist),
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
    squad: null, rng, ai, ctx: ai.ctx, phys: ai._phys, variantName: 'vanguard',
    animator: {
      muzzleWorld: new THREE.Vector3(0.15, 1.42, dist),
      muzzleDir: new THREE.Vector3(0, 0, -1),
      reloading: false, vaulting: false, fire() {}, turn() {}, reload() {},
    },
    _v: new THREE.Vector3(), _v2: new THREE.Vector3(), _v3: new THREE.Vector3(),
    _eye: new THREE.Vector3(), _dir: new THREE.Vector3(),
    _muzzleDir: new THREE.Vector3(),
  }, over);
  ai.agents.push(a);
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

function recordShots(ai, world = phys) {
  const shots = [];
  ai.onAgentFire = (_a, origin, dir) => {
    const wall = world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 200, world.MASK.WORLD);
    const cap = wall.hit ? wall.distance : 200;
    const hit = world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, cap, world.LAYER.PLAYER);
    shots.push(!!hit.hit);
  };
  return shots;
}

function dumpShots(a, n) {
  aimAt(a);
  for (let i = 0; i < n; i++) {
    a.fireCooldown = 0;
    a._shoot(0);
  }
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

function hitRate(shots) {
  return shots.length ? shots.filter(Boolean).length / shots.length : 0;
}

/* 1. acquisition */
let acquire10 = 0;
for (const dist of [10, 25, 50]) {
  const player = makePlayer();
  const ai = makeAi(player);
  const a = makeShooter(ai, dist, new Rng(1), { alertness: 1 });
  let t = 0;
  while (t < 2.5 && !a.hasTarget) {
    tickSenseThink(a, DT);
    t += DT;
  }
  phys.removeCollider(player.hitbox);
  assert.ok(a.hasTarget, `acquire ${dist}m never locked`);
  assert.ok(Math.abs(t - acquireSeconds(dist, 1)) <= 4 * DT, `acquire ${dist}m t=${t.toFixed(3)}`);
  inRange(`acquire ${dist}m`, t, BASELINE.acquire[dist]);
  if (dist === 10) acquire10 = t;
}

/* 2. dispersion */
function spreadRate(dist, stance, seed, { n = 220, ...over } = {}) {
  const player = makePlayer(stance);
  const ai = makeAi(player);
  const a = makeShooter(ai, dist, new Rng(seed), {
    state: STATE.COMBAT, hasTarget: true, wantFire: true, burstLeft: n + 2, ...over,
  });
  const shots = recordShots(ai);
  dumpShots(a, n);
  phys.removeCollider(player.hitbox);
  return hitRate(shots);
}

const stand10 = mean(SEEDS.map((s) => spreadRate(10, 'stand', s)));
inRange('spread stand 10m', stand10, BASELINE.spread.stand[10]);
inRange('spread stand 25m', mean(SEEDS.map((s) => spreadRate(25, 'stand', s))), BASELINE.spread.stand[25]);
inRange('spread stand 50m', mean(SEEDS.map((s) => spreadRate(50, 'stand', s))), BASELINE.spread.stand[50]);
const crouch10 = mean(SEEDS.map((s) => spreadRate(10, 'crouch', s)));
const prone10 = mean(SEEDS.map((s) => spreadRate(10, 'prone', s)));
inRange('spread crouch 10m', crouch10, BASELINE.spread.crouch[10]);
inRange('spread prone 10m', prone10, BASELINE.spread.prone[10]);
assert.ok(prone10 < stand10, `prone ${prone10.toFixed(3)} !< stand ${stand10.toFixed(3)}`);
assert.ok(
  spreadRate(10, 'stand', SEEDS[0], { suppression: 1 }) < stand10 - 0.04,
  'suppression must widen dispersion',
);

/* 3. aimed fire (lerp + wobble + spread) */
function runEncounter(dist, stance, move, seed) {
  const player = makePlayer(stance);
  const ai = makeAi(player);
  const a = makeShooter(ai, dist, new Rng(seed), { burstCooldown: 0 });
  const shots = recordShots(ai);
  let t = 0, first = null;
  const vx = move ? 4.57 : 0;
  while (t < 2.4) {
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
  return { ttfs: first, shots: shots.length, rate: hitRate(shots) };
}

let aimedStand10 = 0;
let ttfs10 = 0;
for (const dist of [10, 25]) {
  const runs = SEEDS.map((s) => runEncounter(dist, 'stand', false, s));
  for (const r of runs) {
    assert.ok(r.ttfs != null, `no shot at ${dist}m`);
    assert.ok(r.shots >= 8, `${dist}m only ${r.shots} shots`);
  }
  const ttfs = mean(runs.map((r) => r.ttfs));
  const rate = mean(runs.map((r) => r.rate));
  inRange(`ttfs ${dist}m`, ttfs, BASELINE.ttfs[dist]);
  inRange(`aimed stand still ${dist}m`, rate, BASELINE.aimed.standStill[dist]);
  if (dist === 10) {
    aimedStand10 = rate;
    ttfs10 = ttfs;
  }
}
inRange('aimed crouch 10m', mean(SEEDS.map((s) => runEncounter(10, 'crouch', false, s).rate)), BASELINE.aimed.crouchStill[10]);
inRange('aimed prone 10m', mean(SEEDS.map((s) => runEncounter(10, 'prone', false, s).rate)), BASELINE.aimed.proneStill[10]);
const moving = mean(SEEDS.map((s) => runEncounter(10, 'stand', true, s).rate));
inRange('aimed stand move 10m', moving, BASELINE.aimed.standMove[10]);
assert.ok(moving < aimedStand10 - 0.08, 'relocation must cut the hit rate');
assert.ok(ttfs10 - acquire10 <= 0.12, 'decision-to-fire is a beat, not a stall');

/* 4. animated bore residual */
{
  const { bones, root } = RIG.createSkeleton();
  const group = new THREE.Group();
  group.add(root);
  group.position.set(0, 0, 10);
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
  assert.ok(to.length() > 1, 'muzzle did not leave the shooter');
  to.normalize();
  const deg = (Math.acos(Math.max(-1, Math.min(1, an.muzzleDir.dot(to)))) * 180) / Math.PI;
  assert.ok(deg < 4, `aim IK 10m is ${deg.toFixed(2)} deg off`);
}

/* 5. world occlusion */
{
  const world = new PhysicsSystem();
  world.staticWorld.addTriangles(new Float32Array([
    -2, 0, 5, 2, 0, 5, 2, 2.4, 5,
    -2, 0, 5, 2, 2.4, 5, -2, 2.4, 5,
  ]), 2, 'concrete', world.LAYER.STATIC, 'wall');
  world.staticWorld.build();
  const player = makePlayer('stand', world);
  const ai = makeAi(player, world);
  const a = makeShooter(ai, 10, new Rng(3));
  let t = 0;
  while (t < 1.2 && !a.hasTarget) {
    tickSenseThink(a, DT);
    t += DT;
  }
  assert.equal(a.hasTarget, false, 'must not acquire through a wall');
  a.hasTarget = true;
  a.state = STATE.COMBAT;
  a.wantFire = true;
  a.burstLeft = 40;
  const shots = recordShots(ai, world);
  dumpShots(a, 30);
  assert.equal(shots.filter(Boolean).length, 0, 'rounds must not pass the wall');
  world.removeCollider(player.hitbox);
}

assert.equal(COMBAT.damage, 17, 'do not inflate damage');
assert.ok(COMBAT.spread >= 0.018 && COMBAT.spread <= 0.04, `spread ${COMBAT.spread} is laser or shotgun`);

console.log('ok  smoke-ai-accuracy');
