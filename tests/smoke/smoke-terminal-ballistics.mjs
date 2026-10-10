#!/usr/bin/env node
/** Behavioural contract: one trajectory owns collisions, damage and feedback. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PhysicsSystem } from '../../src/physics/index.js';
import { EventBus } from '../../src/core/registry.js';
import { Rng } from '../../src/core/rng.ts';
import { AiSystem } from '../../src/ai/index.js';
import { ProjectileSim } from '../../src/weapons/ballistics.ts';
import { AudioSystem } from '../../src/audio/index.js';
import { PlayerSystem } from '../../src/player/index.js';
import { FxSystem } from '../../src/fx/index.js';
import { makeAgent } from '../../tools/lib/agent-fixture.mjs';

const v = (x = 0, y = 1, z = 0) => new THREE.Vector3(x, y, z);
function fixture() {
  const events = new EventBus(), phys = new PhysicsSystem();
  phys.ctx = { events, time: { elapsed: 0 } };
  const damage = [], segments = [], effects = [];
  events.on('damage:dealt', e => damage.push({ ...e, point: e.point.clone(), from: e.from?.clone() }));
  events.on('bullet:segment', e => segments.push({ ...e, from: e.from.clone(), to: e.to.clone() }));
  events.on('bullet:impact', e => effects.push({ ...e, point: e.point.clone() }));
  return { phys, events, damage, segments, effects };
}
function wall(f, surface, thickness, x = 2, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, 4, 4));
  mesh.position.set(x, 1, 0); mesh.updateMatrixWorld(true);
  f.phys.addStatic(mesh, surface, opts); f.phys.rebuildStatic();
  return mesh;
}
function actor(f, x, layer = f.phys.LAYER.ACTOR, radius = .1, owner = {}) {
  const c = f.phys.addCollider({ layer, owner, part: 'torso', surface: 'flesh', radius });
  c.setSegment(x, .3, 0, x, 1.5, 0, radius);
  return c;
}
function boxProxy(f, rigid, surface, halfExtents) {
  if (rigid) f.phys.addRigidBody({ shape: 'box', halfExtents, position: v(2), surfaceType: surface, mass: 10 });
  else {
    const { x: hx, y: hy, z: hz } = halfExtents;
    const c = f.phys.addCollider({ shape: 'box', surface, hx, hy, hz });
    c.setMatrix(new THREE.Matrix4().makeTranslation(2, 1, 0));
  }
}
function fire(f, opts = {}) {
  return f.phys.fireBullet({ origin: v(), dir: v(1, 0), damage: 40,
    penetration: .9, maxDist: 20, dropoff: 1, ...opts });
}

// A material's visible finish is not its structural resistance.
{
  const f = fixture();
  wall(f, 'plaster', .34, 2, { ballisticSurface: 'concrete' }); actor(f, 4, f.phys.LAYER.PLAYER);
  const shot = fire(f);
  assert.equal(shot.stopReason, 'blocked');
  assert.equal(shot.impacts.length, 1);
  assert.equal(shot.impacts[0].surface, 'plaster');
  assert.equal(f.damage.length, 0);
  assert.equal(f.segments.length, 1);
  assert.ok(f.segments[0].to.x < 2, 'feedback stops at the blocking front face');
}
{
  const f = fixture();
  wall(f, 'fabric', .25, 2, { ballisticSurface: 'sand' });
  actor(f, 4, f.phys.LAYER.PLAYER);
  const shot = fire(f);
  assert.equal(shot.stopReason, 'blocked', 'sandbag fill stops the round');
  assert.equal(shot.impacts[0].surface, 'fabric', 'cloth still drives its visible impact');
  assert.equal(f.damage.length, 0);
}
for (const layerName of ['PLAYER', 'ACTOR']) {
  const f = fixture();
  wall(f, 'wood', .05); const c = actor(f, 4, f.phys.LAYER[layerName]);
  const shooter = {}; actor(f, 0, f.phys.LAYER[layerName], .3, shooter);
  const shot = fire(f, { shooter });
  assert.equal(f.damage.length, 1, `${layerName}: shooter excluded, target damaged once through cover`);
  assert.equal(f.damage[0].target, c.owner);
  assert.ok(f.damage[0].amount > 0 && f.damage[0].amount < 40);
  assert.equal(f.damage[0].source, shooter);
  assert.ok(f.damage[0].from.equals(v()));
  assert.equal(shot.impacts[0].surface, 'wood');
  assert.ok(shot.impacts.some(i => i.exit));
  assert.ok(f.phys.colliders.every(collider => collider.enabled), 'queries do not toggle shared hitboxes');
}

// Adding penetrable cover must not remove protection inside its exit interval.
for (const shell of ['mesh', 'sheet', 'collider', 'body', 'merged', 'instanced']) {
  const f = fixture();
  if (shell === 'mesh') wall(f, 'wood', .2);
  else if (shell === 'sheet') {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateY(-Math.PI / 2));
    plane.position.set(1.9, 1, 0); plane.updateMatrixWorld(true);
    f.phys.addStatic(plane, 'wood', { sheetThickness: .2 });
  } else if (shell === 'collider' || shell === 'body') {
    boxProxy(f, shell === 'body', 'wood', v(.1, 2, 2));
  } else {
    let mesh;
    if (shell === 'merged') mesh = new THREE.Mesh(mergeGeometries([
      new THREE.BoxGeometry(.2, 4, 4).translate(2, 1, 0),
      new THREE.BoxGeometry(.1, 4, 4).translate(2, 1, 0),
    ]));
    else {
      mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.2, 4, 4), new THREE.MeshBasicMaterial(), 2);
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2, 1, 0));
      mesh.setMatrixAt(1, new THREE.Matrix4().makeScale(.5, 1, 1).setPosition(2, 1, 0));
    }
    f.phys.addStatic(mesh, 'wood');
  }
  if (shell === 'merged' || shell === 'instanced') f.phys.rebuildStatic();
  else wall(f, 'concrete', .1);
  actor(f, 4);
  const shot = fire(f);
  assert.equal(f.damage.reduce((n, e) => n + e.amount, 0), 0, `${shell}: ambiguous overlaps cannot remove protection`);
  assert.equal(shot.stopReason, 'overlapping-solids');
  assert.equal(shot.impacts.length, 1, `${shell}: ambiguous overlap has no invented exit`);
  assert.equal(f.segments.length, 1);
  assert.ok(Math.abs(shot.end.x - 1.9) < 1e-5);
}
// An isolated analytic shell still penetrates; it must exclude itself, not all proxies.
for (const body of [false, true]) {
  const f = fixture();
  boxProxy(f, body, 'wood', v(.1, 2, 2));
  actor(f, 4);
  fire(f);
  assert.equal(f.damage.length, 1);
  assert.ok(f.damage[0].amount > 0 && f.damage[0].amount < 40);
  assert.equal(f.effects.filter(e => e.exit).length, 1);
}
// Proxies inside mesh cover are also collisions, not skipped material interiors.
for (const body of [false, true]) {
  const f = fixture(); wall(f, 'wood', .2);
  boxProxy(f, body, 'concrete', v(.05, 1, 1));
  actor(f, 4);
  assert.equal(fire(f).stopReason, 'overlapping-solids');
  assert.equal(f.damage.length, 0);
}
{
  const f = fixture(); const first = actor(f, 2); wall(f, 'concrete', .1); actor(f, 4);
  assert.equal(fire(f, { penetration: 2 }).stopReason, 'overlapping-solids');
  assert.deepEqual(f.damage.map(e => e.target), [first.owner], 'a body cannot carry a round past enclosed masonry');
}

// A corpse's current bone is excluded, not all bones or geometry around it.
for (const overlap of ['none', 'masonry', 'bone']) {
  const f = fixture();
  f.phys.ragdolls.push({ actor: {}, boneCount: overlap === 'bone' ? 2 : 1,
    boneHead: [0, 2], boneTail: [1, 3], boneRadius: [.1, .05],
    px: [2, 2, 2, 2], py: [.3, 1.5, .3, 1.5], pz: [0, 0, 0, 0],
    aabb: { minx: 1.9, maxx: 2.1, miny: .2, maxy: 1.6, minz: -.1, maxz: .1 },
    spec: [{ name: 'torso' }, { name: 'arm' }], applyImpulse() {},
  });
  if (overlap === 'masonry') wall(f, 'concrete', .1);
  actor(f, 4);
  const shot = fire(f, { penetration: 2 });
  if (overlap === 'none') {
    assert.equal(f.damage.length, 1);
    assert.ok(shot.impacts[1].exit && shot.impacts[1].ragdoll);
  } else {
    assert.equal(shot.stopReason, 'overlapping-solids');
    assert.equal(f.damage.length, 0);
    assert.equal(shot.impacts.length, 1);
  }
}

// A thick body consumes energy before the wall behind it can receive a hole.
{
  const f = fixture(); actor(f, 2, f.phys.LAYER.PLAYER, .3); wall(f, 'wood', .02, 4);
  const shot = fire(f);
  assert.equal(f.damage.length, 1);
  assert.equal(shot.impacts.length, 1);
  assert.equal(shot.stopReason, 'blocked');
  assert.equal(f.effects.length, 1, 'no independent world trace bypasses the player');
}

// Thick concrete is never replaced by an 18 mm sheet when its exit is far away.
{
  const f = fixture(); wall(f, 'concrete', 2, 3);
  const shot = fire(f);
  assert.equal(shot.impacts.length, 1);
  assert.equal(shot.stopReason, 'blocked');
}

// Disconnected front/back planes in one merged mesh are not a measured solid.
for (const declaredSheet of [false, true]) {
  const f = fixture();
  const front = new THREE.PlaneGeometry(4, 4).rotateY(-Math.PI / 2).translate(2, 1, 0);
  const back = new THREE.PlaneGeometry(4, 4).rotateY(Math.PI / 2).translate(2.3, 1, 0);
  const mesh = new THREE.Mesh(mergeGeometries([front, back]));
  f.phys.addStatic(mesh, 'wood', { sheetThickness: declaredSheet ? .02 : 0 }); f.phys.rebuildStatic();
  const shot = fire(f);
  if (!declaredSheet) {
    assert.equal(shot.stopReason, 'unknown-thickness');
    assert.equal(shot.impacts.length, 1, 'unrelated backface cannot invent an exit');
  } else {
    assert.ok(shot.impacts[1].exit);
    assert.ok(Math.abs(shot.impacts[1].point.x - 2.02) < 1e-5, 'explicit sheet uses authored thickness');
  }
}
{
  const f = fixture();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateY(-Math.PI / 2));
  plane.position.x = 2;
  f.phys.addStatic(plane, 'wood', { sheetThickness: .02 }); f.phys.rebuildStatic();
  const shot = fire(f, { dir: v(.5, 0, Math.sqrt(.75)) });
  assert.ok(Math.abs(shot.impacts[1].distance - shot.impacts[0].distance - .04) < 1e-5,
    'sheet thickness increases with incidence angle');
}

// Merging and instancing do not merge ballistic solid identity.
for (const instanced of [false, true]) {
  const f = fixture();
  let mesh;
  if (instanced) {
    mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.05, 3, 3), new THREE.MeshBasicMaterial(), 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2, 1, 0));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 1, 0));
  } else {
    mesh = new THREE.Mesh(mergeGeometries([
      new THREE.BoxGeometry(.05, 3, 3).translate(2, 1, 0),
      new THREE.BoxGeometry(.05, 3, 3).translate(4, 1, 0),
    ]));
  }
  f.phys.addStatic(mesh, 'wood'); f.phys.rebuildStatic();
  const a = f.phys.raycast(v(), v(1, 0), 20, f.phys.MASK.BULLET);
  const b = f.phys.raycast(v(3), v(1, 0), 20, f.phys.MASK.BULLET);
  assert.notEqual(a.solid, b.solid);
  const shot = fire(f);
  assert.equal(shot.impacts.filter(i => !i.exit).length, 2);
  assert.equal(shot.impacts.filter(i => i.exit).length, 2);
}

// Analytic proxies have real thickness, even without a triangle backface.
for (const dynamic of [false, true]) {
  const f = fixture();
  boxProxy(f, dynamic, 'metal', v(.1, 1, 1));
  assert.equal(fire(f).impacts.length, 1);
}

// Resolve before publication: killing an actor cannot change downstream hits.
{
  const f = fixture(); const first = actor(f, 2), second = actor(f, 4);
  f.events.on('damage:dealt', e => {
    if (e.target === first.owner) {
      f.phys.removeCollider(second);
      actor(f, 3, f.phys.LAYER.ACTOR, .5);
    }
  });
  fire(f, { penetration: 2 });
  assert.deepEqual(f.damage.map(e => e.target), [first.owner, second.owner]);
}

// Highest intersected region wins exactly once; receiver does not repeat falloff.
{
  const f = fixture(); const a = makeAgent({ alive: true });
  actor(f, 4, f.phys.LAYER.ACTOR, .2, a);
  const head = actor(f, 4, f.phys.LAYER.ACTOR, .1, a); head.part = 'head'; head.damageScale = 3;
  let applied = 0;
  a.applyDamage = amount => { applied += amount; };
  const ai = Object.assign(Object.create(AiSystem.prototype), { agents: [a], ctx: { events: f.events } });
  ai.playerPosition = () => { throw new Error('damage must not depend on player position'); };
  ai._wireEvents(ai.ctx);
  const shot = fire(f, { maxRange: 10, dropoff: .5 });
  assert.equal(f.damage.length, 1);
  assert.equal(f.damage[0].part, 'head');
  assert.equal(applied, shot.impacts[0].damage * 3);
  assert.ok(applied < 120 && applied > 100);
  for (const off of ai._off) off();
}

// Player flight hands muzzle damage and travelled distance to the same resolver.
{
  const f = fixture(); wall(f, 'wood', .05, 5); const target = actor(f, 8);
  let resolved;
  f.events.on('shot:resolved', e => { resolved = { ...e }; });
  const shooter = { isPlayer: true }; actor(f, 0, f.phys.LAYER.PLAYER, .3, shooter);
  const sim = new ProjectileSim({ events: f.events, peek: id => id === 'physics' ? f.phys : shooter,
    has: () => true });
  sim.spawn({ origin: v(), dir: v(1, 0), speed: 100, dragK: 0,
    damage: 40, penetration: .9, dropoff: .5, maxRange: 20, shooter });
  for (let i = 0; i < 12; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 1);
  assert.equal(f.damage[0].target, target.owner);
  assert.equal(resolved.target, target.owner);
  assert.equal(resolved.damage, f.damage[0].amount);
  assert.ok(f.damage[0].from.equals(v()), 'provenance stays at muzzle, not contact segment');
  assert.ok(f.segments.every(s => s.shooter === shooter));
}

// Enemy fire has no second player-only trace; capture noDamage remains explicit.
for (const noDamage of [false, true]) {
  const f = fixture(); wall(f, 'wood', .05); const player = { isPlayer: true };
  actor(f, 4, f.phys.LAYER.PLAYER, .1, player);
  const ai = Object.assign(Object.create(AiSystem.prototype), { _phys: f.phys,
    ctx: { events: f.events, config: { deterministic: true }, time: { frame: 1 }, has: () => false, peek: () => null },
    _fireEvent: { origin: v(), dir: v() }, _shellEvent: { position: v(), velocity: v() } });
  const agent = { id: 1, weaponDamage: 17, staged: noDamage ? { noDamage: true } : null,
    animator: { ejectWorld: v() } };
  actor(f, 0, f.phys.LAYER.ACTOR, .3, agent);
  ai.onAgentFire(agent, v(), v(1, 0));
  assert.equal(f.damage.length, noDamage ? 0 : 1);
  if (!noDamage) assert.ok(f.damage[0].amount < 17);
}

// Near-miss audio and suppression use clipped segments, not infinite muzzle rays.
{
  const plays = [];
  const audio = Object.assign(Object.create(AudioSystem.prototype), { running: true,
    field: { listenerPos: v(10) }, _budget: { whizz: 0 },
    _whizzShots: new Float64Array(64), _whizzCursor: 0,
    _playAt: () => plays.push('whizz') });
  const player = new PlayerSystem();
  let suppressed = 0;
  player.ctx = { camera: { position: v(10) } };
  player.health = { dead: false, addSuppression: n => { suppressed += n; } };
  const stopped = { from: v(), to: v(2), shot: 1, shooter: {} };
  audio._onBulletSegment(stopped); player._onBulletSegment(stopped);
  assert.equal(plays.length, 0); assert.equal(suppressed, 0);
  const near = { ...stopped, to: v(12), shot: 2 };
  audio._onBulletSegment(near); player._onBulletSegment(near);
  audio._onBulletSegment(near); player._onBulletSegment(near);
  assert.equal(plays.length, 1); assert.ok(suppressed > 0);
  const previous = suppressed;
  player._onBulletSegment({ ...near, shot: 3, shooter: player });
  assert.equal(suppressed, previous);
}

// Exit spall is distinct, outward-going, and never creates an entry-hole decal.
{
  const particles = [];
  const fx = Object.assign(Object.create(FxSystem.prototype), { ctx: { time: { elapsed: 0 } },
    rng: new Rng(123), pScale: 1, stats: { spawned: 0 },
    emitLit: s => particles.push({ ...s }),
    decal: () => { throw new Error('exit cannot paint an entry crater'); } });
  fx.onImpact({ point: v(), normal: v(1, 0), incident: v(1, 0),
    surface: 'plaster', damage: 30, exit: true });
  assert.ok(particles.length > 0);
  assert.ok(particles.every(p => p.vx >= 0));
}
console.log('smoke-terminal-ballistics: ok');
