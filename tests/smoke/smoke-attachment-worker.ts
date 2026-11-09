import assert from 'node:assert/strict';

import * as THREE from 'three';

import { AttachmentQueries, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/attachment-queries.ts';
import type { AttachmentOracle } from '../../src/ai/attachment-types.ts';
import { canStand, checkAttachment } from '../../src/ai/attachment.ts';
import type { BakedCoverPoint } from '../../src/ai/nav-format.ts';
import type { NavCache } from '../../src/ai/nav.ts';
import { CoverMap, SurfaceNav } from '../../src/ai/nav.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { CharacterController } from '../../src/physics/character.ts';
import type { PhysicsSystem } from '../../src/physics/index.ts';
import { MASK } from '../../src/physics/surfaces.ts';
import { MovementWorker } from '../lib/ai-movement-fixture.ts';
import { fixture } from '../lib/fixture.ts';

const world = new StaticWorld(),
  controller = new CharacterController(world);
const nav = fixture<SurfaceNav>({
  physics: fixture<PhysicsSystem>({
    staticWorld: world,
    gravity: -20,
    MASK: { ...MASK, CHARACTER: 259 },
  }),
  _probe: controller,
  repeatState: true,
});
const worker = new MovementWorker();
const service = new AttachmentQueries(nav, { workerFactory: (): MovementWorker => worker });
await service.start();
assert(service.ready);
const a = new THREE.Vector3(),
  b = new THREE.Vector3(1, 0, 0);
const run = (
  to = b,
  radius = 0.36,
  height = 1.8,
  steps = 80
): boolean | typeof NAV_PENDING | typeof NAV_CANCELLED =>
  service.run(1, 'path', (): boolean => service.request(a, to, radius, height, steps));
const result = (id: number, value: boolean): void =>
  service.receive({ type: 'result', id, value, ms: 1, moves: 80 });
assert.equal(run(), NAV_PENDING, 'unknown is pending, never an unreachable path');
assert.equal(run(), NAV_PENDING);
assert.equal(service.jobs.size, 1, 'one in-flight proof per exact key');
let id = [...service.jobs.keys()][0];
result(id, false);
assert.equal(run(), false, 'only a completed native false may publish failure');
assert.equal(service.jobs.size, 0);
assert.equal(service.samples.length, 0, 'detailed recording is opt-in; counters still advance');
assert.equal(service.stats.completed, 1);
assert.equal(service.stats.decisions, 1);
service.collectSamples = true;
const recordedTarget = new THREE.Vector3(2, 0, 0);
assert.equal(run(recordedTarget), NAV_PENDING);
result([...service.jobs.keys()][0], true);
assert.equal(run(recordedTarget), true);
assert.deepEqual(
  service.samples.map((s): string => s.type),
  ['query', 'decision'],
  'profiling keeps query and admission samples'
);
assert.equal(
  service.samples[0].type === 'query' ? service.samples[0].key : undefined,
  undefined,
  'collecting samples alone does not enable detailed worker instrumentation'
);
assert.equal(
  new AttachmentQueries(nav, { profile: true }).collectSamples,
  true,
  'worker profiling enables collection'
);
assert.equal(run(new THREE.Vector3(1 + 1e-12, 0, 0)), NAV_PENDING, 'no coordinate quantization');
assert.equal(run(b, 0.37), NAV_PENDING);
assert.equal(run(b, 0.36, 1.9), NAV_PENDING);
assert.equal(run(b, 0.36, 1.8, 81), NAV_PENDING);
assert.equal(
  service.run(1, 'path', (): boolean => service.request(b, a, 0.36, 1.8, 80)),
  NAV_PENDING,
  'ordered endpoints'
);
// Superseding a live origin is not physical failure and must not publish claims.
const origin = new THREE.Vector3(0.7, 0, 0),
  destination = new THREE.Vector3(15, 0, 0);
const moving = (): boolean | typeof NAV_PENDING | typeof NAV_CANCELLED =>
  service.run(
    1,
    'moving',
    (): boolean => service.request(origin, destination, 0.36, 1.8, 80),
    origin
  );
assert.equal(moving(), NAV_PENDING);
const movingId = [...service.jobs.keys()].at(-1);
origin.x += 0.01;
assert.equal(
  service.run(
    1,
    'moving',
    (): never => {
      throw new Error('superseded plan ran');
    },
    origin
  ),
  NAV_CANCELLED
);
assert.equal(service.stats.superseded, 1);
assert(movingId !== undefined);
assert.ok(!service.jobs.has(movingId));
assert.equal(moving(), NAV_PENDING, 'a later intent can retry the new exact origin');
service.cancel('1:moving');
const old = [...service.jobs.keys()];
world.version++;
assert.equal(run(), NAV_PENDING, 'revision is checked at use, not only at frame start');
await service.start();
for (const id of old) result(id, true);
assert.equal(service.jobs.size, 0);
assert.equal(run(), NAV_PENDING, 'late old-generation responses cannot populate proofs');
result([...service.jobs.keys()][0], true);
assert.equal(run(), true);
for (const field of [
  'stepHeight',
  'slopeLimit',
  'snapDistance',
  'maxIterations',
  'mask',
] as const) {
  controller[field] += 1;
  assert.equal(run(), NAV_PENDING, `${field} invalidates`);
  await service.start();
  assert.equal(run(), NAV_PENDING);
  result([...service.jobs.keys()][0], true);
  assert.equal(run(), true);
}
controller.enabled = false;
assert.equal(run(), NAV_PENDING);
await service.start();
nav.physics.gravity--;
assert.equal(run(), NAV_PENDING);
await service.start();
nav.physics.MASK.CHARACTER++;
assert.equal(run(), NAV_PENDING);
await service.start();
world.dirty = true;
assert.equal(run(), NAV_PENDING);
world.dirty = false;
assert.equal(run(), NAV_PENDING);
service.update(1, new Set());
assert.equal(service.jobs.size, 0, 'dead actors cancel work');
assert(worker.messages.some((m): boolean => m.type === 'cancel'));
assert.throws(
  (): unknown =>
    service.run(1, 'throw', (): never => {
      service.request(a, b, 0.36, 1.8, 80);
      throw new Error('original');
    }),
  /original/
);
assert.equal(service.current, null);
assert.equal(service.jobs.size, 0, 'failed attempt releases unsent jobs');

// Retry pruning and whole-scope cancellation share removal, not proof admission.
const pruningWorker = new MovementWorker();
const pruning = new AttachmentQueries(nav, { workerFactory: (): MovementWorker => pruningWorker });
await pruning.start();
const targets = [10, 11, 12, 13, 14].map((x): THREE.Vector3 => new THREE.Vector3(x, 0, 0));
const ask = (index: number): boolean => pruning.request(a, targets[index], 0.36, 1.8, 80);
assert.equal(
  pruning.run(7, 'path', (): void => {
    ask(0);
    ask(1);
    ask(2);
  }),
  NAV_PENDING
);
assert.equal(
  pruning.run(8, 'path', (): boolean => ask(3)),
  NAV_PENDING
);
const [firstId, keptId, thirdId, otherId] = pruning.jobs.keys();
const scope = pruning.scopes.get('7:path');
assert(scope);
const messages = pruningWorker.messages;
const beforePruning = messages.length;
assert.equal(
  pruning.run(7, 'path', (): void => {
    ask(1);
    ask(4);
  }),
  NAV_PENDING
);
const newId = [...pruning.jobs.keys()].at(-1);
assert(newId !== undefined);
assert.deepEqual([...pruning.jobs.keys()], [keptId, otherId, newId]);
assert.deepEqual(
  [...scope.proofs.values()].map((proof): number => proof.id),
  [keptId, newId]
);
assert.deepEqual(
  messages.slice(beforePruning).map((message): string => message.type),
  ['cancel', 'queries']
);
const cancellation = messages[beforePruning];
assert(cancellation.type === 'cancel');
assert.deepEqual(cancellation.ids, [firstId, thirdId], 'cancel in submission order');
assert.equal(pruning.stats.cancelled, 2);
assert.equal(pruning.stats.pending, 3);
pruning.receive({ type: 'result', id: keptId, value: true, ms: 0, moves: 0 });
const proofCount = pruning.proofs.size;
pruning.cancel('7:path');
assert.deepEqual(messages.at(-1), { type: 'cancel', ids: [newId] });
assert.deepEqual([...pruning.jobs.keys()], [otherId], 'unrelated actor work survives');
assert.equal(pruning.scopes.has('7:path'), false);
assert.equal(pruning.stats.cancelled, 3);
assert.equal(pruning.stats.pending, 1);
assert.equal(pruning.proofs.size, proofCount, 'scope cancellation retains completed static proofs');
pruning.receive({ type: 'result', id: newId, value: true, ms: 0, moves: 0 });
assert.equal(pruning.proofs.size, proofCount, 'cancelled results cannot enter the proof cache');
assert.equal(pruning.stats.stale, 1);
pruning.dispose();
assert.equal(pruning.stats.pending, 0);

// A ready lower-ranked candidate cannot leapfrog an unresolved better one,
// and a pending attempt cannot release or acquire live cover claims.
const points = [0, 2].map((x): BakedCoverPoint => ({
  x,
  y: 0,
  z: 0,
  dx: 0,
  dz: 1,
  dist: 1,
  high: false,
  surface: 1,
  component: 1,
  claimed: -1,
}));
const grid = fixture<SurfaceNav>({
  worker: service,
  coverPoints: points,
  components: new Map([[1, 1]]),
  walkingComponents: new Map([[1, 1]]),
  project(p, out, _cache, goal): number {
    out.copy(p);
    return !goal || service.request(p, { x: p.x + 0.2, y: p.y, z: p.z }, 0.36, 1.8, 80) ? 1 : 0;
  },
});
const cover = new CoverMap(grid, fixture<PhysicsSystem>({}));
cover.protects = (): true => true;
cover.peekOffset = (): number => 0;
const pick = (): ReturnType<CoverMap['pick']> =>
  cover.pick(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 10), { id: 1 });
assert.equal(pick(), NAV_PENDING);
const jobs = [...service.jobs.values()];
assert.equal(jobs.length, 2);
result(jobs[1].id, true);
assert.equal(pick(), NAV_PENDING);
assert(points.every((p): boolean => p.claimed === -1));
result(jobs[0].id, false);
assert.equal(pick(), points[1]);
assert.equal(points[1].claimed, 1);
points[1].claimed = 2;
assert.equal(pick(), null, 'current claims are reevaluated, not returned from a worker snapshot');
service.clear();
assert.equal(service.scopes.size, 0);
worker.deliver({ type: 'result', id: 999, value: 'false', ms: 0, moves: 0 });
assert.throws((): boolean | typeof NAV_PENDING | typeof NAV_CANCELLED => run(), /malformed/);
service.dispose();
assert(worker.terminated);

// Endpoint caches must share the worker generation, including cached failures.
const endpointResults = [];
for (const change of ['controller-config', 'world-identity']) {
  const makeWorld = (wall: boolean): StaticWorld => {
    const w = new StaticWorld();
    w.addTriangles(
      new Float32Array([-3, 0, -3, -3, 0, 3, 3, 0, 3, 3, 0, 3, 3, 0, -3, -3, 0, -3]),
      2,
      'concrete'
    );
    if (wall)
      w.addTriangles(
        new Float32Array([
          0.25, 0, -2, 0.25, 0, 2, 0.25, 3, 2, 0.25, 3, 2, 0.25, 3, -2, 0.25, 0, -2,
        ]),
        2,
        'concrete'
      );
    w.build();
    return w;
  };
  const physics = fixture<PhysicsSystem>({
    staticWorld: makeWorld(false),
    gravity: -20,
    MASK: { ...MASK, CHARACTER: 259 },
    checkCapsule(a, b, r, m): boolean {
      return (
        physics.staticWorld.overlapCapsule(
          a.x,
          a.y,
          a.z,
          b.x,
          b.y,
          b.z,
          r,
          m ?? physics.MASK.CHARACTER,
          0
        ) === 0
      );
    },
  });
  const endpoint = new THREE.Vector3(0.5, 0.008, 0),
    source = new THREE.Vector3(0, 0.008, 0),
    output = new THREE.Vector3();
  const grid = fixture<SurfaceNav>({
    project(...args): ReturnType<SurfaceNav['project']> {
      return SurfaceNav.prototype.project.apply(this, args);
    },
    canStand(...args): ReturnType<SurfaceNav['canStand']> {
      return SurfaceNav.prototype.canStand.apply(this, args);
    },
    canAttach(...args): ReturnType<SurfaceNav['canAttach']> {
      return SurfaceNav.prototype.canAttach.apply(this, args);
    },
    _checkAttachment(...args): ReturnType<SurfaceNav['_checkAttachment']> {
      return SurfaceNav.prototype._checkAttachment.apply(this, args);
    },
    worker: null,
    repeatState: true,
    physics,
    _probe: new CharacterController(physics.staticWorld),
    _p0: new THREE.Vector3(),
    _p1: new THREE.Vector3(),
    _source: new THREE.Vector3(),
    meta: {},
    components: new Map([[1, 1]]),
    walkingComponents: new Map([[1, 1]]),
    stats: fixture<SurfaceNav['stats'] & AttachmentOracle['stats']>(
      { endpointChecks: 0, cacheHits: 0 },
      ['repeatedStates', 'savedMoves']
    ),
    query: fixture<SurfaceNav['query']>({
      findNearestPoly: (): ReturnType<SurfaceNav['query']['findNearestPoly']> => ({
        success: true,
        status: 0,
        nearestRef: 1,
        nearestPoint: endpoint,
        isOverPoly: true,
      }),
      closestPointOnPoly: (): ReturnType<SurfaceNav['query']['closestPointOnPoly']> => ({
        success: true,
        status: 0,
        isPointOverPoly: true,
        closestPoint: endpoint,
      }),
    }),
  });
  grid.worker = new AttachmentQueries(grid, {
    workerFactory: (): MovementWorker => new MovementWorker(),
  });
  await grid.worker.start();
  const cache: NavCache = {
    nav: null,
    version: 0,
    position: new THREE.Vector3(),
    point: new THREE.Vector3(),
    ref: 0,
  };
  assert.equal(grid.project(source, output, cache), 1);
  assert(grid._probe);
  if (change === 'controller-config') grid._probe.enabled = false;
  else {
    const replacement = makeWorld(true);
    assert.equal(
      replacement.version,
      physics.staticWorld.version,
      'replacement deliberately has the same numeric version'
    );
    physics.staticWorld = replacement;
    grid._probe.world = replacement;
  }
  assert.equal(
    grid.project(source, output, cache),
    0,
    `${change}: invalidate at use before service restart`
  );
  await grid.worker.start();
  assert.equal(grid._checkAttachment(source, endpoint, 0.36, 1.8245, 80), false);
  endpointResults.push([change, grid.project(source, output, cache)]);
  if (change === 'controller-config') grid._probe.enabled = true;
  else {
    physics.staticWorld = makeWorld(false);
    grid._probe.world = physics.staticWorld;
  }
  await grid.worker.start();
  assert.equal(
    grid.project(source, output, cache),
    1,
    `${change}: cached failure must also invalidate`
  );
  const attach = grid.canAttach.bind(grid);
  let checks = 0,
    endpoints: [THREE.Vector3, THREE.Vector3] | undefined;
  grid.canAttach = function (...args: Parameters<SurfaceNav['canAttach']>): boolean {
    checks++;
    endpoints = [args[0].clone(), args[1].clone()];
    return attach.apply(this, args);
  };
  assert.equal(grid.project(source, output, cache), 1);
  assert.equal(checks, 0);
  cache.radius = 0.37;
  grid.project(source, output, cache);
  assert.equal(checks, 1, 'radius invalidates endpoint reuse');
  cache.height = 1.7;
  grid.project(source, output, cache);
  assert.equal(checks, 2, 'height invalidates endpoint reuse');
  grid.project(source, output, cache, true);
  assert.equal(checks, 3, 'direction invalidates endpoint reuse');
  assert(endpoints);
  assert(endpoints[0].equals(endpoint) && endpoints[1].equals(source));
  grid.worker.dispose();
}

assert.deepEqual(
  endpointResults,
  [
    ['controller-config', 0],
    ['world-identity', 0],
  ],
  'cached endpoints cannot bypass the new physical proof'
);

// Teardown while init waits must settle without leaving the deadline timer.
const stalled = new AttachmentQueries(nav, {
  workerFactory: (): MovementWorker => new MovementWorker({ silent: true }),
});
const start = stalled.start();
await new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, 0));
stalled.dispose();
await start;
assert.equal(stalled.ready, false);
// Bounded live-origin prefixes are the same motor oracle, not a shorter
// rejection budget. Any undecided walk must be delegated, including successes.
const floor = new StaticWorld();
floor.addTriangles(
  new Float32Array([-3, 0, -3, -3, 0, 3, 3, 0, 3, 3, 0, 3, 3, 0, -3, -3, 0, -3]),
  2,
  'concrete'
);
floor.build();
const physics = fixture<PhysicsSystem>({
  staticWorld: floor,
  gravity: -20,
  MASK: { ...MASK, CHARACTER: 259 },
  checkCapsule: (a, b, r, m): boolean =>
    floor.overlapCapsule(a.x, a.y, a.z, b.x, b.y, b.z, r, m ?? 259, 0) === 0,
});
const probe = fixture<SurfaceNav>({
  physics,
  _probe: new CharacterController(floor),
  _p0: new THREE.Vector3(),
  _p1: new THREE.Vector3(),
  canStand,
  repeatState: true,
  stats: fixture<SurfaceNav['stats'] & AttachmentOracle['stats']>({ endpointChecks: 0 }, [
    'repeatedStates',
    'savedMoves',
  ]),
  canAttach(...args): ReturnType<SurfaceNav['canAttach']> {
    return SurfaceNav.prototype.canAttach.apply(this, args);
  },
});
let moves = 0,
  unknown = 0,
  fast = 0,
  delegated = false;
assert(probe._probe);
const move = probe._probe.move.bind(probe._probe);
probe._probe.move = function (...args): number {
  moves++;
  return move.apply(this, args);
};
probe.worker = fixture<AttachmentQueries>({
  active: true,
  current: fixture<NonNullable<AttachmentQueries['current']>>({}, ['origin']),
  request(): false {
    delegated = true;
    return false;
  },
});
for (const x of [0, 0.0001, 0.1199999, 0.12, 0.1200001, 0.2, 1])
  for (const y of [0.008, 0.1, 0.4])
    for (const steps of [0, 1, 2, 80]) {
      const from = new THREE.Vector3(0, 0.008, 0),
        to = new THREE.Vector3(x, y, 0);
      moves = 0;
      const prefix = checkAttachment.call(probe, from, to, 0.32, 1.78, steps, 1);
      assert(moves <= 1, 'prefix may perform at most one motor move');
      const native = checkAttachment.call(probe, from, to, 0.32, 1.78, steps);
      if (prefix === null) unknown++;
      else assert.equal(prefix, native, 'prefix must prove the full-budget result');
      delegated = false;
      const immediate = SurfaceNav.prototype.canAttach.call(probe, from, to, 0.32, 1.78, steps);
      if (!delegated) {
        fast++;
        assert.equal(immediate, native, 'zero-move shortcut must match native oracle');
      }
    }
assert(unknown > 0 && fast > 0);
console.log(
  'attachment worker: pending/claims, exact identity, revision/config, cancellation, errors, teardown and 84 prefix/zero-move cases'
);
