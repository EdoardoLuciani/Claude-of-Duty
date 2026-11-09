#!/usr/bin/env bun
/** Behavioural contract: one trajectory owns collisions, damage and feedback. */
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { Animator } from '../../src/ai/animator.ts';
import { AiSystem } from '../../src/ai/index.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import type { EngineContext } from '../../src/core/context.ts';
import type {
  EngineEventMap,
  BulletSegmentEvent,
  BulletImpactEvent,
  DamageDealtEvent,
} from '../../src/core/events.ts';
import { applyDefinedPatch } from '../../src/core/patch.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { FxSystem } from '../../src/fx/index.ts';
import { PhysicsSystem, type RaycastIgnore } from '../../src/physics/index.ts';
import type { Ragdoll } from '../../src/physics/ragdoll.ts';
import type { SurfaceName } from '../../src/physics/surfaces.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { ProjectileSim } from '../../src/weapons/ballistics.ts';
import { makeAgent } from '../lib/agent-fixture.ts';
import { createTestContext } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture as checkedFixture } from '../lib/fixture.ts';

const v = (x = 0, y = 1, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
interface BallisticsFixture {
  events: EventBus;
  phys: PhysicsSystem;
  damage: Array<DamageDealtEvent & { point: THREE.Vector3; from: THREE.Vector3 }>;
  segments: BulletSegmentEvent[];
  effects: BulletImpactEvent[];
}
function fixture(): BallisticsFixture {
  const events = new EventBus(),
    phys = new PhysicsSystem();
  phys.ctx = createTestContext({ events });
  const damage: BallisticsFixture['damage'] = [],
    segments: BulletSegmentEvent[] = [],
    effects: BulletImpactEvent[] = [];
  events.on('damage:dealt', (e): void => {
    assert(e.point && e.from);
    damage.push({ ...e, point: e.point.clone(), from: e.from.clone() });
  });
  events.on('bullet:segment', (e): number =>
    segments.push({ ...e, from: e.from.clone(), to: e.to.clone() })
  );
  events.on('bullet:impact', (e): number => effects.push({ ...e, point: e.point.clone() }));
  return { phys, events, damage, segments, effects };
}
function projectileContext(f: BallisticsFixture, telemetry: boolean): EngineContext {
  const ctx = createTestContext({ events: f.events, providers: { physics: f.phys } });
  ctx.has = (): boolean => telemetry;
  return ctx;
}
function wall(
  f: BallisticsFixture,
  surface: SurfaceName,
  thickness: number,
  x = 2,
  opts: Parameters<PhysicsSystem['addStatic']>[2] = {}
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, 4, 4));
  mesh.position.set(x, 1, 0);
  mesh.updateMatrixWorld(true);
  f.phys.addStatic(mesh, surface, opts);
  f.phys.rebuildStatic();
  return mesh;
}
function actor(
  f: BallisticsFixture,
  x: number,
  {
    layer = f.phys.LAYER.ACTOR,
    radius = 0.1,
    owner = {},
    part = 'torso',
    damageScale = 1,
  }: { layer?: number; radius?: number; owner?: unknown; part?: string; damageScale?: number } = {}
): ReturnType<PhysicsSystem['addCollider']> {
  const c = f.phys.addCollider({ layer, owner, part, damageScale, surface: 'flesh', radius });
  c.setSegment(x, 0.3, 0, x, 1.5, 0, radius);
  return c;
}
function boxProxy(
  f: BallisticsFixture,
  rigid: boolean,
  surface: SurfaceName,
  halfExtents: THREE.Vector3
): void {
  if (rigid)
    f.phys.addRigidBody({
      shape: 'box',
      halfExtents,
      position: v(2),
      surfaceType: surface,
      mass: 10,
    });
  else {
    const { x: hx, y: hy, z: hz } = halfExtents;
    const c = f.phys.addCollider({ shape: 'box', surface, hx, hy, hz });
    c.setMatrix(new THREE.Matrix4().makeTranslation(2, 1, 0));
  }
}
type RoundOptions = Parameters<ProjectileSim['spawn']>[0];
/** Straight, drag-free 100 m/s round along +X; tests override only what they probe. */
function round(opts: Partial<RoundOptions> = {}): RoundOptions {
  return {
    origin: v(),
    dir: v(1, 0),
    speed: 100,
    dragK: 0,
    maxRange: 20,
    damage: 40,
    penetration: 0.9,
    dropoff: 1,
    ...opts,
  };
}
function fire(
  f: BallisticsFixture,
  opts: Partial<Parameters<PhysicsSystem['fireBullet']>[0]> = {}
): ReturnType<PhysicsSystem['fireBullet']> {
  return f.phys.fireBullet({
    origin: v(),
    dir: v(1, 0),
    damage: 40,
    penetration: 0.9,
    maxDist: 20,
    dropoff: 1,
    ...opts,
  });
}

// A material's visible finish is not its structural resistance.
{
  const f = fixture();
  wall(f, 'plaster', 0.34, 2, { ballisticSurface: 'concrete' });
  actor(f, 4, { layer: f.phys.LAYER.PLAYER });
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
  wall(f, 'fabric', 0.25, 2, { ballisticSurface: 'sand' });
  actor(f, 4, { layer: f.phys.LAYER.PLAYER });
  const shot = fire(f);
  assert.equal(shot.stopReason, 'blocked', 'sandbag fill stops the round');
  assert.equal(shot.impacts[0].surface, 'fabric', 'cloth still drives its visible impact');
  assert.equal(f.damage.length, 0);
}
for (const layerName of ['PLAYER', 'ACTOR'] as const) {
  const f = fixture();
  wall(f, 'wood', 0.05);
  const c = actor(f, 4, { layer: f.phys.LAYER[layerName] });
  const shooter = {};
  actor(f, 0, { layer: f.phys.LAYER[layerName], radius: 0.3, owner: shooter });
  const shot = fire(f, { shooter });
  assert.equal(
    f.damage.length,
    1,
    `${layerName}: shooter excluded, target damaged once through cover`
  );
  assert.equal(f.damage[0].target, c.owner);
  assert.ok(f.damage[0].amount > 0 && f.damage[0].amount < 40);
  assert.equal(f.damage[0].source, shooter);
  assert.ok(f.damage[0].from.equals(v()));
  assert.equal(shot.impacts[0].surface, 'wood');
  assert.ok(shot.impacts.some((i): boolean => i.exit));
  assert.ok(
    f.phys.colliders.every((collider): boolean => collider.enabled),
    'queries do not toggle shared hitboxes'
  );
}

// Adding penetrable cover must not remove protection inside its exit interval.
for (const shell of ['mesh', 'sheet', 'collider', 'body', 'merged', 'instanced']) {
  const f = fixture();
  if (shell === 'mesh') wall(f, 'wood', 0.2);
  else if (shell === 'sheet') {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateY(-Math.PI / 2));
    plane.position.set(1.9, 1, 0);
    plane.updateMatrixWorld(true);
    f.phys.addStatic(plane, 'wood', { sheetThickness: 0.2 });
  } else if (shell === 'collider' || shell === 'body') {
    boxProxy(f, shell === 'body', 'wood', v(0.1, 2, 2));
  } else {
    let mesh;
    if (shell === 'merged')
      mesh = new THREE.Mesh(
        mergeGeometries([
          new THREE.BoxGeometry(0.2, 4, 4).translate(2, 1, 0),
          new THREE.BoxGeometry(0.1, 4, 4).translate(2, 1, 0),
        ])
      );
    else {
      mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.2, 4, 4),
        new THREE.MeshBasicMaterial(),
        2
      );
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2, 1, 0));
      mesh.setMatrixAt(1, new THREE.Matrix4().makeScale(0.5, 1, 1).setPosition(2, 1, 0));
    }
    f.phys.addStatic(mesh, 'wood');
  }
  if (shell === 'merged' || shell === 'instanced') f.phys.rebuildStatic();
  else wall(f, 'concrete', 0.1);
  actor(f, 4);
  const shot = fire(f);
  assert.equal(
    f.damage.reduce((n, e): number => n + e.amount, 0),
    0,
    `${shell}: ambiguous overlaps cannot remove protection`
  );
  assert.equal(shot.stopReason, 'overlapping-solids');
  assert.equal(shot.impacts.length, 1, `${shell}: ambiguous overlap has no invented exit`);
  assert.equal(f.segments.length, 1);
  assert.ok(Math.abs(shot.end.x - 1.9) < 1e-5);
}
// An isolated analytic shell still penetrates; it must exclude itself, not all proxies.
for (const body of [false, true]) {
  const f = fixture();
  boxProxy(f, body, 'wood', v(0.1, 2, 2));
  actor(f, 4);
  fire(f);
  assert.equal(f.damage.length, 1);
  assert.ok(f.damage[0].amount > 0 && f.damage[0].amount < 40);
  assert.equal(f.effects.filter((e): boolean => e.exit).length, 1);
}
// Proxies inside mesh cover are also collisions, not skipped material interiors.
for (const body of [false, true]) {
  const f = fixture();
  wall(f, 'wood', 0.2);
  boxProxy(f, body, 'concrete', v(0.05, 1, 1));
  actor(f, 4);
  assert.equal(fire(f).stopReason, 'overlapping-solids');
  assert.equal(f.damage.length, 0);
}
{
  const f = fixture();
  const first = actor(f, 2);
  wall(f, 'concrete', 0.1);
  actor(f, 4);
  assert.equal(fire(f, { penetration: 2 }).stopReason, 'overlapping-solids');
  assert.deepEqual(
    f.damage.map((e): unknown => e.target),
    [first.owner],
    'a body cannot carry a round past enclosed masonry'
  );
}

// A corpse's current bone is excluded, not all bones or geometry around it.
for (const overlap of ['none', 'masonry', 'bone']) {
  const f = fixture();
  f.phys.ragdolls.push(
    checkedFixture<Ragdoll>(
      {
        actor: {},
        boneCount: overlap === 'bone' ? 2 : 1,
        boneHead: new Int32Array([0, 2]),
        boneTail: new Int32Array([1, 3]),
        boneRadius: new Float32Array([0.1, 0.05]),
        px: new Float64Array([2, 2, 2, 2]),
        py: new Float64Array([0.3, 1.5, 0.3, 1.5]),
        pz: new Float64Array([0, 0, 0, 0]),
        aabb: { minx: 1.9, maxx: 2.1, miny: 0.2, maxy: 1.6, minz: -0.1, maxz: 0.1 },
        spec: [
          { name: 'torso', head: [2, 0.3, 0], tail: [2, 1.5, 0] },
          { name: 'arm', head: [2, 0.3, 0], tail: [2, 1.5, 0] },
        ],
        applyImpulse(): void {},
      },
      new complete.Ragdoll(null)
    )
  );
  if (overlap === 'masonry') wall(f, 'concrete', 0.1);
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
  const f = fixture();
  actor(f, 2, { layer: f.phys.LAYER.PLAYER, radius: 0.3 });
  wall(f, 'wood', 0.02, 4);
  const shot = fire(f);
  assert.equal(f.damage.length, 1);
  assert.equal(shot.impacts.length, 1);
  assert.equal(shot.stopReason, 'blocked');
  assert.equal(f.effects.length, 1, 'no independent world trace bypasses the player');
}

// Thick concrete is never replaced by an 18 mm sheet when its exit is far away.
{
  const f = fixture();
  wall(f, 'concrete', 2, 3);
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
  f.phys.addStatic(mesh, 'wood', { sheetThickness: declaredSheet ? 0.02 : 0 });
  f.phys.rebuildStatic();
  const shot = fire(f);
  if (!declaredSheet) {
    assert.equal(shot.stopReason, 'unknown-thickness');
    assert.equal(shot.impacts.length, 1, 'unrelated backface cannot invent an exit');
  } else {
    assert.ok(shot.impacts[1].exit);
    assert.ok(
      Math.abs(shot.impacts[1].point.x - 2.02) < 1e-5,
      'explicit sheet uses authored thickness'
    );
  }
}
{
  const f = fixture();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateY(-Math.PI / 2));
  plane.position.x = 2;
  f.phys.addStatic(plane, 'wood', { sheetThickness: 0.02 });
  f.phys.rebuildStatic();
  const shot = fire(f, { dir: v(0.5, 0, Math.sqrt(0.75)) });
  assert.ok(
    Math.abs(shot.impacts[1].distance - shot.impacts[0].distance - 0.04) < 1e-5,
    'sheet thickness increases with incidence angle'
  );
}

// Merging and instancing do not merge ballistic solid identity.
for (const instanced of [false, true]) {
  const f = fixture();
  let mesh;
  if (instanced) {
    mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.05, 3, 3),
      new THREE.MeshBasicMaterial(),
      2
    );
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2, 1, 0));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 1, 0));
  } else {
    mesh = new THREE.Mesh(
      mergeGeometries([
        new THREE.BoxGeometry(0.05, 3, 3).translate(2, 1, 0),
        new THREE.BoxGeometry(0.05, 3, 3).translate(4, 1, 0),
      ])
    );
  }
  f.phys.addStatic(mesh, 'wood');
  f.phys.rebuildStatic();
  const a = f.phys.raycast(v(), v(1, 0), 20, f.phys.MASK.BULLET);
  const b = f.phys.raycast(v(3), v(1, 0), 20, f.phys.MASK.BULLET);
  assert.notEqual(a.solid, b.solid);
  const shot = fire(f);
  assert.equal(shot.impacts.filter((i): boolean => !i.exit).length, 2);
  assert.equal(shot.impacts.filter((i): boolean => i.exit).length, 2);
}

// Analytic proxies have real thickness, even without a triangle backface.
for (const dynamic of [false, true]) {
  const f = fixture();
  boxProxy(f, dynamic, 'metal', v(0.1, 1, 1));
  assert.equal(fire(f).impacts.length, 1);
}

// Resolve before publication: killing an actor cannot change downstream hits.
{
  const f = fixture();
  const first = actor(f, 2),
    second = actor(f, 4);
  f.events.on('damage:dealt', (e): void => {
    if (e.target === first.owner) {
      f.phys.removeCollider(second);
      actor(f, 3, { radius: 0.5 });
    }
  });
  fire(f, { penetration: 2 });
  assert.deepEqual(
    f.damage.map((e): unknown => e.target),
    [first.owner, second.owner]
  );
}

// Highest intersected region wins exactly once; receiver does not repeat falloff.
{
  const f = fixture();
  const a = makeAgent({ alive: true });
  actor(f, 4, { radius: 0.2, owner: a });
  actor(f, 4, { radius: 0.1, owner: a, part: 'head', damageScale: 3 });
  let applied = 0;
  a.applyDamage = (amount): void => {
    applied += amount;
  };
  const ai = new AiSystem();
  applyDefinedPatch(ai, {
    agents: [a],
    ctx: createTestContext({ events: f.events }),
  });
  ai.playerPosition = (): never => {
    throw new Error('damage must not depend on player position');
  };
  ai._wireEvents(ai.ctx);
  const shot = fire(f, { maxRange: 10, dropoff: 0.5 });
  assert.equal(f.damage.length, 1);
  assert.equal(f.damage[0].part, 'head');
  assert.equal(applied, shot.impacts[0].damage * 3);
  assert.ok(applied < 120 && applied > 100);
  for (const off of ai._off) off();
}

// Region selection is bounded by the resolved path, not the original ray.
for (const obstruction of ['concrete', 'wood', 'range', 'body', 'deflect', 'none']) {
  const f = fixture(),
    owner = {};
  actor(f, 2, {
    radius: obstruction === 'body' ? 0.3 : 0.05,
    owner,
    part: 'arm',
    damageScale: 0.65,
  });
  actor(f, 4, { radius: 0.1, owner, part: 'head', damageScale: 4 });
  if (obstruction === 'concrete') wall(f, 'concrete', 0.2, 3);
  if (obstruction === 'wood') wall(f, 'wood', 0.02, 3);
  const shot = fire(f, {
    maxDist: obstruction === 'range' ? 3 : 20,
    rng: obstruction === 'deflect' ? { gauss: (): number => 100 } : null,
  });
  assert.equal(f.damage.length, 1, 'one damage event per actor');
  const reachable = obstruction === 'none' || obstruction === 'wood';
  assert.equal(f.damage[0].part, reachable ? 'head' : 'arm', obstruction);
  assert.equal(f.damage[0].headshot, reachable);
  if (reachable) {
    assert.ok(
      Math.abs(f.damage[0].point.x - 3.9) < 1e-5,
      'damage names the actual selected contact'
    );
    assert.ok(
      f.damage[0].amount < 160 && f.damage[0].amount > 100,
      'energy spent before the head is retained'
    );
  } else {
    assert.equal(
      f.damage[0].amount,
      26,
      `${obstruction}: inaccessible head cannot promote the arm`
    );
    assert.ok(f.damage[0].point.x < 2);
  }
  assert.equal(shot.impacts.filter((i): boolean => !i.exit && !!i.actor).length, 1);
}

// Timed actor contact must retain the highest region on the reached trajectory.
{
  const f = fixture(),
    owner = {};
  const arm = actor(f, 2, { radius: 0.08, owner, part: 'arm', damageScale: 0.65 });
  arm.setSegment(2, 0.5, 0, 2, 1.5, 0, 0.08);
  const head = actor(f, 2.5, { radius: 0.08, owner, part: 'head', damageScale: 4 });
  head.setSegment(2.5, 0.5, 0, 2.5, 1.5, 0, 0.08);
  fire(f, { penetration: 2 });
  const instant = f.damage.pop();
  assert(instant);
  assert.equal(instant.part, 'head');
  const sim = new ProjectileSim(projectileContext(f, false));
  sim.spawn(round({ penetration: 2 }));
  for (let i = 0; i < 3; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 0, 'arm contact waits only for the local actor extent');
  sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 1, 'head damage publishes before distant round expiry');
  for (let i = 0; i < 116 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 1, 'one event per actor/round');
  assert.equal(f.damage[0].part, 'head', 'later reached head must outrank the entry arm');
  assert.ok(Math.abs(f.damage[0].amount - instant.amount) < 0.001);
  f.phys.dispose();
}

// Per-actor delay follows only actual paths, including intervening cover and
// other actors. No target behind cover receives an early look-ahead event.
for (const kind of [
  'none',
  'wood',
  'concrete',
  'deflect',
  'range',
  'body',
  'exhausted',
  'layers',
  'actors',
]) {
  const f = fixture(),
    owner = {};
  actor(f, 2, { radius: kind === 'body' ? 0.3 : 0.05, owner, part: 'arm', damageScale: 0.65 });
  const headX = kind === 'layers' ? 20 : 4;
  actor(f, headX, { radius: 0.1, owner, part: 'head', damageScale: 4 });
  if (kind === 'wood' || kind === 'exhausted' || kind === 'actors')
    wall(f, 'wood', kind === 'exhausted' ? 0.3 : 0.02, kind === 'actors' ? 5 : 3);
  if (kind === 'concrete') wall(f, 'concrete', 0.2, 3);
  if (kind === 'layers') for (let i = 0; i < 6; i++) wall(f, 'wood', 0.005, 3 + i * 2);
  const other = kind === 'actors' ? actor(f, 3) : null;
  const distant = kind === 'actors' ? actor(f, 8) : null;
  f.phys.ballistics.rng = { gauss: (): number => (kind === 'deflect' ? 100 : 0) };
  const opts = { penetration: kind === 'actors' ? 2 : 0.9, maxDist: kind === 'range' ? 3 : 30 };
  fire(f, opts);
  const instant = f.damage.find((e): boolean => e.target === owner);
  assert(instant);
  const instantOthers = f.damage.filter((e): boolean => e.target !== owner);
  f.damage.length = f.segments.length = f.effects.length = 0;
  const sim = new ProjectileSim(projectileContext(f, true));
  let resolved: EngineEventMap['shot:resolved'] | undefined;
  let tick = 0;
  const damageTicks: Array<{ target: unknown; tick: number }> = [];
  f.events.on('damage:dealt', (e): number => damageTicks.push({ target: e.target, tick }));
  f.events.on('shot:resolved', (e): void => {
    resolved = { ...e, to: e.to.clone() };
  });
  const p = sim.spawn(round({ maxRange: opts.maxDist, penetration: opts.penetration }));
  assert(p);
  while (tick < 120 && p.alive) {
    tick++;
    sim.fixedUpdate(1 / 120);
  }
  const hits = f.damage.filter((e): boolean => e.target === owner);
  assert.equal(hits.length, 1, `${kind}: one final actor event`);
  assert.equal(hits[0].part, instant.part, `${kind}: shared highest reached region`);
  assert.ok(
    Math.abs(hits[0].amount - instant.amount) < 0.005,
    `${kind}: cumulative energy retained`
  );
  assert.ok(hits[0].from.equals(v()), `${kind}: retained muzzle provenance`);
  assert(resolved);
  assert.equal(resolved.target, owner);
  assert.equal(resolved.part, hits[0].part);
  assert.equal(resolved.damage, hits[0].amount);
  assert.ok(resolved.to.equals(hits[0].point));
  if (kind === 'layers') assert.equal(resolved.stopReason, 'layer-limit');
  if (kind === 'actors') {
    assert.equal(hits[0].part, 'head', 'arm/B/head must not lock A to its arm');
    assert.deepEqual(
      f.damage.filter((e): boolean => e.target !== owner).map((e): unknown => e.target),
      instantOthers.map((e): unknown => e.target)
    );
    assert.ok(
      (damageTicks.find((e): boolean => e.target === other?.owner)?.tick ?? -Infinity) >= 4,
      'B inside A extent stays timed'
    );
    assert.ok(
      (damageTicks.find((e): boolean => e.target === distant?.owner)?.tick ?? -Infinity) >= 10,
      'actor beyond A and wood stays timed'
    );
    assert.ok(
      (damageTicks.find((e): boolean => e.target === owner)?.tick ?? Infinity) < tick,
      'A is not delayed to round expiry'
    );
  }
  f.phys.dispose();
}

// Leaving the actor laterally is not completion: a second cover deflection
// can return the actual path to that actor's downstream head.
{
  const f = fixture(),
    owner = {};
  actor(f, 2, { radius: 0.05, owner, part: 'arm', damageScale: 0.65 });
  const head = actor(f, 4, { radius: 0.1, owner, part: 'head', damageScale: 4 });
  wall(f, 'wood', 0.02, 2.6);
  wall(f, 'wood', 0.02, 3.4);
  const scatter = [0, 0, 400, 0, -800, 0];
  let draws = 0;
  f.phys.ballistics.rng = { gauss: (): number => scatter[draws++] ?? 0 };
  const path = fire(f, { penetration: 2, emit: false }).segments.at(-1);
  assert(path);
  const z =
    path.from.z + ((path.to.z - path.from.z) * (4 - path.from.x)) / (path.to.x - path.from.x);
  head.setSegment(4, 0.3, z, 4, 1.5, z, 0.1);
  draws = 0;
  fire(f, { penetration: 2 });
  const instant = f.damage.pop();
  assert(instant);
  assert.equal(instant.part, 'head');
  draws = 0;
  f.segments.length = 0;
  const sim = new ProjectileSim(projectileContext(f, false));
  sim.spawn(round({ penetration: 2 }));
  for (let i = 0; i < 120 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
  assert.ok(
    f.segments.some((s): boolean => s.to.z < -0.2),
    'flight leaves the initial capsule envelope laterally'
  );
  assert.equal(f.damage.length, 1);
  assert.equal(f.damage[0].part, 'head', 'second scatter returns to the reached head');
  assert.ok(Math.abs(f.damage[0].amount - instant.amount) < 0.005);
  f.phys.dispose();
}

// A moving enabled head can extend, but never shrink, the pending frontier.
{
  const f = fixture(),
    owner = {};
  actor(f, 2, { radius: 0.05, owner, part: 'arm', damageScale: 0.65 });
  const head = actor(f, 4, { radius: 0.1, owner, part: 'head', damageScale: 4 });
  const sim = new ProjectileSim(projectileContext(f, false));
  sim.spawn(round({ penetration: 2 }));
  for (let i = 0; i < 3; i++) sim.fixedUpdate(1 / 120);
  head.setSegment(6, 0.3, 0, 6, 1.5, 0, 0.1);
  for (let i = 0; i < 3; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 0, 'crossing the old plane cannot flush a still-forward head');
  for (let i = 0; i < 3; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 1);
  assert.equal(f.damage[0].part, 'head');
  assert.ok(Math.abs(f.damage[0].point.x - 5.9) < 0.001);
  sim.clear();
  assert.equal(f.damage.length, 1);
  f.phys.dispose();
}

// Pending records own their selected payload even if another actor's listener
// removes colliders, and repeated pooled resolutions cannot overwrite them.
{
  const f = fixture(),
    owner = {},
    other = {};
  actor(f, 2, { radius: 0.05, owner, part: 'arm', damageScale: 0.65 });
  actor(f, 4, { radius: 0.1, owner, part: 'head', damageScale: 4 });
  const firstOther = actor(f, 3, { radius: 0.05, owner: other });
  const lastOther = actor(f, 5, { radius: 0.05, owner: other });
  f.events.on('damage:dealt', (e): void => {
    if (e.target === owner) {
      f.phys.removeCollider(firstOther);
      f.phys.removeCollider(lastOther);
    }
  });
  const sim = new ProjectileSim(projectileContext(f, false));
  sim.spawn(round({ penetration: 2 }));
  for (let i = 0; i < 120 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 2);
  assert.equal(f.damage[0].part, 'head');
  assert.equal(f.damage[1].target, other);
  assert.ok(
    Math.abs(f.damage[1].point.x - 2.95) < 0.001,
    'pending contact survives collider removal and pooled reuse'
  );
  f.phys.dispose();
}

// Clearing/recycling a round flushes reached damage, not its unreached head;
// reuse resets both deduplication and pending publication state.
for (const cleanup of ['clear', 'recycle', 'expiry']) {
  const f = fixture(),
    owner = {};
  actor(f, 2, { radius: 0.05, owner, part: 'arm', damageScale: 0.65 });
  actor(f, 4, { radius: 0.1, owner, part: 'head', damageScale: 4 });
  const sim = new ProjectileSim(projectileContext(f, false));
  const opts = round({ penetration: 2 });
  const p = sim.spawn(opts);
  assert(p);
  const oldShot = p.shot;
  for (let i = 0; i < 3; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 0);
  if (cleanup === 'clear') sim.clear();
  else if (cleanup === 'expiry') {
    p.age = 5;
    sim.fixedUpdate(1e-4);
  } else {
    for (let i = 0; i < sim.pool.length; i++) sim.spawn({ ...opts, origin: v(0, 1, 10) });
    sim.clear();
  }
  assert.equal(f.damage.length, 1, `${cleanup}: pending contact publishes once`);
  assert.equal(f.damage[0].part, 'arm');
  assert.equal(f.damage[0].shot, oldShot);
  sim.spawn(opts);
  for (let i = 0; i < 120 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 2, `${cleanup}: reused pool permits a new actor event`);
  assert.equal(f.damage[1].part, 'head');
  assert.notEqual(f.damage[1].shot, oldShot);
  f.phys.dispose();
}

// Player flight hands muzzle damage and travelled distance to the same resolver.
{
  const f = fixture();
  wall(f, 'wood', 0.05, 5);
  const target = actor(f, 8);
  let resolved: EngineEventMap['shot:resolved'] | undefined;
  f.events.on('shot:resolved', (e): void => {
    resolved = { ...e };
  });
  const shooter = new PlayerSystem();
  actor(f, 0, { layer: f.phys.LAYER.PLAYER, radius: 0.3, owner: shooter });
  const sim = new ProjectileSim(projectileContext(f, true));
  sim.spawn(round({ dropoff: 0.5, shooter }));
  for (let i = 0; i < 120 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 1);
  assert.equal(f.damage[0].target, target.owner);
  assert(resolved);
  assert.equal(resolved.target, target.owner);
  assert.equal(resolved.damage, f.damage[0].amount);
  assert.ok(f.damage[0].from.equals(v()), 'provenance stays at muzzle, not contact segment');
  assert.ok(f.segments.every((s): boolean => s.shooter === shooter));
}

// A penetrated sheet cannot turn the remaining player flight into hitscan.
// Gravity, drag, range falloff and material energy loss continue after the exit.
function timedFlight(
  covered: boolean,
  dragK = 0
): { step: number; hit: BallisticsFixture['damage'][number]; speed: number } {
  const f = fixture();
  if (covered) wall(f, 'wood', 0.02);
  actor(f, 100, { radius: 0.3 });
  const sim = new ProjectileSim(projectileContext(f, false));
  const p = sim.spawn(round({ speed: 800, dragK, maxRange: 200, dropoff: 0.5 }));
  assert(p);
  let step = 0;
  while (!f.damage.length && step < 120) {
    sim.fixedUpdate(1 / 120);
    step++;
  }
  assert.equal(f.damage.length, 1, 'downstream actor remains reachable');
  assert.ok(
    f.segments.every((s): boolean => s.from.x < 101 && s.to.x < 101),
    'no future segments published'
  );
  const hit = f.damage[0];
  const speed = p.vel.length();
  f.phys.dispose();
  return { step, hit, speed };
}
{
  const clear = timedFlight(false),
    covered = timedFlight(true),
    dragged = timedFlight(true, 2);
  assert.equal(clear.step, 15);
  assert.ok(covered.step >= clear.step, 'wood must not advance damage from tick 15 to tick 1');
  assert.ok(
    covered.hit.point.y <= clear.hit.point.y + 0.005,
    'gravity continues during downstream flight'
  );
  assert.ok(covered.hit.amount < clear.hit.amount, 'penetration energy loss survives continuation');
  assert.ok(dragged.step > covered.step, 'drag continues after the sheet');
  assert.ok(dragged.hit.point.y < covered.hit.point.y, 'longer flight drops farther');
}

// Continuation preserves scatter, per-round actor deduplication and provenance.
{
  const f = fixture();
  wall(f, 'wood', 0.05);
  let draws = 0;
  f.phys.ballistics.rng = { gauss: (): number => (++draws % 2 ? 50 : 0) };
  const z = -(8 - 2.025) * 0.03 * (0.05 / (0.32 * 0.9)) * 50;
  const owner = {},
    target = actor(f, 8, { radius: 0.1, owner });
  target.setSegment(8, 0.3, z, 8, 1.5, z, 0.1);
  // A later capsule of the same actor must not cause a second damage event.
  const extra = actor(f, 10, { radius: 0.1, owner });
  const path = fire(f, { emit: false }).segments.at(-1);
  assert(path);
  const t = (10 - path.from.x) / (path.to.x - path.from.x);
  const extraZ = path.from.z + (path.to.z - path.from.z) * t;
  extra.setSegment(10, 0.3, extraZ, 10, 1.5, extraZ, 0.1);
  draws = 0;
  const summaries: EngineEventMap['shot:resolved'][] = [];
  f.events.on('shot:resolved', (e): number => summaries.push({ ...e, to: e.to.clone() }));
  const sim = new ProjectileSim(projectileContext(f, true));
  const p = sim.spawn(round());
  assert(p);
  for (let i = 0; i < 120 && p.alive; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 1, 'scatter reaches the off-lane actor once');
  assert.equal(f.damage[0].target, owner);
  assert.ok(f.damage[0].from.equals(v()));
  assert.equal(draws, 4, 'wood and flesh each scatter once, without re-resolving the exit');
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].target, owner, 'actor contact outranks the earlier wall');
  assert.equal(summaries[0].damage, f.damage[0].amount);
  assert.ok(
    summaries[0].to.equals(f.damage[0].point),
    'summary owns a copy across pooled resolver reuse'
  );
  const oldShot = p.shot;
  sim.spawn(round());
  for (let i = 0; i < 120 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 2, 'pool reuse resets previously contacted actors');
  assert.notEqual(f.damage[1].shot, oldShot);
  f.phys.dispose();
}

// An atomic material exit still costs travel time, even across fixed ticks.
{
  const f = fixture();
  wall(f, 'foliage', 1.5, 2);
  actor(f, 4);
  const sim = new ProjectileSim(projectileContext(f, false));
  const p = sim.spawn(round({ penetration: 2 }));
  assert(p);
  sim.fixedUpdate(1 / 120);
  sim.fixedUpdate(1 / 120);
  assert.ok(p.materialTime > 0, 'interior transit exceeds this tick');
  assert.equal(f.damage.length, 0);
  sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 0, 'no downstream flight until material transit is paid');
  for (let i = 0; i < 117 && p.alive; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 1);
  assert.ok(
    f.segments.every((s): boolean => s.to.x <= 1.251 || s.from.x >= 2.749),
    'interiors do not emit free-flight segments'
  );
  f.phys.dispose();
}

// Fixed ticks must not reset the resolver's six-layer ceiling or range budget.
{
  const f = fixture();
  for (let i = 0; i < 7; i++) wall(f, 'wood', 0.005, 2 + i * 2);
  actor(f, 18);
  const sim = new ProjectileSim(projectileContext(f, true));
  let reason;
  f.events.on('shot:resolved', (e): void => {
    reason = e.stopReason;
  });
  sim.spawn(round({ penetration: 2 }));
  for (let i = 0; i < 120 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.effects.filter((e): boolean => !e.exit).length, 6);
  assert.equal(f.damage.length, 0);
  assert.equal(reason, 'layer-limit');
  f.phys.dispose();
}
{
  const f = fixture();
  wall(f, 'wood', 0.02);
  actor(f, 15);
  const sim = new ProjectileSim(projectileContext(f, false));
  sim.spawn(round({ maxRange: 10 }));
  for (let i = 0; i < 120 && sim.live.length; i++) sim.fixedUpdate(1 / 120);
  assert.equal(f.damage.length, 0, 'continuation cannot exceed the original range');
  assert.ok(f.segments.every((s): boolean => s.to.x <= 10.00001));
  f.phys.dispose();
}

// Longer-lived rounds still obey the pool bound when the oldest is recycled.
{
  const f = fixture(),
    sim = new ProjectileSim(projectileContext(f, false));
  for (let i = 0; i < sim.pool.length + 4; i++) {
    sim.spawn({ origin: v(), dir: v(1, 0), speed: 100, dragK: 0, maxRange: 20 });
  }
  assert.equal(sim.live.length, sim.pool.length);
  assert.equal(new Set(sim.live).size, sim.pool.length, 'recycled slots must not be stepped twice');
  sim.clear();
  f.phys.dispose();
}

// Enemy fire has no second player-only trace; capture noDamage remains explicit.
for (const noDamage of [false, true]) {
  const f = fixture();
  wall(f, 'wood', 0.05);
  const player = { isPlayer: true };
  actor(f, 4, { layer: f.phys.LAYER.PLAYER, radius: 0.1, owner: player });
  const ai = new AiSystem();
  applyDefinedPatch(ai, {
    _phys: f.phys,
    ctx: createTestContext({ events: f.events }),
    _fireEvent: {
      actor: null,
      weapon: 'ai_rifle',
      seed: 0,
      origin: v(),
      dir: v(),
      intensity: 0.12,
      light: 0.006,
      flashScale: 0.8,
    },
    _shellEvent: { position: v(), velocity: v() },
  });
  const agent = checkedFixture<Parameters<AiSystem['onAgentFire']>[0]>(
    {
      id: 1,
      team: 1,
      weaponDamage: 17,
      ...(noDamage
        ? {
            staged: checkedFixture<NonNullable<Parameters<AiSystem['onAgentFire']>[0]['staged']>>(
              {
                noDamage: true,
              },
              {
                get heading(): never {
                  return complete.unavailable('heading');
                },
              }
            ),
          }
        : {}),
      animator: checkedFixture<Animator>({ ejectWorld: v() }, complete.makeAgent().animator),
    },
    complete.makeAgent()
  );
  actor(f, 0, { radius: 0.3, owner: agent });
  ai.onAgentFire(agent, v(), v(1, 0));
  assert.equal(f.damage.length, noDamage ? 0 : 1);
  if (!noDamage) assert.ok(f.damage[0].amount < 17);
}

// Penetration can leave a straight safe lane and reach an ally. Resolve once;
// either reject before all publication/weapon state, or publish that exact shot.
for (const friendly of [true, false]) {
  const f = fixture();
  wall(f, 'wood', 0.05);
  let draws = 0,
    traces = 0,
    recoil = 0,
    fires = 0;
  f.phys.ballistics.rng = { gauss: (): number => (++draws % 2 ? 50 : 0) };
  const cast = f.phys.raycast.bind(f.phys);
  f.phys.raycast = (
    a: number | THREE.Vector3Like,
    b: number | THREE.Vector3Like,
    c?: number,
    d?: number,
    e?: unknown,
    f?: number | unknown[] | null,
    g?: number | RaycastIgnore | null,
    h?: number,
    owner?: unknown,
    actors?: unknown[] | null,
    hit?: RaycastIgnore | null
  ): ReturnType<PhysicsSystem['raycast']> => {
    traces++;
    if (typeof a === 'number') {
      assert(typeof b === 'number' && typeof e === 'number' && typeof f === 'number');
      assert(typeof g === 'number' || g === undefined);
      return cast(a, b, c ?? 0, d ?? 0, e, f, g, h, owner, actors, hit);
    }
    assert(typeof b !== 'number');
    assert(typeof f !== 'number');
    assert(typeof g !== 'number');
    return cast(a, b, c, d, e, f, g);
  };
  const ai = new AiSystem();
  applyDefinedPatch(ai, {
    _phys: f.phys,
    agents: [],
    stats: checkedFixture<AiSystem['stats']>(
      { friendlyHolds: 0 },
      {
        get agents(): never {
          return complete.unavailable('agents');
        },
        get alive(): never {
          return complete.unavailable('alive');
        },
        get navMs(): never {
          return complete.unavailable('navMs');
        },
        get coverPts(): never {
          return complete.unavailable('coverPts');
        },
        get walkable(): never {
          return complete.unavailable('walkable');
        },
        get friendlyHolds(): never {
          return complete.unavailable('friendlyHolds');
        },
        get grenadeHolds(): never {
          return complete.unavailable('grenadeHolds');
        },
        get pathsDeferred(): never {
          return complete.unavailable('pathsDeferred');
        },
      }
    ),
    _fireEvent: {
      actor: null,
      weapon: 'ai_rifle',
      seed: 0,
      origin: v(),
      dir: v(),
      intensity: 0.12,
      light: 0.006,
      flashScale: 0.8,
    },
    _shellEvent: { position: v(), velocity: v() },
    ctx: projectileContext(f, true),
  });
  const a = makeAgent({
    ai,
    phys: f.phys,
    ctx: ai.ctx,
    alive: true,
    team: 1,
    state: 'combat',
    wantFire: true,
    hasTarget: true,
    targetVisible: true,
    lastKnownAge: 0,
    lastKnown: v(10),
    spread: 0,
    ammo: 10,
    burstLeft: 3,
    burstCooldown: 0,
    fireCooldown: 0,
    rng: checkedFixture<Rng>({ gauss: (): number => 0 }, new complete.Rng(1)),
    weaponDamage: 40,
    animator: checkedFixture<Animator>(
      {
        reloading: false,
        vaulting: false,
        muzzleWorld: v(),
        muzzleDir: v(1, 0),
        ejectWorld: v(),
        fire: (): void => {
          recoil++;
        },
      },
      complete.makeAgent().animator
    ),
  });
  a._muzzleOk = (): boolean => true;
  const target = makeAgent({ alive: true, team: friendly ? 1 : 0, position: v(8, 0, -1.6) });
  const c = actor(f, 8, { radius: 0.12, owner: target });
  // Scatter at the wood exit is dz/dx = -.03 * (.05 / (.32 * .9)) * 50.
  const z = -(8 - 2.025) * 0.03 * (0.05 / (0.32 * 0.9)) * 50;
  c.setSegment(8, 0.3, z, 8, 1.5, z, 0.12);
  target.position.z = z;
  ai.agents.push(a, target);
  f.events.on('weapon:fire', (): number => fires++);
  assert.equal(
    a._shotBlockedByFriend(v(), v(1, 0)),
    false,
    'straight guard cannot see the deflected contact'
  );
  traces = 0;
  a._shoot(1 / 60);
  const resolved = f.phys.ballistics.result;
  assert.ok(
    resolved.impacts.some((i): boolean => i.actor === target),
    'controlled deflection reaches the off-lane actor'
  );
  assert.equal(draws, 4, 'one resolution: scatter at wood and flesh exits only');
  assert.equal(
    traces,
    5,
    'one physical trace, including overlap probes, without a world-blind safety ray'
  );
  assert.equal(f.damage.length, friendly ? 0 : 1);
  assert.equal(f.effects.length, friendly ? 0 : resolved.impacts.length);
  assert.equal(f.segments.length, friendly ? 0 : resolved.segments.length);
  assert.equal(fires, friendly ? 0 : 1);
  assert.equal(recoil, friendly ? 0 : 1);
  assert.equal(a.ammo, friendly ? 10 : 9);
  assert.equal(a.burstLeft, friendly ? 3 : 2);
  assert.equal(a.fireCooldown > 0, !friendly);
  assert.equal(ai.stats.friendlyHolds, friendly ? 1 : 0);
}

// Near-miss audio and suppression use clipped segments, not infinite muzzle rays.
{
  const plays = [];
  const audio = new AudioSystem();
  applyDefinedPatch(audio, {
    running: true,
    field: checkedFixture<NonNullable<AudioSystem['field']>>(
      { listenerPos: v(10) },
      complete.testSpatialField()
    ),
    _whizzShots: new Float64Array(64),
    _whizzCursor: 0,
    _playAt: (): boolean => {
      plays.push('whizz');
      return true;
    },
  });
  const player = new PlayerSystem();
  let suppressed = 0;
  player.ctx = createTestContext();
  player.ctx.camera.position.copy(v(10));
  player.health = new Health(player.ctx, null);
  player.health.addSuppression = (n): void => {
    suppressed += n;
  };
  const stopped: BulletSegmentEvent = {
    from: v(),
    to: v(2),
    shot: 1,
    shooter: {},
    weapon: null,
    speed: 0,
    tracer: false,
  };
  audio._onBulletSegment(stopped);
  player._onBulletSegment(stopped);
  assert.equal(plays.length, 0);
  assert.equal(suppressed, 0);
  const near = { ...stopped, to: v(12), shot: 2 };
  audio._onBulletSegment(near);
  player._onBulletSegment(near);
  audio._onBulletSegment(near);
  player._onBulletSegment(near);
  assert.equal(plays.length, 1);
  assert.ok(suppressed > 0);
  const previous = suppressed;
  player._onBulletSegment({ ...near, shot: 3, shooter: player });
  assert.equal(suppressed, previous);
}

// Exit spall is distinct, outward-going, and never creates an entry-hole decal.
{
  const particles: Parameters<FxSystem['emitLit']>[0][] = [];
  const fx = new FxSystem();
  applyDefinedPatch(fx, {
    ctx: createTestContext(),
    rng: new Rng(123),
    pScale: 1,
    stats: { spawned: 0, decals: 0, live: 0 },
    emitLit: (s): number => particles.push({ ...s }),
    decals: checkedFixture<NonNullable<FxSystem['decals']>>(
      {
        add: (): never => {
          throw new Error('exit cannot paint an entry crater');
        },
      },
      complete.testDecals()
    ),
  });
  fx.onImpact({
    point: v(),
    normal: v(1, 0),
    incident: v(1, 0),
    surface: 'plaster',
    damage: 30,
    exit: true,
  });
  assert.ok(particles.length > 0);
  assert.ok(particles.every((p): boolean => p.vx >= 0));
}
console.log('smoke-terminal-ballistics: ok');
