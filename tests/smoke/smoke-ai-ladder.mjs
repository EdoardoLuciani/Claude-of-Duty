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
const results = [], interruptions = [], corrections = [], boundaries = [], boundaryControls = [];
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

function directedPoints(descriptor, direction) {
  return direction === 'up' ? descriptor.points : descriptor.points.toReversed();
}
function segmentSpan(descriptor, direction, segment) {
  const points = directedPoints(descriptor, direction), a = points[segment], b = points[segment + 1];
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
// Exact phase boundaries differ from the existing inside-shaft interrupts.
for (const descriptor of descriptors) for (const profile of profiles) for (const direction of ['up', 'down']) {
  for (const segment of [0, 1, 2]) for (const mode of segment === 2 ? ['resume'] : ['resume', 'reverse']) {
    const c = controller(f.physics.staticWorld, descriptor, direction, profile);
    let nativeMoves = 0;
    const nativeMove = c.move.bind(c);
    c.move = (...args) => { nativeMoves++; assert.ok(args.every(Number.isFinite)); return nativeMove(...args); };
    c.setPosition = c.teleport = c.setHeight = () => { throw new Error('boundary relocation/resize forbidden'); };
    const original = new LadderMotor(c, descriptor, direction);
    for (let calls = 0; original.status === 'active' && (segment === 2 || original.cursor.segment <= segment); calls++) {
      assert.ok(calls < 1000); original.advance(1 / 60);
    }
    assert.equal(original.status, segment === 2 ? 'complete' : 'active');
    const foot = { ...c.position }, spent = original.cursor.moves;
    original.cancel(); restored(c);
    const selectedDirection = mode === 'resume' ? direction : direction === 'up' ? 'down' : 'up';
    const selectedSegment = mode === 'resume' ? segment : 1 - segment;
    const cursor = { segment: selectedSegment, distance: segmentSpan(descriptor, selectedDirection, selectedSegment),
      pendingTime: 0, moves: mode === 'resume' ? spent : 0 };
    const m = new LadderMotor(c, descriptor, selectedDirection, ladderMoveBudget(descriptor), cursor);
    assert.equal(m.status, 'active');
    const paused = JSON.stringify([m.cursor, c.position]);
    m.advance(0); m.advance(-1);
    assert.equal(JSON.stringify([m.cursor, c.position]), paused);
    const before = nativeMoves;
    m.advance(1 / 120); // Normalize without spending even a half-quantum.
    assert.equal(nativeMoves, before); assert.deepEqual(c.position, foot);
    assert.equal(m.cursor.moves, cursor.moves); assert.equal(m.cursor.pendingTime, 1 / 120);
    assert.equal(m.status, selectedSegment === 2 ? 'complete' : 'active');
    if (selectedSegment !== 2) {
      assert.equal(m.cursor.segment, selectedSegment + 1); assert.equal(m.cursor.distance, 0);
    }
    const normalized = { cursor: { ...m.cursor }, foot: { ...c.position }, status: m.status };
    for (let calls = 0; m.status === 'active'; calls++) {
      assert.ok(calls < 1000);
      const previousMoves = nativeMoves;
      m.advance(.25);
      assert.ok(nativeMoves - previousMoves <= LADDER.maxSubsteps);
    }
    assert.equal(m.status, 'complete'); restored(c); assert.equal(c.grounded, true);
    assert.equal(m.cursor.moves, cursor.moves + nativeMoves - before, 'spent budget must survive normalization');
    assert.equal(m.maxMoves, ladderMoveBudget(descriptor));
    const target = directedPoints(descriptor, selectedDirection)[3];
    assert.ok(Math.hypot(c.position.x - target.x, c.position.y - target.y, c.position.z - target.z) < 1e-6);
    boundaries.push({ id: descriptor.id, profile: profile.name, direction, segment, mode, cursor, foot,
      normalized, finalCursor: { ...m.cursor }, finalFoot: { ...c.position }, nativeMoves: nativeMoves - before });
  }
}

const volume = { kind: 'ladder', x: 0, z: 0, y0: 0, y1: 3, radius: .42, nx: 1, nz: 0 };
for (const change of [{ nx: undefined }, { nz: NaN }, { nx: 2 }, { y1: 0 }, { radius: -1 },
  { y1: 1e-20 }, { y1: Number.MIN_VALUE }, { x: 1e20 }, { x: Number.MAX_VALUE }, { z: 1e20, nx: 0, nz: 1 }]) {
  assert.throws(() => createLadderDescriptors([{ ...volume, ...change }]));
  corrections.push({ guard: 'factory-geometry', change, rejected: true });
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
for (const direction of ['up', 'down']) {
  for (const segment of [0, 1, 2]) {
    const { physics } = fixture(), points = directedPoints(d, direction);
    const c = new CharacterController(physics.staticWorld, { radius: profiles[0].radius, height: profiles[0].height,
      position: points[segment + 1], stepHeight: INFANTRY.stepHeight, snapDistance: .32 });
    const cap = ladderMoveBudget(d), cursor = { segment, distance: segmentSpan(d, direction, segment), pendingTime: 0, moves: cap };
    let moves = 0;
    const nativeMove = c.move.bind(c);
    c.move = (...args) => { moves++; return nativeMove(...args); };
    const m = new LadderMotor(c, d, direction, cap, cursor), foot = { ...c.position };
    assert.equal(m.status, 'active');
    m.advance(0); assert.deepEqual(m.cursor, cursor);
    m.advance(1 / 120);
    assert.equal(m.cursor.moves, cap); assert.equal(moves, 0); assert.deepEqual(c.position, foot);
    if (segment === 2) {
      assert.equal(m.status, 'complete'); assert.ok(c.grounded);
    } else {
      assert.equal(m.status, 'active'); assert.equal(m.cursor.segment, segment + 1);
      const paused = { ...m.cursor }; m.advance(0); assert.deepEqual(m.cursor, paused);
      m.advance(1 / 120);
      assert.equal(m.status, 'failed'); assert.equal(m.failure, 'budget');
    }
    assert.equal(m.cursor.moves, cap); assert.equal(moves, 0); assert.deepEqual(c.position, foot); restored(c);
    boundaryControls.push({ guard: 'spent-budget', direction, segment, cursor, status: m.status, moves, spent: m.cursor.moves });
  }
  {
    const { physics } = fixture(), target = directedPoints(d, direction)[3];
    const supportY = direction === 'up' ? 2.8 : -.2;
    const support = physics.staticWorld.objects.find(o => o?.mesh?.position.y === supportY);
    physics.removeStatic(support.id); physics.rebuildStatic();
    const c = new CharacterController(physics.staticWorld, { radius: profiles[0].radius, height: profiles[0].height,
      position: target, stepHeight: INFANTRY.stepHeight, snapDistance: .32 });
    const m = new LadderMotor(c, d, direction, ladderMoveBudget(d),
      { segment: 2, distance: segmentSpan(d, direction, 2), moves: 1, pendingTime: 0 });
    let moves = 0;
    const nativeMove = c.move.bind(c);
    c.move = (...args) => { moves++; return nativeMove(...args); };
    assert.equal(m.status, 'active'); m.advance(1 / 120);
    assert.equal(m.status, 'failed'); assert.equal(m.failure, 'support');
    assert.equal(moves, 0); assert.deepEqual(c.position, target); restored(c);
    boundaryControls.push({ guard: 'missing-terminal-support', direction, status: m.status, failure: m.failure, moves });
  }
  {
    const { physics } = fixture(), point = directedPoints(d, direction)[1];
    const c = new CharacterController(physics.staticWorld, { radius: profiles[0].radius, height: profiles[0].height,
      position: point, stepHeight: INFANTRY.stepHeight, snapDistance: .32 });
    const m = new LadderMotor(c, d, direction, ladderMoveBudget(d),
      { segment: 0, distance: segmentSpan(d, direction, 0), moves: 1, pendingTime: 0 });
    m.cursor.distance += 1e-7; // Within trajectory EPS but negative remaining is still invalid.
    let moves = 0;
    const nativeMove = c.move.bind(c);
    c.move = (...args) => { moves++; return nativeMove(...args); };
    m.advance(1 / 60);
    assert.equal(m.status, 'failed'); assert.equal(m.failure, 'trajectory');
    assert.equal(moves, 0); assert.deepEqual(c.position, point); restored(c);
    boundaryControls.push({ guard: 'negative-remaining', direction, status: m.status, failure: m.failure, moves });
  }
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
// Inject errors at the actual native query boundaries, not a replacement motor.
for (const stage of ['constructor-overlap', 'constructor-support', 'pre-overlap', 'move', 'post-overlap', 'terminal-support', 'terminal-probe']) {
  const { c } = fixture(), world = c.world, error = new Error(stage);
  c.stepHeight = .123; c.snapDistance = .456;
  const overlap = world.overlapCapsule.bind(world), sweep = world.sweepCapsule.bind(world);
  const nativeMove = c.move.bind(c), probe = c.probeGround.bind(c);
  let moved = false, supported = false, thrown = false;
  let m;
  function inject() {
    if (stage.includes('overlap')) world.overlapCapsule = (...args) => {
      if (stage !== 'post-overlap' || moved) { thrown = true; throw error; }
      return overlap(...args);
    };
    if (stage === 'move') c.move = () => { thrown = true; throw error; };
    if (stage === 'post-overlap') c.move = (...args) => { const result = nativeMove(...args); moved = true; return result; };
    if (stage.includes('support') || stage === 'terminal-probe') world.sweepCapsule = (...args) => {
      if (args[6] === c.radius && args[10] === LADDER.supportDistance) {
        if (stage !== 'terminal-probe') { thrown = true; throw error; }
        supported = true;
      }
      return sweep(...args);
    };
    if (stage === 'terminal-probe') c.probeGround = () => {
      if (supported) { thrown = true; throw error; }
      return probe();
    };
  }
  if (stage.startsWith('constructor')) {
    inject();
    assert.throws(() => new LadderMotor(c, d, 'up'), caught => caught === error);
  } else {
    m = new LadderMotor(c, d, 'up');
    if (stage.startsWith('terminal')) {
      while (m.cursor.segment !== 2 || LADDER.upperOffset - m.cursor.distance > LADDER.speed * LADDER.step + 1e-6) {
        assert.equal(m.advance(1 / 60), 'active');
      }
    }
    inject();
    assert.throws(() => m.advance(1 / 60), caught => caught === error);
    assert.equal(m.status, 'failed'); assert.equal(m.failure, 'controller');
  }
  assert.equal(thrown, true, stage);
  assert.equal(c.stepHeight, .123); assert.equal(c.snapDistance, .456);
  corrections.push({ guard: stage, restored: true, originalError: true });
}
for (const change of ['disposed', 'disposed-paused', 'replacement', 'empty-entry']) {
  const { c } = fixture(), world = c.world, revision = world.version;
  const m = change === 'empty-entry' ? null : new LadderMotor(c, d, 'up');
  const before = { ...c.position };
  let moves = 0;
  const nativeMove = c.move.bind(c);
  c.move = (...args) => { moves++; return nativeMove(...args); };
  if (change === 'replacement') {
    c.world = fixture().physics.staticWorld;
    assert.notEqual(c.world, world); assert.equal(c.world.version, revision);
  } else {
    world.dispose(); assert.equal(world.version, revision); assert.equal(world.dirty, false);
  }
  const motor = m ?? new LadderMotor(c, d, 'up');
  motor.advance(change === 'disposed-paused' ? 0 : 1 / 60);
  assert.equal(motor.status, 'failed'); assert.equal(motor.failure, 'controller');
  assert.equal(moves, 0); assert.deepEqual(c.position, before); restored(c);
  corrections.push({ guard: change, moves, restored: true });
}
for (const corruption of ['foot-entry', 'foot', 'expected', 'collapsed-span', 'distance', 'moves', 'pendingTime', 'verticalTravel']) {
  const { c } = fixture();
  const descriptor = { ...d, points: d.points.map(p => ({ ...p })) };
  if (corruption === 'foot-entry') c.position.x = NaN;
  const m = new LadderMotor(c, descriptor, 'up');
  if (corruption === 'foot') c.position.z = Infinity;
  if (corruption === 'expected') descriptor.points[1].x = NaN;
  if (corruption === 'collapsed-span') Object.assign(descriptor.points[1], descriptor.points[0]);
  if (['distance', 'moves', 'pendingTime'].includes(corruption)) m.cursor[corruption] = NaN;
  if (corruption === 'verticalTravel') m.verticalTravel = Infinity;
  const before = { ...c.position };
  let moves = 0;
  const nativeMove = c.move.bind(c);
  c.move = (...args) => { moves++; assert.ok(args.every(Number.isFinite)); return nativeMove(...args); };
  m.advance(1 / 60);
  assert.equal(m.status, 'failed', corruption); assert.equal(moves, 0, corruption);
  assert.deepEqual(c.position, before); restored(c);
  corrections.push({ guard: corruption, moves, failure: m.failure, restored: true });
}
// Reproduce the review's eighteenth-move failure with a raw collapsed shaft:
// even bypassing the checked factory must not pass NaN displacement to physics.
for (const corruption of ['collapsed-shaft', 'nonfinite-shaft']) {
  const { c } = fixture(), descriptor = { ...d, points: d.points.map(p => ({ ...p })) };
  if (corruption === 'collapsed-shaft') Object.assign(descriptor.points[2], descriptor.points[1]);
  else descriptor.points[2].y = Infinity;
  // Bound the forged infinite geometry independently of its invalid budget.
  const m = new LadderMotor(c, descriptor, 'up', Math.min(ladderMoveBudget(d), ladderMoveBudget(descriptor)));
  const nativeMove = c.move.bind(c);
  let moves = 0;
  c.move = (...args) => { moves++; assert.ok(args.every(Number.isFinite)); return nativeMove(...args); };
  for (let i = 0; i < 17; i++) assert.equal(m.advance(1 / 60), 'active');
  const before = { ...c.position };
  m.advance(1 / 60);
  assert.equal(m.status, 'failed'); assert.equal(moves, 17);
  assert.deepEqual(c.position, before); assert.ok(Object.values(c.position).every(Number.isFinite)); restored(c);
  corrections.push({ guard: corruption, moves, restored: true, footFinite: true });
}
{
  const { c } = fixture(), m = new LadderMotor(c, d, 'up');
  const nativeMove = c.move.bind(c);
  let moves = 0;
  c.move = (...args) => { moves++; const result = nativeMove(...args); c.position.x = NaN; return result; };
  m.advance(.25);
  assert.equal(m.status, 'failed'); assert.equal(m.failure, 'trajectory'); assert.equal(moves, 1); restored(c);
  corrections.push({ guard: 'nonfinite-native-result', moves, failure: m.failure, restored: true });
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
  bvh: { triangles: f.physics.staticWorld.triCount, nodes: f.physics.staticWorld.nodeCount }, descriptors, profiles, results, interruptions, corrections, boundaries, boundaryControls,
}, null, 2));
console.log(`ok  ladder native BVH: ${results.length} complete six-ladder/profile/direction/frame proofs; ${interruptions.length} exact cursor continuations/returns; ${corrections.length} numeric/query/source guards; ${boundaries.length} boundary proofs and ${boundaryControls.length} boundary controls`);
