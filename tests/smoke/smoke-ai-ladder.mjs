import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Scene, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { CharacterController } from '../../src/physics/character.ts';
import { createLadderDescriptors, LadderMotor, LADDER, ladderMoveBudget } from '../../src/ai/ladder.ts';
import { INFANTRY } from '../../src/ai/capabilities.ts';
import { NAV_PROFILE } from '../../src/ai/nav-format.ts';
import { VARIANTS } from '../../src/ai/soldier.ts';
import { loadMap, physicsFor } from '../../tools/nav240/fixtures.mjs';

const f = await loadMap(), descriptors = createLadderDescriptors(f.meta.volumes);
assert.equal(descriptors.length, 6);
const profiles = [{ name: 'NAV_PROFILE', radius: NAV_PROFILE.radius, height: NAV_PROFILE.height },
  ...Object.entries(VARIANTS).map(([name, v]) => ({ name, radius: INFANTRY.radius * v.scale, height: INFANTRY.height * v.scale }))];
const results = [], interruptions = [];
function controller(world, descriptor, direction, profile) {
  return new CharacterController(world, { ...profile, position: descriptor.points[direction === 'up' ? 0 : 3],
    stepHeight: INFANTRY.stepHeight, snapDistance: .32, slopeLimit: INFANTRY.slopeRadians });
}
function restored(c) { assert.equal(c.stepHeight, INFANTRY.stepHeight); assert.equal(c.snapDistance, .32); }
function run(c, d, direction, dt, cursor) {
  const motor = new LadderMotor(c, d, direction, ladderMoveBudget(d), cursor);
  let calls = 0, moves = 0, maxMove = 0, maxError = 0;
  const radius = c.radius, height = c.height, mask = c.mask;
  const samples = [];
  // Initialization above is the only fixture positioning. No motor teleport,
  // capsule resize or mask change can hide a failed physical passage.
  c.setPosition = c.teleport = c.setHeight = () => { throw new Error('relocation/resize forbidden'); };
  const native = c.move.bind(c);
  c.move = (dx, dy, dz) => {
    assert.equal(c.radius, radius); assert.equal(c.height, height); assert.equal(c.mask, mask);
    assert.equal(c.stepHeight, 0); assert.equal(c.snapDistance, 0);
    const before = { ...c.position };
    const value = native(dx, dy, dz);
    assert.equal(c.mask, mask); assert.equal(c.radius, radius); assert.equal(c.height, height);
    const distance = Math.hypot(c.position.x - before.x, c.position.y - before.y, c.position.z - before.z);
    maxMove = Math.max(maxMove, distance);
    maxError = Math.max(maxError, Math.hypot(c.position.x - before.x - dx, c.position.y - before.y - dy, c.position.z - before.z - dz));
    moves++;
    samples.push({ phase: motor.phase, foot: { ...c.position } });
    return value;
  };
  while (motor.status === 'active' && calls++ < 1000) {
    const before = moves;
    motor.advance(dt);
    assert.ok(moves - before <= LADDER.maxSubsteps);
    assert.ok(maxMove <= LADDER.speed * LADDER.step + 1e-10);
    if (calls === 1) {
      if (dt === .25) { assert.equal(moves, LADDER.maxSubsteps); assert.ok(motor.cursor.pendingTime > .1); }
      if (dt === 1 / 120) assert.equal(moves, 0, '120Hz carries the half quantum');
      const snapshot = JSON.stringify([motor.cursor, c.position]);
      motor.advance(0); motor.advance(-1);
      assert.equal(JSON.stringify([motor.cursor, c.position]), snapshot, 'pause must preserve backlog and foot');
    }
  }
  assert.equal(motor.status, 'complete', `${d.id}/${direction}/${dt}: ${motor.failure}`);
  restored(c); assert.equal(c.grounded, true);
  const end = d.points[direction === 'up' ? 3 : 0];
  assert.ok(Math.hypot(c.position.x - end.x, c.position.y - end.y, c.position.z - end.z) < 1e-6);
  assert.ok(Math.abs(motor.verticalTravel - (d.points[2].y - d.points[1].y)) < 1e-6);
  return { calls, moves, maxMove, maxError, samples, final: { ...c.position }, supported: c.grounded };
}
for (const d of descriptors) for (const profile of profiles) for (const direction of ['up', 'down']) for (const dt of [1 / 30, 1 / 60, 1 / 120, .25]) {
  const c = controller(f.physics.staticWorld, d, direction, profile);
  const result = run(c, d, direction, dt);
  results.push({ id: d.id, profile: profile.name, direction, dt, ...result });
  // Native supported continuation beyond the landing, not just roof projection.
  const before = { ...c.position };
  c.move = CharacterController.prototype.move.bind(c);
  c.move(d.normal.x * .2, 0, d.normal.z * .2);
  assert.ok(Math.hypot(c.position.x - before.x - d.normal.x * .2, c.position.z - before.z - d.normal.z * .2) < 1e-6);
  assert.ok(c.grounded && Math.abs(c.position.y - before.y) <= LADDER.supportDistance,
    `${d.id}/${profile.name}/${direction}: continuation ${JSON.stringify({ before, after: c.position, grounded: c.grounded })}`);
}

// Exact interrupted cursor continuation and freshly budgeted reverse return.
for (const d of descriptors) for (const profile of profiles) for (const direction of ['up', 'down']) {
  const c = controller(f.physics.staticWorld, d, direction, profile);
  const motor = new LadderMotor(c, d, direction);
  while (motor.phase !== 'shaft' || motor.cursor.distance < 1.5) {
    assert.equal(motor.advance(1 / 60), 'active');
  }
  const cursor = { ...motor.cursor }, position = { ...c.position };
  motor.cancel(); restored(c);
  const clone = controller(f.physics.staticWorld, d, direction, profile);
  clone.setPosition(position.x, position.y, position.z); // detached oracle starts at exact cursor
  const resumed = new LadderMotor(clone, d, direction, ladderMoveBudget(d), cursor);
  while (resumed.status === 'active') resumed.advance(1 / 60);
  assert.equal(resumed.status, 'complete'); restored(clone);
  assert.deepEqual(c.position, position);
  const reverse = { segment: 1, distance: d.points[2].y - d.points[1].y - cursor.distance, pendingTime: 0, moves: 0 };
  const returning = new LadderMotor(c, d, direction === 'up' ? 'down' : 'up', ladderMoveBudget(d), reverse);
  while (returning.status === 'active') returning.advance(1 / 60);
  assert.equal(returning.status, 'complete'); restored(c);
  interruptions.push({ id: d.id, profile: profile.name, direction, cursor, foot: position,
    resumed: resumed.status, returned: returning.status, resumedFoot: { ...clone.position }, returnedFoot: { ...c.position } });
}

const volume = { kind: 'ladder', x: 0, z: 0, y0: 0, y1: 3, radius: .42, nx: 1, nz: 0 };
for (const change of [{ nx: undefined }, { nz: NaN }, { nx: 2 }, { y1: 0 }, { radius: -1 }]) {
  assert.throws(() => createLadderDescriptors([{ ...volume, ...change }]));
}
const d = createLadderDescriptors([volume])[0];
function box(scene, x, y, z, w, h, depth) {
  const mesh = new Mesh(new BoxGeometry(w, h, depth), new MeshBasicMaterial());
  mesh.position.set(x, y, z); scene.add(mesh); return mesh;
}
function fixture(extra) {
  const scene = new Scene();
  box(scene, 0, -.2, 0, 8, .4, 8);
  box(scene, 2.75, 2.8, 0, 4.5, .4, 8);
  extra?.(scene);
  const physics = physicsFor(scene), c = controller(physics.staticWorld, d, 'up', profiles[0]);
  return { physics, c };
}
{
  const { c } = fixture(scene => box(scene, .605, 1, 0, .2, 2, 2));
  const before = { ...c.position }, m = new LadderMotor(c, d, 'up');
  assert.equal(m.failure, 'overlap'); assert.deepEqual(c.position, before); restored(c);
}
{
  const { c } = fixture(scene => box(scene, 0, 2.2, 0, .3, .15, 2));
  const m = new LadderMotor(c, d, 'up');
  for (let i = 0; i < 200 && m.status === 'active'; i++) m.advance(1 / 60);
  assert.equal(m.status, 'failed'); assert.equal(m.failure, 'trajectory'); restored(c);
}
{
  const { c } = fixture(), m = new LadderMotor(c, d, 'up');
  c.move = () => { throw new Error('native move exception'); };
  assert.throws(() => m.advance(1 / 60), /native move exception/);
  assert.equal(m.status, 'failed'); restored(c);
}
for (const reason of ['support', 'trajectory', 'budget', 'time', 'controller', 'entry', 'revision', 'options', 'initial-support']) {
  const { physics, c } = fixture();
  if (reason === 'initial-support') {
    const floor = physics.staticWorld.objects.find(o => o?.mesh?.position.y === -.2);
    physics.removeStatic(floor.id); physics.rebuildStatic();
  }
  if (reason === 'support') {
    // Supported entry but missing upper platform: no projected-roof success.
    const top = physics.staticWorld.objects.find(o => o?.mesh?.position.y === 2.8);
    physics.removeStatic(top.id); physics.rebuildStatic();
  }
  if (reason === 'entry') c.position.x += .01;
  const m = new LadderMotor(c, d, 'up', reason === 'budget' ? 1 : ladderMoveBudget(d));
  if (reason === 'trajectory') c.position.z += .01;
  if (reason === 'controller') c.radius *= .99;
  if (reason === 'revision') physics.rebuildStatic();
  if (reason === 'options') c.snapDistance = .1;
  for (let i = 0; i < 300 && m.status === 'active'; i++) m.advance(reason === 'time' ? .251 : 1 / 60);
  const expected = reason === 'initial-support' ? 'support' : ['revision', 'options'].includes(reason) ? 'controller' : reason;
  assert.equal(m.status, 'failed'); assert.equal(m.failure, expected); restored(c);
}
if (process.env.LADDER_REPORT) writeFileSync(process.env.LADDER_REPORT, JSON.stringify({
  sourceHash: f.meta.sourceHash, assets: f.meta.assets, navigation: f.meta.navigation,
  bvh: { triangles: f.physics.staticWorld.triCount, nodes: f.physics.staticWorld.nodeCount }, descriptors, profiles, results, interruptions,
}, null, 2));
console.log(`ok  ladder native BVH: ${results.length} complete six-ladder/profile/direction/frame proofs; ${interruptions.length} exact cursor continuations/returns and fail-closed controls`);
