import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

import { Vector3 } from 'three';

import { AttachmentQueries, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/attachment-queries.js';
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
import { NAV_PROFILE } from '../../src/ai/nav-format.ts';
import { VARIANTS } from '../../src/ai/soldier.ts';
import { CharacterController } from '../../src/physics/character.ts';
import { loadMap } from '../../tools/nav240/fixtures.mjs';

// Only the browser transport is adapted. This imports the actual module worker,
// MessageChannel scheduler, snapshot, native BVH/controller and shared motor.
class NativeWorker {
  messages = [];
  results = [];
  constructor() {
    this.thread = new Worker(
      `const { parentPort } = require('node:worker_threads');
      globalThis.self = { postMessage: m => parentPort.postMessage(m) };
      import(${JSON.stringify(new URL('../../src/ai/attachment-worker.js', import.meta.url).href)}).then(() => {
        parentPort.on('message', data => {
          for (const message of data.__batch ?? [data]) self.onmessage({ data: message });
        });
      }).catch(e => { throw e; });`,
      { eval: true }
    );
    this.thread.on('message', (data) => {
      if (data.type === 'result') this.results.push(data);
      this.onmessage?.({ data });
    });
    this.thread.on('error', (error) => this.onerror?.({ message: error.message }));
  }
  postMessage(message, transfer) {
    this.messages.push(structuredClone(message));
    this.thread.postMessage(message, transfer);
  }
  batch(messages) {
    this.thread.postMessage({ __batch: messages });
  }
  terminate() {
    void this.thread.terminate();
  }
}
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(fn) {
  const end = performance.now() + 10000;
  while (!fn()) {
    assert(performance.now() < end, 'worker check deadline');
    await sleep();
  }
}
const f = await loadMap(),
  descriptors = createLadderDescriptors(f.meta.volumes);
assert.equal(descriptors.length, 6);
const profiles = [
  { name: 'NAV_PROFILE', radius: NAV_PROFILE.radius, height: NAV_PROFILE.height },
  ...Object.entries(VARIANTS).map(([name, v]) => ({
    name,
    radius: INFANTRY.radius * v.scale,
    height: INFANTRY.height * v.scale,
  })),
];
const probe = new CharacterController(f.physics.staticWorld, {
  stepHeight: INFANTRY.stepHeight,
  slopeLimit: INFANTRY.slopeRadians,
});
const nav = { physics: f.physics, _probe: probe };
probe.move =
  probe.setPosition =
  probe.probeGround =
    () => assert.fail('eligibility simulated on the main-thread service controller');
let transport;
const service = new AttachmentQueries(nav, {
  profile: true,
  workerFactory: () => (transport = new NativeWorker()),
});
const zero = () => ({ segment: 0, distance: 0, pendingTime: 0, moves: 0 });
const options = (d, profile = profiles[0]) => ({
  radius: profile.radius,
  height: profile.height,
  maxMoves: ladderMoveBudget(d),
});
const payload = (d = descriptors[0]) => ({
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
function oracle(query) {
  const c = new CharacterController(f.physics.staticWorld, { ...query, position: query.foot });
  c.enabled = query.enabled;
  const motor = new LadderMotor(c, query.descriptor, query.direction, query.maxMoves, query.cursor);
  let moves = 0;
  const move = c.move.bind(c);
  c.move = (...args) => {
    moves++;
    return move(...args);
  };
  c.setPosition = c.teleport = c.setHeight = () => assert.fail('motor relocation/resize');
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
const proofs = [],
  boundaries = [];
let actor = 0;
async function parity(query, label, expected = true) {
  query = parseQueryKey(query);
  service.proofs.delete(queryIdentity(query)); // Replay each case through the actual worker, even if geometrically identical.
  const id = ++actor,
    before = service.stats.submitted;
  const run = () =>
    service.run(id, 'ladder', () =>
      service.checkLadder(query.descriptor, query.direction, query.foot, query.cursor, query)
    );
  assert.equal(run(), NAV_PENDING);
  assert.equal(run(), NAV_PENDING, 'exact retry deduplicates');
  assert.equal(service.stats.submitted, before + 1);
  const job = [...service.jobs.values()].find((j) => j.scope.actor === id);
  assert.deepEqual(job.key, query, 'query retains every exact number');
  const native = oracle(query);
  await until(() => !service.jobs.has(job.id) || service.error);
  assert.equal(service.error, null);
  const result = transport.results.find((r) => r.id === job.id);
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
      for (const direction of ['up', 'down']) {
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
        const reverse = {
          segment: 1,
          distance: d.points[2].y - d.points[1].y - cursor.distance,
          pendingTime: 0,
          moves: 0,
        };
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
    for (const direction of ['up', 'down'])
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
    for (const direction of ['up', 'down'])
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
    service.run(++actor, 'full', () =>
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
  async function walkingParity(label) {
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
      run = () =>
        service.run(id, label, () => service.request(from, to, 0.36, NAV_PROFILE.height, 80));
    assert.equal(run(), NAV_PENDING);
    const job = [...service.jobs.values()].find((j) => j.scope.actor === id);
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
    await until(() => !service.jobs.has(job.id));
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
  for (const change of [
    (q) => (q.foot.x += 1e-12),
    (q) => (q.cursor.pendingTime = 1e-12),
    (q) => (q.cursor.moves = 1),
    (q) => q.maxMoves--,
    (q) => (q.direction = 'down'),
    (q) => (q.descriptor.radius += 1e-12),
    (q) => (q.descriptor.points[0].x += 1e-12),
    (q) => (q.radius += 1e-12),
    (q) => (q.height += 1e-12),
    (q) => (q.stepHeight += 1e-12),
    (q) => (q.snapDistance += 1e-12),
    (q) => (q.slopeLimit += 1e-12),
    (q) => q.maxIterations++,
  ]) {
    const query = structuredClone(base);
    change(query);
    assert.notEqual(
      queryIdentity(parseQueryKey(query)),
      identity,
      'exact state/profile/direction has its own proof'
    );
  }
  const signed = structuredClone(base);
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

  const invalid = [
    (q) => q.motorVersion++,
    (q) => (q.kind = 'walk'),
    (q) => (q.direction = 'sideways'),
    (q) => q.descriptor.points.pop(),
    (q) => (q.descriptor.points[2] = { ...q.descriptor.points[1] }),
    (q) => (q.descriptor.points[2].y = Infinity),
    (q) => (q.descriptor.points[0].x = NaN),
    (q) => (q.descriptor.normal.x *= 2),
    (q) => (q.descriptor.normal.y = 0.1),
    (q) => q.descriptor.id++,
    (q) => (q.descriptor.volumeIndex = 1024),
    (q) => (q.descriptor.radius = 0),
    (q) => (q.descriptor.points[2].y += 13),
    (q) => (q.foot.x = NaN),
    (q) => (q.maxMoves = LADDER_QUERY_MAX_MOVES + 1),
    (q) => (q.maxMoves = 0),
    (q) => (q.cursor.segment = 3),
    (q) => (q.cursor.distance = -1),
    (q) => (q.cursor.distance = Infinity),
    (q) => (q.cursor.moves = q.maxMoves + 1),
    (q) => (q.cursor.pendingTime = NaN),
    (q) => (q.radius = -1),
    (q) => (q.height = q.radius),
    (q) => (q.height = Infinity),
    (q) => (q.stepHeight = -1),
    (q) => (q.snapDistance = NaN),
    (q) => (q.slopeLimit = Math.PI),
    (q) => (q.mask = 0),
    (q) => (q.enabled = false),
    ...['stepHeight', 'snapDistance', 'slopeLimit', 'maxIterations', 'mask', 'enabled'].map(
      (field) => (q) => (q[field] = null)
    ),
    ...[33, 1.5, NaN, Infinity].map((n) => (q) => (q.maxIterations = n)),
  ];
  const before = [service.stats.submitted, service.stats.motorMoves, service.proofs.size];
  for (const change of invalid) {
    const query = structuredClone(base);
    change(query);
    assert.throws(() => parseQueryKey(query), /invalid/);
    assert.throws(
      () => parseClientMessage({ type: 'queries', jobs: [{ id: 1, actor: 1, key: query }] }),
      /invalid/
    );
    if (query.motorVersion === LADDER_MOTOR_VERSION && query.kind === 'ladder') {
      assert.throws(
        () =>
          service.run(++actor, 'invalid', () =>
            service.checkLadder(query.descriptor, query.direction, query.foot, query.cursor, query)
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
    service.run(++actor, 'pause', () => assert.fail('pause evaluated caller')),
    NAV_PENDING
  );
  service.paused = false;
  service.clear();
  const movingFoot = new Vector3().copy(d.points[0]),
    movingActor = ++actor;
  const moving = () =>
    service.run(
      movingActor,
      'moving',
      () => service.checkLadder(d, 'up', movingFoot, zero(), options(d)),
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
    () => transport.results.some((r) => r.id === cancelled) || service.stats.cancelled > 0
  );
  const resultsStart = transport.results.length;
  transport.batch([
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
  await until(() => transport.results.filter((r) => r.id >= 900001).length === 5);
  assert.deepEqual(
    transport.results
      .slice(resultsStart)
      .filter((r) => r.id >= 900001)
      .map((r) => r.id),
    [900001, 900004, 900005, 900002, 900003],
    'round-robin actor fairness between bounded full native checks'
  );

  const generation = service.generation;
  f.physics.staticWorld.version++;
  assert.equal(
    service.run(++actor, 'revision', () => assert.fail('stale collision admitted')),
    NAV_PENDING
  );
  await service.start();
  assert.equal(service.generation, generation + 1);
  assert.equal(service.proofs.size, 0);
  await parity(payload(), 'new collision revision');
  probe.snapDistance += 0.001;
  assert.equal(
    service.run(++actor, 'config', () => assert.fail('stale options admitted')),
    NAV_PENDING
  );
  await service.start();
  await parity(payload(), 'new native settings generation');
  const original = f.physics.staticWorld,
    replacement = Object.assign(Object.create(Object.getPrototypeOf(original)), original);
  f.physics.staticWorld = replacement;
  probe.world = replacement;
  assert.equal(
    service.run(++actor, 'replacement', () => assert.fail('same-version replacement admitted')),
    NAV_PENDING
  );
  await service.start();
  await parity(payload(), 'same-version new collision object');

  const submissions = service.stats.submitted;
  replacement.dispose();
  assert.equal(
    service.run(++actor, 'disposed-source', () =>
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
  service.run(++actor, 'limits', () => {
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
  transport.batch([
    {
      type: 'queries',
      jobs: [
        { id: 990001, actor: 1, key: base },
        { id: 990002, actor: 1, key: bad },
      ],
    },
    { type: 'queries', jobs: [{ id: 990003, actor: 1, key: base }] },
  ]);
  await until(() => service.error);
  assert.match(service.error.message, /invalid ladder profile/);
  assert(
    !transport.results.some((r) => r.id >= 990001),
    'malformed batch fails before native checks; worker error is terminal'
  );
  assert.throws(() => service.run(++actor, 'terminal', () => true), /invalid ladder profile/);
} finally {
  service.dispose();
}

// Query deadline and worker message corruption must fail terminally, never run
// a synchronous native fallback. No collision snapshot regeneration is needed.
class SilentWorker {
  postMessage(message) {
    if (message.type === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready' } }));
  }
  terminate() {
    this.terminated = true;
  }
}
for (const control of ['deadline', 'malformed', 'inactive', 'death', 'dispose']) {
  let worker;
  const s = new AttachmentQueries(nav, { workerFactory: () => (worker = new SilentWorker()) });
  try {
    await s.start();
    s.run(1, 'control', () =>
      s.checkLadder(descriptors[0], 'up', descriptors[0].points[0], zero(), options(descriptors[0]))
    );
    const job = [...s.jobs.values()][0];
    if (control === 'deadline') {
      job.sent -= 10001;
      assert.throws(() => s.update(1, new Set([1])), /deadline/);
      assert(worker.terminated);
    } else if (control === 'malformed') {
      worker.onmessage({ data: { type: 'result', id: job.id, value: true, ms: 0, moves: NaN } });
      assert.throws(() => s.run(1, 'control', () => true), /malformed/);
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
  boundaryDependencyFailures: boundaries.filter((b) => !b.value),
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
