import assert from 'node:assert/strict';

import type { Vector3Like } from 'three';
import { Vector3 } from 'three';

import { AttachmentQueries } from '../../src/ai/attachment-queries.ts';
import type { WorkerMessage } from '../../src/ai/attachment-types.ts';
import { createLadderDescriptors, ladderMoveBudget } from '../../src/ai/ladder.ts';
import type { NavMetadata, ExpectedNav } from '../../src/ai/nav-format.ts';
import { unpackNav, packNav, NAV_LINK_RADIUS } from '../../src/ai/nav-format.ts';
import type { NavRoute, NavCache } from '../../src/ai/nav.ts';
import { SurfaceNav, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/nav.ts';
import { makeAgent, makeAi } from '../lib/agent-fixture.ts';
import { mutableLadder, type MutableLadderDescriptor } from '../lib/ai-movement-fixture.ts';
import { NativeWorker } from '../lib/attachment-worker-fixture.ts';
import { ladderProfiles } from '../lib/ladder-fixture.ts';
import { loadMap } from '../lib/nav240/fixtures.ts';

// Browser transport only: all route proofs use the production module worker.
const f = await loadMap();
assert(f.meta.volumes);
const descriptors = createLadderDescriptors(f.meta.volumes);
assert(f.meta.navigation);
const expected = { sha256: f.meta.navigation.sha256, ladders: descriptors };
const bake = await unpackNav(f.surfaceRaw, expected);
assert.equal(bake.meta.version, 2);
assert.equal(descriptors.length, 6);
assert.deepEqual(
  bake.meta.ladders,
  descriptors,
  'full precision authored coordinates survive encoding'
);
const nav = await SurfaceNav.load(f.surfaceRaw, f.physics, expected);
assert.equal(nav.ladderLinks.size, 6);
assert.equal(new Set(nav.walkingComponents.values()).size, 245);
assert.equal(new Set(nav.components.values()).size, 239);
const v = (p: Vector3Like): Vector3 => new Vector3().copy(p);
for (const d of descriptors) {
  const before = [v({ x: 123, y: 456, z: 789 })],
    snapshot = JSON.stringify(before);
  assert.equal(
    nav.findPath(v(d.points[0]), v(d.points[3]), before),
    0,
    'old Vector3[] API cannot consume a ladder'
  );
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(
    nav.lineOfWalk(v(d.points[0]), v(d.points[3])),
    false,
    'linked components are not a walking shortcut'
  );
  assert.equal(nav.canVault(v(d.points[0]), v(d.points[3]), v(d.points[3])), false);
  const out = { points: before, ladderSteps: [] };
  assert.equal(
    nav.findRoute(v(d.points[0]), v(d.points[3]), out),
    0,
    'no synchronous full ladder oracle fallback'
  );
  assert.equal(JSON.stringify(before), snapshot);
}
assert(nav._probe);
const originalFoot = nav._probe.move.bind(nav._probe),
  originalOracle = nav._checkAttachment.bind(nav);
let immediateMoves = 0;
nav._probe.move = function (...args): number {
  immediateMoves++;
  return originalFoot.apply(this, args);
};
nav._checkAttachment = (): never => assert.fail('route proof executed a full main-thread oracle');
const service = (nav.worker = new AttachmentQueries(nav, {
  profile: true,
  workerFactory: (): NativeWorker => new NativeWorker(),
}));
const profiles = ladderProfiles();
let proofCount = 0;
const nativeSolve = nav.query.findPath.bind(nav.query);
let graphSolves = 0;
const graphActors: number[] = [];
nav.query.findPath = (...args): ReturnType<SurfaceNav['query']['findPath']> => {
  graphSolves++;
  if (service.current) graphActors.push(service.current.actor);
  return nativeSolve(...args);
};
let actor = 0;
try {
  await service.start();
  for (const d of descriptors)
    for (const direction of ['up', 'down'])
      for (const profile of profiles) {
        const from = v(d.points[direction === 'up' ? 0 : 3]).addScaledVector(v(d.normal), 0.2);
        const to = v(d.points[direction === 'up' ? 3 : 0]).addScaledVector(v(d.normal), 0.2);
        const out: NavRoute = {
          points: [new Vector3(123, 456, 789)],
          ladderSteps: [{ entryIndex: 0, exitIndex: 0, ladderId: 999, direction: 'up' }],
        };
        const snapshot = JSON.stringify(out),
          oldPoint = out.points[0],
          id = ++actor;
        const cache = (): NavCache => ({
          nav: null,
          version: 0,
          position: new Vector3(),
          point: new Vector3(),
          ref: 0,
          ...profile,
        });
        const owner = { navStart: cache(), navGoal: cache() };
        const deadline = performance.now() + 10000;
        let result,
          pending = 0;
        do {
          immediateMoves = 0;
          graphSolves = 0;
          const counted = nav.stats.queries;
          result = service.run(
            id,
            'route',
            (): number => nav.findRoute(from, to, out, owner),
            from
          );
          assert.ok(graphSolves <= 1, 'no second graph planner for ladder legs');
          assert.equal(
            nav.stats.queries,
            counted + (result === NAV_PENDING && graphSolves === 0 ? 0 : 1),
            'only endpoint waits are free; pending graph work spends a solve'
          );
          assert.ok(immediateMoves <= 1, 'at most existing one-move live-origin prefix');
          assert.notEqual(result, NAV_CANCELLED);
          if (result === NAV_PENDING) {
            pending++;
            assert.equal(JSON.stringify(out), snapshot, 'pending never mutates old points/steps');
            assert.equal(out.points[0], oldPoint);
            assert.ok(performance.now() < deadline, 'finite worker route drain');
            await new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, 1));
          }
        } while (result === NAV_PENDING);
        assert.equal(typeof result, 'number');
        assert(typeof result === 'number');
        assert.ok(result > 0, `${d.id}/${direction}/${profile.radius}: ${nav.lastReason}`);
        assert.ok(pending > 0, 'actual worker route admission');
        assert.equal(out.ladderSteps.length, 1);
        const step = out.ladderSteps[0];
        assert.equal(step.ladderId, d.id);
        assert.equal(step.direction, direction);
        assert.equal(step.exitIndex, step.entryIndex + 1);
        assert.deepEqual(out.points[step.entryIndex], v(d.points[direction === 'up' ? 0 : 3]));
        assert.deepEqual(out.points[step.exitIndex], v(d.points[direction === 'up' ? 3 : 0]));
        assert.deepEqual(
          out.points[result - 1],
          to,
          'complete route retains actual requested goal'
        );
        assert.notDeepEqual(
          from,
          out.points[step.entryIndex],
          'walking approach precedes traversal'
        );
        assert.notDeepEqual(
          to,
          out.points[step.exitIndex],
          'walking continuation follows traversal'
        );
        proofCount++;
      }
  const queries = service.samples.filter(
    (s): boolean =>
      !!(s.type === 'query' && s.key && !Array.isArray(s.key) && s.key.kind === 'ladder')
  );
  assert.equal(
    queries.length,
    48,
    'one independently directed full-budget ladder proof per route/profile'
  );
  for (const sample of queries) {
    assert(sample.type === 'query' && sample.key && !Array.isArray(sample.key));
    const key = sample.key;
    assert.deepEqual(key.descriptor, descriptors[key.descriptor.id - 1]);
    assert.equal(key.maxMoves, ladderMoveBudget(key.descriptor));
    assert.deepEqual(key.cursor, { segment: 0, distance: 0, pendingTime: 0, moves: 0 });
  }
  // A completed negative physical answer preserves the previously owned route,
  // just as pending does. This is a publication control, not a physical witness.
  const owned: NavRoute = {
    points: [new Vector3(7, 8, 9)],
    ladderSteps: [{ ladderId: 99, direction: 'down', entryIndex: 0, exitIndex: 0 }],
  };
  const snapshot = JSON.stringify(owned),
    check = service.checkLadder.bind(service);
  service.checkLadder = (): false => false;
  assert.equal(
    service.run(++actor, 'route', (): number =>
      nav.findRoute(v(descriptors[0].points[0]), v(descriptors[0].points[3]), owned)
    ),
    0
  );
  assert.equal(JSON.stringify(owned), snapshot);
  service.checkLadder = check;
  // E4's lower island remains disconnected from the street even after its link.
  const e4 = descriptors[5],
    street = new Vector3().fromArray(f.meta.spawns[0].position),
    out = { points: [], ladderSteps: [] };
  actor++;
  let result,
    attempts = 0;
  do {
    result = service.run(
      actor,
      'route',
      (): number => nav.findRoute(street, v(e4.points[3]), out),
      street
    );
    if (result === NAV_PENDING)
      await new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, 1));
    assert.ok(attempts++ < 10000);
  } while (result === NAV_PENDING);
  assert.equal(result, 0);
  assert.equal(nav.lastReason, 'disconnected');
  assert.deepEqual(out, { points: [], ladderSteps: [] });

  // Hold real worker replies across frames, first at endpoints, then after the
  // graph search. Three pending actors must share the same two-solve budget.
  service.clear();
  const ai = makeAi(nav),
    d = descriptors[0],
    goal = v(d.points[3]).addScaledVector(v(d.normal), 0.2);
  ai.agents = Array.from({ length: 3 }, (): ReturnType<typeof makeAgent> => {
    const a = makeAgent({ ai, id: ++actor });
    a.position.copy(d.points[0]).addScaledVector(v(d.normal), 0.2);
    a._pendingDest.copy(d.points[3]).addScaledVector(v(d.normal), -0.6);
    a.pathPending = true;
    a.path.push(new Vector3(123, 456, 789));
    a.route.ladderSteps.push({ entryIndex: 0, exitIndex: 0, ladderId: 999, direction: 'down' });
    return a;
  });
  const ownedRoutes = ai.agents.map(
    (
      a
    ): {
      snapshot: string;
      point: Vector3;
      steps: NavRoute['ladderSteps'];
      step: NavRoute['ladderSteps'][number];
    } => ({
      snapshot: JSON.stringify(a.route),
      point: a.path[0],
      steps: a.route.ladderSteps,
      step: a.route.ladderSteps[0],
    })
  );
  const receive = service.receive.bind(service),
    held: WorkerMessage[] = [];
  service.receive = (message): void => {
    held.push(message);
  };
  graphSolves = 0;
  ai._servePendingPaths();
  assert.equal(graphSolves, 0, 'endpoint-only pending does not run the graph');
  assert.equal(ai._pathBudget, 2, 'endpoint-only pending leaves the budget intact');
  assert(ai.agents.every((a): boolean => a.pathPending));
  assert.equal(service.jobs.size, 3, 'each edge goal waits on its endpoint proof');
  // Supersede those edge goals with immediately attached ladder endpoints.
  service.clear();
  for (const a of ai.agents) a._pendingDest.copy(goal);
  graphActors.length = 0;
  for (let frame = 0; frame < 3; frame++) {
    ai._pathBudget = ai.pathsPerFrame;
    graphSolves = 0;
    ai._servePendingPaths();
    assert.equal(graphSolves, 2, 'pending ladder replies cannot bypass two solves/frame');
    assert.equal(ai._pathBudget, 0);
    for (const [i, a] of ai.agents.entries()) {
      const old = ownedRoutes[i];
      assert(a.pathPending);
      assert.equal(JSON.stringify(a.route), old.snapshot, 'pending preserves all route data');
      assert.equal(a.path[0], old.point);
      assert.equal(a.route.ladderSteps, old.steps);
      assert.equal(a.route.ladderSteps[0], old.step);
    }
  }
  assert.deepEqual(
    graphActors,
    [...ai.agents, ...ai.agents].map((a): number => a.id),
    'round-robin retries include every actor while proofs are held'
  );
  assert.ok(
    [...service.jobs.values()].some(
      (job): boolean => !Array.isArray(job.key) && job.key.kind === 'ladder'
    ),
    'real ladder proofs are pending'
  );
  const deadline = performance.now() + 10000;
  while (
    !held.some((message): boolean => message.type === 'result' && service.jobs.has(message.id))
  ) {
    assert.ok(performance.now() < deadline, 'real worker replies arrive while held');
    await new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, 1));
  }
  service.receive = receive;
  for (const message of held) receive(message);
  let admitted = 0;
  while (ai.agents.some((a): boolean => a.pathPending)) {
    ai._pathBudget = ai.pathsPerFrame;
    graphSolves = 0;
    ai._servePendingPaths();
    assert.ok(graphSolves <= 2, 'reply admission still shares the frame budget');
    const completed = ai.agents.filter((a): boolean => !a.pathPending).length;
    assert.ok(completed - admitted <= 2, 'no more than two routes admitted per frame');
    admitted = completed;
    assert.ok(performance.now() < deadline, 'all scheduled actors eventually admit');
    await new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, 1));
  }
  assert.equal(admitted, 3);
  for (const a of ai.agents) {
    assert.equal(a.route.ladderSteps[0].ladderId, d.id);
    assert.deepEqual(a.path[a.pathLen - 1], goal);
  }
} finally {
  nav._probe.move = originalFoot;
  nav._checkAttachment = originalOracle;
  nav.dispose();
}

// Locate a pinned dtOffMeshConnection (36 bytes) and its two-vertex polygon.
const raw = new Uint8Array(f.surfaceRaw),
  view = new DataView(raw.buffer);
const navStart = 64 + view.getUint32(8, true);
let tileStart = navStart + 40,
  found,
  second;
for (let i = 0; i < view.getUint32(navStart + 8, true); i++) {
  const t = tileStart + 8,
    u = (n: number): number => view.getUint32(t + n, true);
  const poly = t + 100 + u(28) * 12;
  const off = poly + u(24) * 32 + u(32) * 12 + u(36) * 12 + u(40) * 12 + u(44) * 4 + u(48) * 16;
  if (u(52)) {
    if (!found) found = { t, poly: poly + u(56) * 32, off };
    else {
      second = off;
      break;
    }
  }
  tileStart = t + view.getUint32(tileStart + 4, true);
}
assert.ok(found);
async function corrupt(change: (view: DataView) => void, pattern: RegExp): Promise<void> {
  const bytes = raw.slice(),
    d = new DataView(bytes.buffer);
  change(d);
  bytes.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(64))), 32);
  await assert.rejects(unpackNav(bytes), pattern);
}
const { t, poly, off } = found;
assert.ok(second);
const secondOffset = second;
await corrupt(
  (d): void => d.setUint32(secondOffset + 32, view.getUint32(off + 32, true), true),
  /duplicate ladder connection/
);
const corruptions: [(view: DataView) => void, RegExp][] = [
  [(d): void => d.setUint32(t + 52, 0, true), /tile counts/],
  [(d): void => d.setUint32(t + 36, view.getUint32(t + 24, true), true), /tile counts/],
  [(d): void => d.setUint32(t + 56, 0, true), /tile counts/],
  [(d): void => d.setUint8(poly + 30, 3), /polygon type/],
  [(d): void => d.setUint8(poly + 31, 0), /polygon type/],
  [(d): void => d.setUint16(poly + 28, 1, true), /polygon type/],
  [(d): void => d.setUint16(poly + 4, 65535, true), /polygon vertex/],
  [(d): void => d.setUint16(poly + 16, 1, true), /offmesh neighbour/],
  [(d): void => d.setUint16(off + 28, 0, true), /offmesh index/],
  [(d): void => d.setUint8(off + 30, 0), /direction/],
  [(d): void => d.setUint8(off + 31, 8), /side/],
  [(d): void => d.setUint32(off + 32, 0, true), /unknown\/duplicate ladder connection/],
  [(d): void => d.setUint32(off + 32, 999, true), /unknown\/duplicate ladder connection/],
  [(d): void => d.setFloat32(off + 24, NaN, true), /radius/],
  [(d): void => d.setFloat32(off + 24, NAV_LINK_RADIUS * 2, true), /radius/],
  [(d): void => d.setFloat32(off, view.getFloat32(off, true) + 1, true), /endpoint mismatch/],
  [(d): void => d.setFloat32(off + 4, NaN, true), /endpoint mismatch/],
];
for (const [change, pattern] of corruptions) await corrupt(change, pattern);
async function metadata(
  change: (meta: Omit<NavMetadata, 'ladders'> & { ladders: MutableLadderDescriptor[] }) => void,
  pattern: RegExp,
  expectedBinding?: ExpectedNav
): Promise<void> {
  assert(bake.meta.ladders);
  const meta = { ...structuredClone(bake.meta), ladders: bake.meta.ladders.map(mutableLadder) };
  change(meta);
  const bytes = await packNav(meta, bake.nav, bake.components, bake.points);
  await assert.rejects(unpackNav(bytes, expectedBinding), pattern);
}
await metadata((m): void => {
  m.ladders = [];
}, /ladder connection/);
await metadata((m): void => {
  m.ladders[0].id = 2;
}, /ladder descriptor/);
await metadata((m): void => {
  m.ladders[0].normal.x = 0;
}, /geometry/);
await metadata((m): void => {
  m.ladders[0].points[0].y += 1;
}, /geometry/);
await metadata((m): void => {
  m.ladders[0].points[2].y = m.ladders[0].points[1].y;
}, /geometry/);
await metadata((m): void => {
  m.bounds.max[1] = 1;
}, /outside bounds/);
// A sub-float32 descriptor change still fails exact authored binding, even
// though Detour cannot distinguish the new endpoint from the original.
await metadata(
  (m): void => {
    const d = m.ladders[0];
    d.points[1].x += 1e-10;
    d.points[2].x = d.points[1].x;
    d.points[0].x = d.points[1].x + d.normal.x * 0.605;
    d.points[3].x = d.points[2].x + d.normal.x * 1.1;
  },
  /authored ladder binding/,
  { ladders: descriptors }
);
// Simulate missing/wrong-floor imported attachment, including reverse links.
// Only the native link under test is corrupted; normal load above used real import.
const broken = await SurfaceNav.load(f.surfaceRaw, f.physics, expected);
const entry = broken.ladderLinks.entries().next().value;
assert(entry);
const [first, binding] = entry;
const native = broken.mesh.getTileAndPolyByRef(first),
  firstLink = native.tile.links(native.poly.firstLink());
const original = firstLink.ref();
for (const ref of [0, firstLink.edge() === 0 ? binding.upperRef : binding.lowerRef]) {
  firstLink.raw.set_ref(ref);
  assert.throws(
    (): SurfaceNav => new SurfaceNav(f.physics, broken.mesh, bake.components, bake.meta),
    /ladder/
  );
}
firstLink.raw.set_ref(original);
const ground = broken.mesh.getTileAndPolyByRef(binding.lowerRef);
for (let l = ground.poly.firstLink(); l !== 0xffffffff; l = ground.tile.links(l).next()) {
  const link = ground.tile.links(l);
  if (link.ref() === first) {
    link.raw.set_ref(0);
    assert.throws(
      (): SurfaceNav => new SurfaceNav(f.physics, broken.mesh, bake.components, bake.meta),
      /reverse ladder/
    );
    link.raw.set_ref(first);
    break;
  }
}
broken.dispose();
console.log(
  `ok  ladder nav: ${proofCount} complete real-worker routes, exact descriptors, walking-only compatibility, strict offmesh corruption`
);
