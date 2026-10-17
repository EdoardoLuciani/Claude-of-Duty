import assert from 'node:assert/strict';

import { Vector3 } from 'three';

import { AttachmentQueries } from '../../src/ai/attachment-queries.js';
import { createLadderDescriptors, ladderMoveBudget } from '../../src/ai/ladder.ts';
import { unpackNav, packNav, NAV_LINK_RADIUS } from '../../src/ai/nav-format.ts';
import { SurfaceNav, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/nav.ts';
import { NativeWorker } from '../../tools/lib/attachment-worker-fixture.mjs';
import { ladderProfiles } from '../../tools/lib/ladder-fixture.mjs';
import { loadMap } from '../../tools/nav240/fixtures.mjs';

// Browser transport only: all route proofs use the production module worker.
const f = await loadMap(),
  descriptors = createLadderDescriptors(f.meta.volumes);
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
assert.equal(new Set(nav.walkingComponents.values()).size, 233);
assert.equal(new Set(nav.components.values()).size, 227);
const v = (p) => new Vector3().copy(p);
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
const originalFoot = nav._probe.move,
  originalOracle = nav._checkAttachment;
let immediateMoves = 0;
nav._probe.move = function (...args) {
  immediateMoves++;
  return originalFoot.apply(this, args);
};
nav._checkAttachment = () => assert.fail('route proof executed a full main-thread oracle');
const service = (nav.worker = new AttachmentQueries(nav, {
  profile: true,
  workerFactory: () => new NativeWorker(),
}));
const profiles = ladderProfiles();
let proofCount = 0;
const nativeSolve = nav.query.findPath.bind(nav.query);
let graphSolves = 0;
nav.query.findPath = (...args) => {
  graphSolves++;
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
        const out = {
          points: [new Vector3(123, 456, 789)],
          ladderSteps: [{ entryIndex: 0, exitIndex: 0, ladderId: 999, direction: 'up' }],
        };
        const snapshot = JSON.stringify(out),
          oldPoint = out.points[0],
          id = ++actor;
        const cache = () => ({
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
          result = service.run(id, 'route', () => nav.findRoute(from, to, out, owner), from);
          assert.ok(graphSolves <= 1, 'no second graph planner for ladder legs');
          assert.equal(
            nav.stats.queries,
            counted + (result === NAV_PENDING ? 0 : 1),
            'pending does not spend a completed solve'
          );
          assert.ok(immediateMoves <= 1, 'at most existing one-move live-origin prefix');
          assert.notEqual(result, NAV_CANCELLED);
          if (result === NAV_PENDING) {
            pending++;
            assert.equal(JSON.stringify(out), snapshot, 'pending never mutates old points/steps');
            assert.equal(out.points[0], oldPoint);
            assert.ok(performance.now() < deadline, 'finite worker route drain');
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        } while (result === NAV_PENDING);
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
  const queries = service.samples.filter((s) => s.type === 'query' && s.key?.kind === 'ladder');
  assert.equal(
    queries.length,
    48,
    'one independently directed full-budget ladder proof per route/profile'
  );
  for (const { key } of queries) {
    assert.deepEqual(key.descriptor, descriptors[key.descriptor.id - 1]);
    assert.equal(key.maxMoves, ladderMoveBudget(key.descriptor));
    assert.deepEqual(key.cursor, { segment: 0, distance: 0, pendingTime: 0, moves: 0 });
  }
  // A completed negative physical answer preserves the previously owned route,
  // just as pending does. This is a publication control, not a physical witness.
  const owned = {
    points: [new Vector3(7, 8, 9)],
    ladderSteps: [{ ladderId: 99, direction: 'down', entryIndex: 0, exitIndex: 0 }],
  };
  const snapshot = JSON.stringify(owned),
    check = service.checkLadder;
  service.checkLadder = () => false;
  assert.equal(
    service.run(++actor, 'route', () =>
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
    result = service.run(actor, 'route', () => nav.findRoute(street, v(e4.points[3]), out), street);
    if (result === NAV_PENDING) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.ok(attempts++ < 10000);
  } while (result === NAV_PENDING);
  assert.equal(result, 0);
  assert.equal(nav.lastReason, 'disconnected');
  assert.deepEqual(out, { points: [], ladderSteps: [] });
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
    u = (n) => view.getUint32(t + n, true);
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
async function corrupt(change, pattern) {
  const bytes = raw.slice(),
    d = new DataView(bytes.buffer);
  change(d);
  bytes.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(64))), 32);
  await assert.rejects(unpackNav(bytes), pattern);
}
const { t, poly, off } = found;
assert.ok(second);
await corrupt(
  (d) => d.setUint32(second + 32, view.getUint32(off + 32, true), true),
  /duplicate ladder connection/
);
for (const [change, pattern] of [
  [(d) => d.setUint32(t + 52, 0, true), /tile counts/],
  [(d) => d.setUint32(t + 36, view.getUint32(t + 24, true), true), /tile counts/],
  [(d) => d.setUint32(t + 56, 0, true), /tile counts/],
  [(d) => d.setUint8(poly + 30, 3), /polygon type/],
  [(d) => d.setUint8(poly + 31, 0), /polygon type/],
  [(d) => d.setUint16(poly + 28, 1, true), /polygon type/],
  [(d) => d.setUint16(poly + 4, 65535, true), /polygon vertex/],
  [(d) => d.setUint16(poly + 16, 1, true), /offmesh neighbour/],
  [(d) => d.setUint16(off + 28, 0, true), /offmesh index/],
  [(d) => d.setUint8(off + 30, 0), /direction/],
  [(d) => d.setUint8(off + 31, 8), /side/],
  [(d) => d.setUint32(off + 32, 0, true), /unknown\/duplicate ladder connection/],
  [(d) => d.setUint32(off + 32, 999, true), /unknown\/duplicate ladder connection/],
  [(d) => d.setFloat32(off + 24, NaN, true), /radius/],
  [(d) => d.setFloat32(off + 24, NAV_LINK_RADIUS * 2, true), /radius/],
  [(d) => d.setFloat32(off, view.getFloat32(off, true) + 1, true), /endpoint mismatch/],
  [(d) => d.setFloat32(off + 4, NaN, true), /endpoint mismatch/],
])
  await corrupt(change, pattern);
async function metadata(change, pattern, expectedBinding) {
  const meta = structuredClone(bake.meta);
  change(meta);
  const bytes = await packNav(meta, bake.nav, bake.components, bake.points);
  await assert.rejects(unpackNav(bytes, expectedBinding), pattern);
}
await metadata((m) => {
  m.ladders = [];
}, /ladder connection/);
await metadata((m) => {
  m.ladders[0].id = 2;
}, /ladder descriptor/);
await metadata((m) => {
  m.ladders[0].normal.x = 0;
}, /geometry/);
await metadata((m) => {
  m.ladders[0].points[0].y += 1;
}, /geometry/);
await metadata((m) => {
  m.ladders[0].points[2].y = m.ladders[0].points[1].y;
}, /geometry/);
await metadata((m) => {
  m.bounds.max[1] = 1;
}, /outside bounds/);
// A sub-float32 descriptor change still fails exact authored binding, even
// though Detour cannot distinguish the new endpoint from the original.
await metadata(
  (m) => {
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
const [first, binding] = broken.ladderLinks.entries().next().value;
const native = broken.mesh.getTileAndPolyByRef(first),
  firstLink = native.tile.links(native.poly.firstLink());
const original = firstLink.ref();
for (const ref of [0, firstLink.edge() === 0 ? binding.upperRef : binding.lowerRef]) {
  firstLink.raw.set_ref(ref);
  assert.throws(() => new SurfaceNav(f.physics, broken.mesh, bake.components, bake.meta), /ladder/);
}
firstLink.raw.set_ref(original);
const ground = broken.mesh.getTileAndPolyByRef(binding.lowerRef);
for (let l = ground.poly.firstLink(); l !== 0xffffffff; l = ground.tile.links(l).next()) {
  const link = ground.tile.links(l);
  if (link.ref() === first) {
    link.raw.set_ref(0);
    assert.throws(
      () => new SurfaceNav(f.physics, broken.mesh, bake.components, bake.meta),
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
