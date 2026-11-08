import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import { Vector3 } from 'three';

import { AttachmentQueries, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/attachment-queries.ts';
import type { ClientMessage, LadderQuery, QueryKey } from '../../src/ai/attachment-types.ts';
import {
  parseQueryKey,
  parseClientMessage,
  queryIdentity,
  LADDER_QUERY_MAX_MOVES,
} from '../../src/ai/attachment-types.ts';
import { canStand, checkAttachment } from '../../src/ai/attachment.js';
import { INFANTRY } from '../../src/ai/capabilities.ts';
import {
  LADDER,
  LADDER_MOTOR_VERSION,
  createLadderDescriptors,
  ladderMoveBudget,
  LadderMotor,
} from '../../src/ai/ladder.ts';
import type { LadderDescriptor } from '../../src/ai/ladder.ts';
import { NAV_PROFILE } from '../../src/ai/nav-format.ts';
import type { SurfaceNav } from '../../src/ai/nav.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { CharacterController } from '../../src/physics/character.ts';
import {
  MovementWorker,
  mutableLadder,
  type MutableLadderDescriptor,
} from '../lib/ai-movement-fixture.ts';
import { NativeWorker } from '../lib/attachment-worker-fixture.ts';
import { fixture } from '../lib/fixture.ts';
import { ladderProfiles, ladderCursor as zero, reverseCursor } from '../lib/ladder-fixture.ts';
import { loadMap } from '../lib/nav240/fixtures.ts';

interface LadderQueryInput extends Omit<
  LadderQuery,
  'kind' | 'motorVersion' | 'direction' | 'descriptor' | 'foot'
> {
  foot: { x: number; y: number; z: number };
  kind: string;
  motorVersion: number;
  direction: string;
  descriptor: MutableLadderDescriptor;
}
function mutableQuery(query: LadderQuery): LadderQueryInput {
  return {
    ...structuredClone(query),
    foot: { ...query.foot },
    descriptor: mutableLadder(query.descriptor),
  };
}

// Only the browser transport is adapted. This imports the actual module worker,
// MessageChannel scheduler, snapshot, native BVH/controller and shared motor.
const sleep = (): Promise<void> => new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, 0));
async function until(fn: () => unknown): Promise<void> {
  const end = performance.now() + 10000;
  while (!fn()) {
    assert(performance.now() < end, 'worker check deadline');
    await sleep();
  }
}
const f = await loadMap();
assert(f.meta.volumes);
const descriptors = createLadderDescriptors(f.meta.volumes);
assert.equal(descriptors.length, 6);
const profiles = ladderProfiles();
const probe = new CharacterController(f.physics.staticWorld, {
  stepHeight: INFANTRY.stepHeight,
  slopeLimit: INFANTRY.slopeRadians,
});
const nav = fixture<SurfaceNav>({ physics: f.physics, _probe: probe, repeatState: true });
probe.move =
  probe.setPosition =
  probe.probeGround =
    (): never => assert.fail('eligibility simulated on the main-thread service controller');
const transport: { current: NativeWorker | null } = { current: null };
function currentTransport(): NativeWorker {
  assert(transport.current);
  return transport.current;
}
const service = new AttachmentQueries(nav, {
  profile: true,
  workerFactory: (): NativeWorker => {
    const worker = new NativeWorker({ record: true });
    transport.current = worker;
    return worker;
  },
});
const options = (
  d: LadderDescriptor,
  profile = profiles[0]
): { radius: number; height: number; maxMoves: number } => ({
  radius: profile.radius,
  height: profile.height,
  maxMoves: ladderMoveBudget(d),
});
const payload = (d = descriptors[0]): LadderQuery => ({
  kind: 'ladder',
  motorVersion: LADDER_MOTOR_VERSION,
  descriptor: d,
  direction: 'up',
  foot: d.points[0],
  cursor: zero(),
  ...options(d),
  stepHeight: probe.stepHeight,
  snapDistance: probe.snapDistance,
  slopeLimit: probe.slopeLimit,
  maxIterations: probe.maxIterations,
  mask: probe.mask,
  enabled: probe.enabled,
});
function oracle(query: LadderQuery): {
  value: boolean;
  moves: number;
  failure: LadderMotor['failure'];
} {
  const c = new CharacterController(f.physics.staticWorld, { ...query, position: query.foot });
  c.enabled = query.enabled;
  const motor = new LadderMotor(c, query.descriptor, query.direction, query.maxMoves, query.cursor);
  let moves = 0;
  const move = c.move.bind(c);
  c.move = (...args): number => {
    moves++;
    return move(...args);
  };
  c.setPosition = c.teleport = c.setHeight = (): never => assert.fail('motor relocation/resize');
  try {
    for (let i = 0; i <= query.maxMoves && motor.status === 'active'; i++)
      motor.advance(LADDER.step);
    assert.notEqual(motor.status, 'active', 'oracle bounded by original budget');
    assert.equal(c.stepHeight, query.stepHeight);
    assert.equal(c.snapDistance, query.snapDistance);
    return { value: motor.status === 'complete', moves, failure: motor.failure };
  } finally {
    motor.cancel();
  }
}
const proofs: {
    label: string;
    ladder: number;
    direction: string;
    value: boolean;
    moves: number;
  }[] = [],
  boundaries = [];
let actor = 0;
async function parity(
  input: unknown,
  label: string,
  expected: boolean | null = true
): Promise<ReturnType<typeof oracle>> {
  const query = parseQueryKey(input);
  assert(!Array.isArray(query));
  service.proofs.delete(queryIdentity(query)); // Replay each case through the actual worker, even if geometrically identical.
  const id = ++actor,
    before = service.stats.submitted;
  const run = (): boolean | typeof NAV_PENDING | typeof NAV_CANCELLED =>
    service.run(id, 'ladder', (): boolean =>
      service.checkLadder(query.descriptor, query.direction, query.foot, query.cursor, query)
    );
  assert.equal(run(), NAV_PENDING);
  assert.equal(run(), NAV_PENDING, 'exact retry deduplicates');
  assert.equal(service.stats.submitted, before + 1);
  const job = [...service.jobs.values()].find((j): boolean => j.scope.actor === id);
  assert(job);
  assert.deepEqual(job.key, query, 'query retains every exact number');
  const native = oracle(query);
  await until((): unknown => !service.jobs.has(job.id) || service.error);
  assert.equal(service.error, null);
  const result = currentTransport().results.find((r): boolean => r.id === job.id);
  assert(result);
  assert.equal(result.value, native.value, label);
  assert.equal(result.moves, native.moves, 'worker uses the same native trajectory/budget');
  assert(result.moves <= query.maxMoves - query.cursor.moves);
  assert.equal(run(), native.value);
  if (expected !== null) assert.equal(native.value, expected, label);
  proofs.push({
    label,
    ladder: query.descriptor.id,
    direction: query.direction,
    value: result.value,
    moves: result.moves,
  });
  return native;
}
try {
  await service.start();
  for (const d of descriptors)
    for (const profile of profiles)
      for (const direction of ['up', 'down'] as const) {
        const query = {
          ...payload(d),
          ...options(d, profile),
          direction,
          foot: d.points[direction === 'up' ? 0 : 3],
        };
        await parity(query, `${d.id}/${profile.name}/${direction}`);
        const c = new CharacterController(f.physics.staticWorld, {
          ...query,
          position: query.foot,
        });
        const motor = new LadderMotor(c, d, direction);
        while (motor.phase !== 'shaft' || motor.cursor.distance < 1.5)
          assert.equal(motor.advance(LADDER.step), 'active');
        // Retain a paused backlog and the spent moves from the ORIGINAL budget.
        motor.advance(0.25);
        const cursor = { ...motor.cursor },
          foot = { ...c.position };
        const paused = structuredClone([cursor, foot]);
        motor.advance(0);
        motor.advance(-1);
        assert.deepEqual([motor.cursor, c.position], paused);
        motor.cancel();
        await parity({ ...query, foot, cursor }, `${d.id}/${profile.name}/${direction}/resume`);
        const reverse = reverseCursor(d, cursor);
        await parity(
          { ...query, foot, direction: direction === 'up' ? 'down' : 'up', cursor: reverse },
          `${d.id}/${profile.name}/${direction}/return`
        );
      }

  // End-of-segment equality is legal query input, never normalized or rejected.
  // Current Gate0 has a known motor guard regression here; record parity while
  // parent integrates its separate motor fix. Success is required by default;
  // the explicit parity-only mode records this baseline dependency, not release acceptance.
  for (const d of descriptors)
    for (const direction of ['up', 'down'] as const)
      for (const segment of [0, 1, 2]) {
        const from = d.points[direction === 'up' ? segment : 3 - segment];
        const foot = d.points[direction === 'up' ? segment + 1 : 2 - segment];
        const cursor = {
          segment,
          distance: Math.hypot(foot.x - from.x, foot.y - from.y, foot.z - from.z),
          pendingTime: 0,
          moves: 0,
        };
        const label = `${d.id}/${direction}/boundary-${segment}`;
        const native = await parity(
          { ...payload(d), direction, foot, cursor },
          label,
          process.env.LADDER_BOUNDARY_PARITY_ONLY ? null : true
        );
        boundaries.push({ label, ...native });
      }

  for (const d of descriptors)
    for (const direction of ['up', 'down'] as const)
      for (const transition of [1, 2]) {
        const query = { ...payload(d), direction, foot: d.points[direction === 'up' ? 0 : 3] };
        const c = new CharacterController(f.physics.staticWorld, {
          ...query,
          position: query.foot,
        });
        const motor = new LadderMotor(c, d, direction);
        while (motor.cursor.segment < transition)
          assert.equal(motor.advance(LADDER.step), 'active');
        assert.equal(motor.cursor.distance, 0);
        const segment = 2 - motor.cursor.segment;
        const a = d.points[direction === 'up' ? transition : 3 - transition];
        const b = d.points[direction === 'up' ? transition + 1 : 2 - transition];
        const cursor = {
          segment,
          distance: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z),
          pendingTime: 0,
          moves: 0,
        };
        const foot = { ...c.position };
        motor.cancel();
        const label = `${d.id}/${direction}/native-phase-${transition}-reverse`;
        const native = await parity(
          { ...query, direction: direction === 'up' ? 'down' : 'up', foot, cursor },
          label,
          process.env.LADDER_BOUNDARY_PARITY_ONLY ? null : true
        );
        boundaries.push({ label, ...native });
      }

  const d = descriptors[0];
  await parity({ ...payload(d), maxMoves: 1 }, 'short budget rejects only its own key', false);
  const fullBefore = service.stats.submitted;
  assert.equal(
    service.run(++actor, 'full', (): boolean =>
      service.checkLadder(d, 'up', d.points[0], zero(), options(d))
    ),
    true
  );
  assert.equal(
    service.stats.submitted,
    fullBefore,
    'short-budget failure did not poison original full success'
  );
  const miss = { ...d.points[0], x: d.points[0].x + 0.001 };
  await parity({ ...payload(d), foot: miss }, 'off-trajectory foot is a physical rejection', false);
  async function walkingParity(label: string): Promise<void> {
    service.clear();
    const from = new Vector3().copy(d.points[0]),
      to = from.clone().addScaledVector(new Vector3().copy(d.normal), 0.2);
    const oracleNav = {
      physics: f.physics,
      _probe: new CharacterController(f.physics.staticWorld, {
        stepHeight: probe.stepHeight,
        slopeLimit: probe.slopeLimit,
        snapDistance: probe.snapDistance,
      }),
      _p0: new Vector3(),
      _p1: new Vector3(),
      stats: { endpointChecks: 0 },
      canStand,
    };
    const native = checkAttachment.call(oracleNav, from, to, 0.36, NAV_PROFILE.height, 80);
    const id = ++actor,
      run = (): boolean | typeof NAV_PENDING | typeof NAV_CANCELLED =>
        service.run(id, label, (): boolean =>
          service.request(from, to, 0.36, NAV_PROFILE.height, 80)
        );
    assert.equal(run(), NAV_PENDING);
    const job = [...service.jobs.values()].find((j): boolean => j.scope.actor === id);
    assert(job);
    assert.deepEqual(job.key, [
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      0.36,
      NAV_PROFILE.height,
      80,
    ]);
    await until((): boolean => !service.jobs.has(job.id));
    assert.equal(run(), native);
    assert.equal(native, true);
  }
  await walkingParity('walking before ladder overrides');
  await parity(
    { ...payload(d), maxIterations: 32, stepHeight: 0.123, snapDistance: 0.456 },
    'exact supported option overrides/32 iteration bound'
  );
  await walkingParity('walking after ladder overrides');

  const base = parseQueryKey(payload()),
    identity = queryIdentity(base);
  assert(!Array.isArray(base));
  const identityChanges: ((q: LadderQueryInput) => unknown)[] = [
    (q): number => (q.foot.x += 1e-12),
    (q): number => (q.cursor.pendingTime = 1e-12),
    (q): number => (q.cursor.moves = 1),
    (q): number => q.maxMoves--,
    (q): string => (q.direction = 'down'),
    (q): number => (q.descriptor.radius += 1e-12),
    (q): number => (q.descriptor.points[0].x += 1e-12),
    (q): number => (q.radius += 1e-12),
    (q): number => (q.height += 1e-12),
    (q): number => (q.stepHeight += 1e-12),
    (q): number => (q.snapDistance += 1e-12),
    (q): number => (q.slopeLimit += 1e-12),
    (q): number => q.maxIterations++,
  ];
  for (const change of identityChanges) {
    const query = mutableQuery(base);
    change(query);
    assert.notEqual(
      queryIdentity(parseQueryKey(query)),
      identity,
      'exact state/profile/direction has its own proof'
    );
  }
  const signed = mutableQuery(base);
  signed.descriptor.normal.y = -0;
  assert.notEqual(
    queryIdentity(parseQueryKey(signed)),
    identity,
    'tagged identity preserves signed zero too'
  );
  const walking = [1, 2, 3, 4, 5, 6, 0.36, 1.8, 80];
  assert.equal(
    queryIdentity(parseQueryKey(walking)),
    walking.join(','),
    'walking nine-number identity unchanged'
  );

  const invalid: ((q: LadderQueryInput) => unknown)[] = [
    (q): number => q.motorVersion++,
    (q): string => (q.kind = 'walk'),
    (q): string => (q.direction = 'sideways'),
    (q): unknown => q.descriptor.points.pop(),
    (q): unknown => (q.descriptor.points[2] = { ...q.descriptor.points[1] }),
    (q): number => (q.descriptor.points[2].y = Infinity),
    (q): number => (q.descriptor.points[0].x = NaN),
    (q): number => (q.descriptor.normal.x *= 2),
    (q): number => (q.descriptor.normal.y = 0.1),
    (q): number => q.descriptor.id++,
    (q): number => (q.descriptor.volumeIndex = 1024),
    (q): number => (q.descriptor.radius = 0),
    (q): number => (q.descriptor.points[2].y += 13),
    (q): number => (q.foot.x = NaN),
    (q): number => (q.maxMoves = LADDER_QUERY_MAX_MOVES + 1),
    (q): number => (q.maxMoves = 0),
    (q): number => (q.cursor.segment = 3),
    (q): number => (q.cursor.distance = -1),
    (q): number => (q.cursor.distance = Infinity),
    (q): number => (q.cursor.moves = q.maxMoves + 1),
    (q): number => (q.cursor.pendingTime = NaN),
    (q): number => (q.radius = -1),
    (q): number => (q.height = q.radius),
    (q): number => (q.height = Infinity),
    (q): number => (q.stepHeight = -1),
    (q): number => (q.snapDistance = NaN),
    (q): number => (q.slopeLimit = Math.PI),
    (q): number => (q.mask = 0),
    (q): boolean => (q.enabled = false),
    ...['stepHeight', 'snapDistance', 'slopeLimit', 'maxIterations', 'mask', 'enabled'].map(
      (field): ((q: LadderQueryInput) => void) =>
        (q: LadderQueryInput): void => {
          Object.defineProperty(q, field, { value: null });
        }
    ),
    ...[33, 1.5, NaN, Infinity].map(
      (n): ((q: LadderQueryInput) => number) =>
        (q: LadderQueryInput): number =>
          (q.maxIterations = n)
    ),
  ];
  const before = [service.stats.submitted, service.stats.motorMoves, service.proofs.size];
  for (const change of invalid) {
    const query = mutableQuery(base);
    change(query);
    assert.throws((): QueryKey => parseQueryKey(query), /invalid/);
    assert.throws(
      (): ClientMessage =>
        parseClientMessage({ type: 'queries', jobs: [{ id: 1, actor: 1, key: query }] }),
      /invalid/
    );
    if (query.motorVersion === LADDER_MOTOR_VERSION && query.kind === 'ladder') {
      // Deliberately malformed external input must still reach the runtime validator.
      assert.throws(
        (): unknown =>
          service.run(++actor, 'invalid', (): unknown =>
            Reflect.apply(service.checkLadder.bind(service), service, [
              query.descriptor,
              query.direction,
              query.foot,
              query.cursor,
              query,
            ])
          ),
        /invalid/
      );
    }
  }
  assert.deepEqual(
    [service.stats.submitted, service.stats.motorMoves, service.proofs.size],
    before,
    'invalid input enqueues/simulates/caches nothing'
  );

  service.paused = true;
  assert.equal(
    service.run(++actor, 'pause', (): never => assert.fail('pause evaluated caller')),
    NAV_PENDING
  );
  service.paused = false;
  service.clear();
  const movingFoot = new Vector3().copy(d.points[0]),
    movingActor = ++actor;
  const moving = (): boolean | typeof NAV_PENDING | typeof NAV_CANCELLED =>
    service.run(
      movingActor,
      'moving',
      (): boolean => service.checkLadder(d, 'up', movingFoot, zero(), options(d)),
      movingFoot
    );
  assert.equal(moving(), NAV_PENDING);
  const cancelled = [...service.jobs.keys()][0];
  movingFoot.x += 1e-12;
  assert.equal(moving(), NAV_CANCELLED);
  service.receive({ type: 'result', id: cancelled, value: true, ms: 0, moves: 0 });
  assert.equal(service.proofs.size, 0);
  assert.equal(service.jobs.size, 0, 'late cancelled result cannot resurrect proof');

  // Transport test invokes only real onmessage handlers in one turn so queue
  // cancellation happens before MessageChannel begins its full native checks.
  await until(
    (): boolean =>
      currentTransport().results.some((r): boolean => r.id === cancelled) ||
      service.stats.cancelled > 0
  );
  const resultsStart = currentTransport().results.length;
  currentTransport().batch([
    {
      type: 'queries',
      jobs: [
        { id: 900001, actor: 1, key: base },
        { id: 900002, actor: 1, key: base },
        { id: 900003, actor: 1, key: base },
        { id: 900004, actor: 2, key: base },
        { id: 900005, actor: 3, key: base },
        { id: 900006, actor: 4, key: base },
      ],
    },
    { type: 'cancel', ids: [900006] },
  ]);
  await until(
    (): boolean => currentTransport().results.filter((r): boolean => r.id >= 900001).length === 5
  );
  assert.deepEqual(
    currentTransport()
      .results.slice(resultsStart)
      .filter((r): boolean => r.id >= 900001)
      .map((r): number => r.id),
    [900001, 900004, 900005, 900002, 900003],
    'round-robin actor fairness between bounded full native checks'
  );

  const generation = service.generation;
  f.physics.staticWorld.version++;
  assert.equal(
    service.run(++actor, 'revision', (): never => assert.fail('stale collision admitted')),
    NAV_PENDING
  );
  await service.start();
  assert.equal(service.generation, generation + 1);
  assert.equal(service.proofs.size, 0);
  await parity(payload(), 'new collision revision');
  probe.snapDistance += 0.001;
  assert.equal(
    service.run(++actor, 'config', (): never => assert.fail('stale options admitted')),
    NAV_PENDING
  );
  await service.start();
  await parity(payload(), 'new native settings generation');
  const original = f.physics.staticWorld,
    replacement = Object.assign(new StaticWorld(), original);
  f.physics.staticWorld = replacement;
  probe.world = replacement;
  assert.equal(
    service.run(++actor, 'replacement', (): never =>
      assert.fail('same-version replacement admitted')
    ),
    NAV_PENDING
  );
  await service.start();
  await parity(payload(), 'same-version new collision object');

  const submissions = service.stats.submitted;
  replacement.dispose();
  assert.equal(
    service.run(++actor, 'disposed-source', (): boolean =>
      service.checkLadder(d, 'up', d.points[0], zero(), options(d))
    ),
    NAV_CANCELLED,
    'dead original source cancels before a cached success, not blocked or eternally pending'
  );
  assert.equal(service.stats.submitted, submissions);
  assert.equal(service.proofs.size, 0);
  assert.equal(service.jobs.size, 0);
  assert.equal(service.ready, false);
  f.physics.staticWorld = original;
  probe.world = original;
  await service.start();
  await parity(payload(), 'source disposal/reinitialization recovery');

  service.clear();
  service.run(++actor, 'limits', (): void => {
    for (let i = 0; i < 300; i++)
      service.checkLadder(
        d,
        'up',
        { ...d.points[0], x: d.points[0].x + i * 1e-10 },
        zero(),
        options(d)
      );
  });
  assert.equal(service.jobs.size, 256);
  assert.equal(service.stats.maxPending, 256);
  service.clear();
  for (let i = 0; i < 600; i++) service.remember(`bounded-${i}`, true);
  assert.equal(service.proofs.size, 512);
  assert.equal(service.proofs.has('bounded-0'), false);
  await service.start();
  assert.equal(service.proofs.size, 0, 'cache bound is per generation');

  const bad = structuredClone(base);
  bad.maxIterations = 33;
  currentTransport().batch([
    {
      type: 'queries',
      jobs: [
        { id: 990001, actor: 1, key: base },
        { id: 990002, actor: 1, key: bad },
      ],
    },
    { type: 'queries', jobs: [{ id: 990003, actor: 1, key: base }] },
  ]);
  await until((): Error | null => service.error);
  assert(service.error);
  assert.match(service.error.message, /invalid ladder profile/);
  assert(
    !currentTransport().results.some((r): boolean => r.id >= 990001),
    'malformed batch fails before native checks; worker error is terminal'
  );
  assert.throws(
    (): boolean | typeof NAV_PENDING | typeof NAV_CANCELLED =>
      service.run(++actor, 'terminal', (): boolean => true),
    /invalid ladder profile/
  );
} finally {
  service.dispose();
}

// Query deadline and worker message corruption must fail terminally, never run
// a synchronous native fallback. No collision snapshot regeneration is needed.

for (const control of ['deadline', 'malformed', 'inactive', 'death', 'dispose']) {
  const worker = new MovementWorker();
  const s = new AttachmentQueries(nav, { workerFactory: (): MovementWorker => worker });
  try {
    await s.start();
    s.run(1, 'control', (): boolean =>
      s.checkLadder(descriptors[0], 'up', descriptors[0].points[0], zero(), options(descriptors[0]))
    );
    const job = [...s.jobs.values()][0];
    if (control === 'deadline') {
      job.sent -= 10001;
      assert.throws((): void => s.update(1, new Set([1])), /deadline/);
      assert(worker.terminated);
    } else if (control === 'malformed') {
      worker.deliver({ type: 'result', id: job.id, value: true, ms: 0, moves: NaN });
      assert.throws(
        (): boolean | typeof NAV_PENDING | typeof NAV_CANCELLED =>
          s.run(1, 'control', (): boolean => true),
        /malformed/
      );
      assert(worker.terminated);
    } else if (control === 'inactive' || control === 'death') {
      s.update(control === 'inactive' ? 121 : 1, new Set(control === 'death' ? [] : [1]));
      assert.equal(s.jobs.size, 0);
    } else {
      s.dispose();
      assert.equal(s.jobs.size, 0);
      assert.equal(s.ready, false);
      assert(worker.terminated);
    }
  } finally {
    s.dispose();
  }
}
const report = {
  sourceHash: f.meta.sourceHash,
  collision: f.meta.assets.collision,
  proofs,
  boundaries,
  boundaryDependencyFailures: boundaries.filter((b): boolean => !b.value),
  stats: service.stats,
  limits: {
    outstanding: 256,
    cachePerGeneration: 512,
    nativeIterations: 32,
    maxMoves: LADDER_QUERY_MAX_MOVES,
  },
};
if (process.env.LADDER_WORKER_REPORT)
  writeFileSync(process.env.LADDER_WORKER_REPORT, JSON.stringify(report, null, 2));
console.log(
  `ladder worker: ${proofs.length} real native parity cases; ${report.boundaryDependencyFailures.length} known Gate0 boundary failures; exact tagged identity, invalid inputs, fairness, cancellation, generations, limits and terminal errors`
);
