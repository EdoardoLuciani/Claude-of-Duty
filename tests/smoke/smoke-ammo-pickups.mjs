import assert from 'node:assert/strict';

import * as THREE from 'three';

import { Rng } from '../../src/core/rng.ts';
import { AmmoPickups } from '../../src/weapons/ammo-pickups.ts';

function harness() {
  const scene = new THREE.Scene(),
    prompts = [],
    cleared = [],
    events = [];
  const player = { feetPosition: new THREE.Vector3(), controlEnabled: true };
  const input = { enabled: true, frozen: false, use: false, action: () => input.use };
  const ui = {
    setPrompt: (p, owner) => prompts.push({ ...p, owner }),
    clearPrompt: (owner) => cleared.push(owner),
  };
  const intel = { blocked: false, blocksUse: () => intel.blocked };
  const ctx = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    time: { elapsed: 0, scale: 1 },
    input,
    events: { emit: (name, payload) => events.push({ name, payload }) },
    peek: (name) => ({ player, ui, intel })[name],
  };
  const owner = {
    ctx,
    rng: new Rng(123),
    player,
    ammo: { total: 0, magSize: 30 },
    state: { reserve: 0, def: { reserve: 90, magSize: 30 } },
    current: 'rifle',
    addReserve(n) {
      this.state.reserve += n;
      return n;
    },
  };
  return {
    pickups: new AmmoPickups(owner),
    owner,
    ctx,
    input,
    player,
    intel,
    prompts,
    cleared,
    events,
  };
}

function matricesMatch(pickups) {
  const actual = new THREE.Matrix4();
  for (const mesh of pickups._batches) {
    const count = pickups.items.length ? Math.max(...pickups.items.map((p) => p.slot)) + 1 : 0;
    assert.equal(mesh.count, count, 'bounded sparse draw range');
    assert(count <= 32);
    for (const item of pickups.items) {
      item.group.updateMatrix();
      mesh.getMatrixAt(item.slot, actual);
      actual.elements.forEach((n, j) => assert(Math.abs(n - item.group.matrix.elements[j]) < 1e-6));
      const sphere = mesh.geometry.boundingSphere.clone().applyMatrix4(actual);
      assert(
        mesh.boundingSphere.center.distanceTo(sphere.center) + sphere.radius <=
          mesh.boundingSphere.radius + 1e-5,
        'updated population bounds enclose each transformed item'
      );
    }
    for (let slot = 0; slot < mesh.count; slot++) {
      if (pickups._slots[slot]) continue;
      mesh.getMatrixAt(slot, actual);
      assert.equal(actual.determinant(), 0, 'holes have no rasterized geometry');
      assert.equal(actual.elements[0], 0);
      assert.equal(actual.elements[5], 0);
      assert.equal(actual.elements[10], 0);
    }
  }
}

// The actual boot visual is retained for gameplay, with four native finish
// batches, no lights, and exactly the old vertex positions/normals/UVs baked in.
{
  const { pickups, owner } = harness();
  const rngBefore = { ...owner.rng };
  const visual = pickups._makeVisual();
  assert.equal(pickups._makeVisual(), visual);
  assert.equal(pickups.items.length, 0);
  assert.equal(pickups._nextId, 1);
  assert.deepEqual({ ...owner.rng }, rngBefore);
  assert.equal(visual.parent, null);
  assert.equal(visual.children.length, 4);
  const old = {
    case: [new THREE.BoxGeometry(0.38, 0.19, 0.27).translate(0, 0.12, 0)],
    edge: [
      new THREE.BoxGeometry(0.4, 0.045, 0.29).translate(0, 0.235, 0),
      new THREE.BoxGeometry(0.045, 0.205, 0.282).translate(0.1, 0.13, 0),
    ],
    latch: [new THREE.BoxGeometry(0.075, 0.065, 0.035).translate(0, 0.18, 0.155)],
    ring: [new THREE.TorusGeometry(0.29, 0.011, 6, 28).rotateX(Math.PI / 2).translate(0, 0.035, 0)],
  };
  for (const [i, name] of ['case', 'edge', 'latch', 'ring'].entries()) {
    const mesh = visual.children[i];
    assert(mesh.isInstancedMesh);
    assert.equal(mesh.instanceMatrix.usage, THREE.DynamicDrawUsage);
    assert.equal(mesh.instanceMatrix.count, 32);
    assert.equal(mesh.castShadow, name !== 'ring');
    assert.equal(mesh.receiveShadow, name !== 'ring');
    assert.equal(!!mesh.userData.owNoPrepass, name === 'ring');
    if (name === 'edge')
      assert.equal(mesh.geometry.groups.length, 0, 'merged edge is one draw, not material groups');
    for (const attribute of ['position', 'normal', 'uv']) {
      const expected = old[name].flatMap((g) => [...g.attributes[attribute].array]);
      const actual = [...mesh.geometry.attributes[attribute].array];
      assert.equal(actual.length, expected.length);
      actual.forEach((n, j) => assert(Math.abs(n - expected[j]) < 1e-7));
    }
    old[name].forEach((g) => g.dispose());
  }
  pickups.dispose();
}

// Stable IDs, unchanged two-draw RNG order, cap evicts oldest; array order
// remains creation order even when first, middle and last items are removed.
// Surviving native slots never move; reuse changes identity, not capacity.
{
  const { pickups, ctx } = harness();
  const expected = new Rng(123);
  for (let i = 0; i < 33; i++) {
    const item = pickups.spawn({ x: i * 2, y: i * 0.1, z: -i });
    assert.equal(item.id, i + 1);
    assert.equal(item.group.rotation.y, expected.range(0, Math.PI * 2));
    assert.equal(item.phase, expected.range(0, Math.PI * 2));
    assert.equal(item.born, 0);
    assert.equal(item.expires, 180);
    assert.equal(item.group.position.y, i * 0.1 + 0.035);
    matricesMatch(pickups);
  }
  assert.deepEqual(
    pickups.items.map((p) => p.id),
    Array.from({ length: 32 }, (_, i) => i + 2)
  );
  assert.equal(ctx.scene.children.length, 1);
  assert.equal(ctx.scene.children[0].children.length, 4);
  for (const index of [0, 15, 29]) {
    const removed = pickups.items[index];
    const ids = pickups.items.filter((p) => p !== removed).map((p) => p.id);
    const slots = pickups.items.filter((p) => p !== removed).map((p) => p.slot);
    pickups._remove(removed);
    assert.deepEqual(
      pickups.items.map((p) => p.slot),
      slots
    );
    assert.equal(pickups._slots[removed.slot], null);
    assert.deepEqual(
      pickups.items.map((p) => p.id),
      ids
    );
    matricesMatch(pickups);
  }
  const yaw = pickups.items[0].group.rotation.y;
  ctx.time.elapsed = 2.5;
  pickups.update(0.25);
  assert.equal(pickups.items[0].group.rotation.y, yaw + 0.25 * 0.28);
  assert.equal(
    pickups.items[0].group.position.y,
    pickups.items[0].baseY + Math.sin(2.5 * 1.8 + pickups.items[0].phase) * 0.025
  );
  matricesMatch(pickups);
  const batches = [...pickups._batches];
  pickups.clear();
  assert.equal(ctx.scene.children.length, 0);
  assert(pickups._batches.every((m) => m.count === 0));
  const reused = pickups.spawn({ x: -40, y: 10, z: 25 });
  assert.equal(reused.id, 34, 'restart does not reset IDs');
  assert.deepEqual(pickups._batches, batches, 'reuse buffers, not fresh GPU pools');
  matricesMatch(pickups);
  ctx.time.elapsed = reused.expires - 0.001;
  pickups.update(0.01);
  assert.equal(pickups.items.length, 1);
  ctx.time.elapsed = reused.expires;
  pickups.update(0.01);
  assert.equal(pickups.items.length, 0);
  matricesMatch(pickups);
  const disposed = [];
  for (const resource of [
    ...batches,
    ...Object.values(pickups.geometries),
    ...Object.values(pickups.materials),
  ])
    resource.addEventListener('dispose', () => disposed.push(resource));
  pickups.dispose();
  assert.equal(disposed.length, 12, 'all four instance buffers, geometries and materials disposed');
  assert.equal(new Set(disposed).size, 12);
  assert.equal(ctx.scene.children.length, 0);
}

// Nearest item, hold reset/decay, expiry and owner-scoped cleanup; intel and
// busy/dead/paused hands still have priority over ammunition.
{
  const h = harness(),
    { pickups, ctx, input, owner, intel, prompts, cleared, events } = h;
  const first = pickups.spawn({ x: 1, y: 0, z: 0 });
  const nearest = pickups.spawn({ x: 0.2, y: 0, z: 0 });
  input.use = true;
  pickups.update(0.2);
  assert.equal(pickups._nearest, nearest);
  assert.equal(prompts.at(-1).owner, 'ammo');
  input.use = false;
  pickups.update(0.04);
  assert.equal(pickups._hold, 0.1);
  input.use = true;
  pickups._remove(nearest);
  assert.equal(pickups._hold, 0);
  assert.equal(cleared.at(-1), 'ammo');
  pickups.update(0.2);
  assert.equal(pickups._nearest, first);
  for (const [object, key, blocked] of [
    [intel, 'blocked', true],
    [owner, 'disabled', true],
    [owner, 'grenadeEquipped', true],
    [owner, 'radioEquipped', true],
    [input, 'frozen', true],
    [input, 'enabled', false],
    [h.player, 'dead', true],
    [h.player, 'controlEnabled', false],
    [ctx.time, 'scale', 0],
    [h.player, 'healCtrl', { active: true }],
  ]) {
    const previous = object[key];
    object[key] = blocked;
    pickups.update(0.5);
    assert.equal(pickups._nearest, null);
    assert.equal(owner.state.reserve, 0);
    object[key] = previous;
  }
  pickups.update(0.45);
  assert.equal(owner.state.reserve, 45);
  assert.equal(pickups.items.length, 0);
  assert.equal(events[0].name, 'ammo:pickup');
  assert.equal(events[0].payload.amount, 45);
  assert.equal(events[0].payload.weapon, 'rifle');
  assert(events[0].payload.position.equals(first.group.position));
  matricesMatch(pickups);
  pickups.spawn({ x: 0, y: 0, z: 0 });
  pickups.update(0.1);
  ctx.time.elapsed = 180;
  pickups.update(0.1);
  assert.equal(pickups._nearest, null);
  assert.equal(pickups._prompting, false);
  pickups.dispose();
}

// History becomes valid only after the actual world prepass has rendered that
// family. Removal cannot move survivors; reused/restarted identities start fresh.
{
  const { pickups, ctx } = harness();
  const a = pickups.spawn({ x: 2, y: 0, z: 0 });
  const b = pickups.spawn({ x: 3, y: 0, z: 0 });
  const markRendered = () => {
    ctx.camera.layers.set(1);
    for (const mesh of pickups._batches.slice(0, 3))
      mesh.onAfterRender(null, ctx.scene, ctx.camera);
    pickups._syncVisuals();
  };
  const flags = (slot) =>
    pickups._batches.slice(0, 3).map((m) => m.geometry.getAttribute('ammoHistoryValid').getX(slot));
  assert.deepEqual(flags(a.slot), [0, 0, 0]);
  const shadow = new THREE.PerspectiveCamera();
  shadow.layers.set(1);
  for (const mesh of pickups._batches.slice(0, 3)) mesh.onAfterRender(null, ctx.scene, shadow);
  pickups._syncVisuals();
  assert.deepEqual(flags(a.slot), [0, 0, 0], 'shadow callbacks cannot validate velocity history');
  markRendered();
  assert.deepEqual(flags(a.slot), [1, 1, 1]);
  b.group.position.x += 0.2;
  pickups._remove(a);
  assert.equal(b.slot, 1);
  assert.deepEqual(flags(b.slot), [1, 1, 1], 'moving survivor keeps its legitimate native history');
  const replacement = pickups.spawn({ x: -2, y: 0, z: 0 });
  assert.equal(replacement.slot, a.slot);
  assert.deepEqual(flags(replacement.slot), [0, 0, 0]);
  assert.deepEqual(flags(b.slot), [1, 1, 1]);
  markRendered();
  assert.deepEqual(flags(replacement.slot), [1, 1, 1]);
  pickups.clear();
  const versions = pickups._batches.map((m) => m.instanceMatrix.version);
  pickups.update(0);
  pickups.update(0);
  assert.deepEqual(
    pickups._batches.map((m) => m.instanceMatrix.version),
    versions,
    'empty frames do not dirty matrices'
  );
  const restarted = pickups.spawn({ x: 10, y: 0, z: 0 });
  assert.equal(restarted.slot, 0);
  assert.deepEqual(flags(restarted.slot), [0, 0, 0]);
  matricesMatch(pickups);
  pickups.dispose();
}

// Drop eligibility and RNG sequencing stay part of the economy, not batching.
{
  const { pickups, owner } = harness();
  const actor = { position: new THREE.Vector3(1, 2, 3) };
  assert.equal(pickups.onActorDeath({ actor: { ...actor, friendly: true } }), null);
  assert.equal(pickups.onActorDeath({ actor: { ...actor, isPlayerCorpse: true } }), null);
  assert.equal(pickups.onActorDeath({ actor: null }), null);
  const expected = new Rng(123);
  const item = pickups.onActorDeath({ actor });
  assert.equal(item.group.rotation.y, expected.range(0, Math.PI * 2));
  assert.equal(item.phase, expected.range(0, Math.PI * 2));
  owner.ammo.total = 999;
  const shouldDrop = expected.float() < 0.38;
  assert.equal(!!pickups.onActorDeath({ actor }), shouldDrop);
  if (shouldDrop) {
    expected.range(0, Math.PI * 2);
    expected.range(0, Math.PI * 2);
  }
  assert.deepEqual({ ...owner.rng }, { ...expected });
  pickups.dispose();
}
console.log(
  'Ammo pickup instancing: geometry/transforms, stable sparse slots/history/reuse, lifecycle, interaction, RNG and disposal passed'
);
