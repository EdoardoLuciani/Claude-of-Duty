import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AttachmentQueries, NAV_PENDING, NAV_CANCELLED } from '../../src/ai/attachment-queries.js';
import { StaticWorld } from '../../src/physics/bvh.js';
import { CharacterController } from '../../src/physics/character.js';
import { CoverMap, SurfaceNav } from '../../src/ai/nav.ts';
import { canStand, checkAttachment } from '../../src/ai/attachment.js';

class FakeWorker {
  messages = []; terminated = false;
  postMessage(message) {
    this.messages.push(message);
    if (message.type === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready' } }));
  }
  terminate() { this.terminated = true; }
}
const world = new StaticWorld(), controller = new CharacterController(world);
const nav = { physics: { staticWorld: world, gravity: -20, MASK: { CHARACTER: 259 } }, _probe: controller };
let worker;
const service = new AttachmentQueries(nav, { workerFactory: () => worker = new FakeWorker() });
await service.start(); assert(service.ready);
const a = new THREE.Vector3(), b = new THREE.Vector3(1, 0, 0);
const run = (to = b, radius = .36, height = 1.8, steps = 80) => service.run(1, 'path', () => service.request(a, to, radius, height, steps));
const result = (id, value) => service.receive({ type: 'result', id, value, ms: 1, moves: 80 });
assert.equal(run(), NAV_PENDING, 'unknown is pending, never an unreachable path');
assert.equal(run(), NAV_PENDING); assert.equal(service.jobs.size, 1, 'one in-flight proof per exact key');
let id = [...service.jobs.keys()][0]; result(id, false);
assert.equal(run(), false, 'only a completed native false may publish failure');
assert.equal(service.jobs.size, 0);
assert.equal(run(new THREE.Vector3(1 + 1e-12, 0, 0)), NAV_PENDING, 'no coordinate quantization');
assert.equal(run(b, .37), NAV_PENDING); assert.equal(run(b, .36, 1.9), NAV_PENDING); assert.equal(run(b, .36, 1.8, 81), NAV_PENDING);
assert.equal(service.run(1, 'path', () => service.request(b, a, .36, 1.8, 80)), NAV_PENDING, 'ordered endpoints');
// Superseding a live origin is not physical failure and must not publish claims.
const origin = new THREE.Vector3(.7, 0, 0), destination = new THREE.Vector3(15, 0, 0);
const moving = () => service.run(1, 'moving', () => service.request(origin, destination, .36, 1.8, 80), origin);
assert.equal(moving(), NAV_PENDING);
const movingId = [...service.jobs.keys()].at(-1);
origin.x += .01;
assert.equal(service.run(1, 'moving', () => { throw new Error('superseded plan ran'); }, origin), NAV_CANCELLED);
assert.equal(service.stats.superseded, 1); assert.ok(!service.jobs.has(movingId));
assert.equal(moving(), NAV_PENDING, 'a later intent can retry the new exact origin');
service.cancel('1:moving');
const old = [...service.jobs.keys()];
world.version++;
assert.equal(run(), NAV_PENDING, 'revision is checked at use, not only at frame start');
await service.start();
for (const id of old) result(id, true);
assert.equal(service.jobs.size, 0); assert.equal(run(), NAV_PENDING, 'late old-generation responses cannot populate proofs');
result([...service.jobs.keys()][0], true); assert.equal(run(), true);
for (const field of ['stepHeight', 'slopeLimit', 'snapDistance', 'maxIterations', 'mask']) {
  controller[field] += 1;
  assert.equal(run(), NAV_PENDING, `${field} invalidates`);
  await service.start(); assert.equal(run(), NAV_PENDING);
  result([...service.jobs.keys()][0], true); assert.equal(run(), true);
}
controller.enabled = false; assert.equal(run(), NAV_PENDING); await service.start();
nav.physics.gravity--; assert.equal(run(), NAV_PENDING); await service.start();
nav.physics.MASK.CHARACTER++; assert.equal(run(), NAV_PENDING); await service.start();
world.dirty = true; assert.equal(run(), NAV_PENDING); world.dirty = false;
assert.equal(run(), NAV_PENDING); service.update(1, new Set()); assert.equal(service.jobs.size, 0, 'dead actors cancel work');
assert(worker.messages.some(m => m.type === 'cancel'));
assert.throws(() => service.run(1, 'throw', () => { service.request(a, b, .36, 1.8, 80); throw new Error('original'); }), /original/);
assert.equal(service.current, null); assert.equal(service.jobs.size, 0, 'failed attempt releases unsent jobs');

// A ready lower-ranked candidate cannot leapfrog an unresolved better one,
// and a pending attempt cannot release or acquire live cover claims.
const points = [0, 2].map(x => ({ x, y: 0, z: 0, dx: 0, dz: 1, dist: 1, high: false, surface: 1, component: 1, claimed: -1 }));
const grid = { worker: service, coverPoints: points, components: new Map([[1, 1]]),
  plan: (actor, kind, fn) => service.run(actor, kind, fn),
  project(p, out, _cache, goal) {
    out.copy(p);
    return !goal || service.request(p, { x: p.x + .2, y: p.y, z: p.z }, .36, 1.8, 80) ? 1 : 0;
  } };
const cover = new CoverMap(grid, {}); cover.protects = () => true; cover.peekOffset = () => 0;
const pick = () => cover.pick(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 10), { id: 1 });
assert.equal(pick(), NAV_PENDING); const jobs = [...service.jobs.values()]; assert.equal(jobs.length, 2);
result(jobs[1].id, true);
assert.equal(pick(), NAV_PENDING); assert(points.every(p => p.claimed === -1));
result(jobs[0].id, false); assert.equal(pick(), points[1]); assert.equal(points[1].claimed, 1);
points[1].claimed = 2; assert.equal(pick(), null, 'current claims are reevaluated, not returned from a worker snapshot');
service.clear(); assert.equal(service.scopes.size, 0);
service.receive({ type: 'result', id: 999, value: 'false', ms: 0, moves: 0 });
assert.throws(() => run(), /malformed/);
service.dispose(); assert(worker.terminated);

// Teardown while init waits must settle without leaving the deadline timer.
const stalled = new AttachmentQueries(nav, { workerFactory: () => ({ postMessage() {}, terminate() {} }) });
const start = stalled.start();
await new Promise(resolve => setTimeout(resolve, 0)); stalled.dispose(); await start;
assert.equal(stalled.ready, false);
// Bounded live-origin prefixes are the same motor oracle, not a shorter
// rejection budget. Any undecided walk must be delegated, including successes.
const floor = new StaticWorld();
floor.addTriangles(new Float32Array([-3,0,-3,-3,0,3,3,0,3,3,0,3,3,0,-3,-3,0,-3]),2,'concrete'); floor.build();
const physics = { staticWorld: floor, gravity: -20, MASK: { CHARACTER: 259 },
  checkCapsule: (a,b,r,m) => floor.overlapCapsule(a.x,a.y,a.z,b.x,b.y,b.z,r,m,0) === 0 };
const probe = { physics, _probe: new CharacterController(floor), _p0: new THREE.Vector3(), _p1: new THREE.Vector3(), canStand, stats: { endpointChecks: 0 } };
let moves = 0, unknown = 0, fast = 0, delegated = false;
const move = probe._probe.move; probe._probe.move = function (...args) { moves++; return move.apply(this,args); };
probe.worker = { active: true, current: {}, request() { delegated = true; return false; } };
for (const x of [0,.0001,.1199999,.12,.1200001,.2,1]) for (const y of [.008,.1,.4]) for (const steps of [0,1,2,80]) {
  const from = new THREE.Vector3(0,.008,0), to = new THREE.Vector3(x,y,0);
  moves = 0;
  const prefix = checkAttachment.call(probe,from,to,.32,1.78,steps,1);
  assert(moves <= 1, 'prefix may perform at most one motor move');
  const native = checkAttachment.call(probe,from,to,.32,1.78,steps);
  if (prefix === null) unknown++; else assert.equal(prefix,native,'prefix must prove the full-budget result');
  delegated = false;
  const immediate = SurfaceNav.prototype.canAttach.call(probe,from,to,.32,1.78,steps);
  if (!delegated) { fast++; assert.equal(immediate,native,'zero-move shortcut must match native oracle'); }
}
assert(unknown > 0 && fast > 0);
console.log('attachment worker: pending/claims, exact identity, revision/config, cancellation, errors, teardown and 84 prefix/zero-move cases');
