import assert from 'node:assert/strict';

import * as THREE from 'three';

import { AttachmentQueries, NAV_PENDING } from '../../src/ai/attachment-queries.ts';
import type { AttachmentOracle, ClientMessage } from '../../src/ai/attachment-types.ts';
import { checkAttachment, canStand } from '../../src/ai/attachment.ts';
import type { SurfaceNav } from '../../src/ai/nav.ts';
import { StaticWorld } from '../../src/physics/bvh.ts';
import { CharacterController } from '../../src/physics/character.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { fixture } from '../lib/fixture.ts';

const world = new StaticWorld();
for (const [x, y, z, w, h, d] of [
  [0, -0.2, 0, 8, 0.4, 8],
  [0.8, 1.5, 0, 0.2, 3, 4],
]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld();
  world.addMesh(mesh, 'concrete');
  mesh.geometry.dispose();
}
world.build();
const physics = new PhysicsSystem();
physics.staticWorld = world;
physics.gravity = -20;
physics.checkCapsule = (a, b, r, m): boolean =>
  world.overlapCapsule(a.x, a.y, a.z, b.x, b.y, b.z, r, m ?? physics.MASK.CHARACTER, 0) === 0;
const stats: SurfaceNav['stats'] & AttachmentOracle['stats'] = {
  endpointChecks: 0,
  polygons: 0,
  queries: 0,
  queryMs: 0,
  cacheHits: 0,
};
const nav = fixture<SurfaceNav>({
  physics,
  _probe: new CharacterController(world),
  _p0: new THREE.Vector3(),
  _p1: new THREE.Vector3(),
  canStand,
  stats,
});
const a = new THREE.Vector3(0, 0.008, 0),
  b = new THREE.Vector3(1.5, 0.008, 0);
let moves = 0;
assert(nav._probe);
const move = nav._probe.move.bind(nav._probe);
nav._probe.move = function (...args): number {
  moves++;
  return move.apply(this, args);
};
nav.repeatState = false;
const original = checkAttachment.call(nav, a, b, 0.32, 1.78, 80),
  originalMoves = moves;
nav.repeatState = true;
moves = 0;
assert.equal(checkAttachment.call(nav, a, b, 0.32, 1.78, 80), original);
assert.equal(original, false);
assert(moves < originalMoves);
assert.equal(originalMoves - moves, stats.savedMoves);
for (const variant of ['tiny-progress', 'falling', 'velocity-change']) {
  let count = 0;
  const c = new CharacterController(world);
  c.grounded = variant !== 'falling';
  c.probeGround = (): boolean => false;
  c.move = function (): number {
    count++;
    if (variant === 'tiny-progress') this.position.x += 1e-12;
    if (variant === 'velocity-change') this.velocity.y++;
    return 0;
  };
  const fake: AttachmentOracle = {
    physics,
    _p0: new THREE.Vector3(),
    _p1: new THREE.Vector3(),
    _probe: c,
    stats: { endpointChecks: 0 },
    canStand: (): boolean => true,
  };
  assert.equal(
    checkAttachment.call(fake, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0.32, 1.78, 80),
    false
  );
  assert.equal(count, 80, `${variant} is not a repeated full state`);
}
// A two-state grounded/airborne oscillation is a real repeated cycle, not
// progress. The local requested vertical velocity repeats with it.
let cycleMoves = 0;
const cycle = new CharacterController(world);
cycle.grounded = true;
cycle.probeGround = (): boolean => false;
cycle.move = function (): number {
  cycleMoves++;
  this.grounded = !this.grounded;
  return 0;
};
assert.equal(
  checkAttachment.call(
    {
      physics,
      _p0: new THREE.Vector3(),
      _p1: new THREE.Vector3(),
      _probe: cycle,
      stats: { endpointChecks: 0 },
      canStand: (): boolean => true,
    },
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    0.32,
    1.78,
    80
  ),
  false
);
assert(
  cycleMoves >= 2 && cycleMoves < 80,
  'exact oscillation terminates without changing the failed result'
);
// Initial overlap has a special arrival gate; it must not become early failure.
const c = new CharacterController(world);
c.grounded = true;
c.probeGround = (): boolean => false;
c.move = (): number => 0;
assert.equal(
  checkAttachment.call(
    {
      physics,
      _p0: new THREE.Vector3(),
      _p1: new THREE.Vector3(),
      _probe: c,
      stats: { endpointChecks: 0 },
      canStand: (): boolean => false,
    },
    { x: 0, y: 0, z: 0 },
    { x: 0.05, y: 0, z: 0 },
    0.32,
    1.78,
    80
  ),
  true
);

class QueryWorker {
  messages: ClientMessage[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  postMessage(message: ClientMessage): void {
    this.messages.push(message);
    if (message.type === 'init')
      queueMicrotask((): void => {
        this.onmessage?.(new MessageEvent('message', { data: { type: 'ready' } }));
      });
  }
  terminate(): void {}
}
const service = new AttachmentQueries(nav, {
  workerFactory: (): Worker => fixture<Worker>(new QueryWorker()),
});
await service.start();
const target = new THREE.Vector3(2, 0.008, 0);
const chain = (): boolean =>
  service.request(a, b, 0.32, 1.78, 80) && service.request(b, target, 0.32, 1.78, 80);
const run = (): ReturnType<AttachmentQueries['run']> =>
  service.run(1, 'dependent-checks', chain, a);
assert.equal(run(), NAV_PENDING);
assert.equal(service.jobs.size, 1, 'unknown prerequisite does not launch a dependent check');
assert.equal(run(), NAV_PENDING);
assert.equal(service.jobs.size, 1, 'pending proof is not provisional success');
const first = [...service.jobs.keys()][0];
service.receive({ type: 'result', id: first, value: true, ms: 0, moves: 0 });
assert.equal(run(), NAV_PENDING);
assert.equal(service.jobs.size, 1, 'dependent check waits for a real prerequisite success');
const second = [...service.jobs.keys()][0];
assert.notEqual(second, first);
service.receive({ type: 'result', id: second, value: true, ms: 0, moves: 0 });
assert.equal(run(), true);
service.clear();
assert.equal(run(), NAV_PENDING);
service.receive({ type: 'result', id: [...service.jobs.keys()][0], value: false, ms: 0, moves: 0 });
assert.equal(run(), false);
assert.equal(service.jobs.size, 0, 'failed prerequisite never submits its dependent check');
service.dispose();
console.log(
  'runtime query efficiency: exact cycles retained; dependent checks require real proofs: OK'
);
