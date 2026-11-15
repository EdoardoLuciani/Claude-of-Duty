import assert from 'node:assert/strict';

import * as THREE from 'three/webgpu';

import type { Engine } from '../../src/core/engine.ts';
import { prewarm } from '../../src/core/prewarm.ts';
import { Rng } from '../../src/core/rng.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { AmmoPickups } from '../../src/weapons/ammo-pickups.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import type { WeaponEntry } from '../../src/weapons/runtime-types.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';

const geometry = new THREE.BoxGeometry(),
  material = new THREE.MeshPhysicalNodeMaterial();
const magazine = new THREE.Group();
magazine.add(new THREE.Mesh(geometry, material));
const group = new THREE.Group();
const irons = new THREE.Group();
irons.name = 'IRON_sights';
const ironsRemoved = new THREE.Group();
ironsRemoved.name = 'IRON_sights_removed';
ironsRemoved.visible = false;
const muzzleDevice = new THREE.Group();
muzzleDevice.name = 'MUZZLE_device';
const muzzleAdapter = new THREE.Group();
muzzleAdapter.name = 'MUZZLE_device_removed';
muzzleAdapter.visible = false;
group.add(magazine, irons, ironsRemoved, muzzleDevice, muzzleAdapter);
group.visible = false;
const radio = new THREE.Group();
radio.visible = false;
const scopeOverlay = new THREE.Group();
scopeOverlay.visible = false;
const reticle = new THREE.Group();
reticle.visible = false;
const grenade = new THREE.Group();
grenade.visible = false;
const scene = new THREE.Scene(),
  viewScene = new THREE.Scene();
viewScene.add(group, radio, scopeOverlay, reticle, grenade);
let calls = 0,
  finish: (report: Awaited<ReturnType<RenderSystem['_warmGraph']>>) => void = (): never => {
    throw Error('warmup resolver missing');
  };
const flashlight = new THREE.SpotLight();
const weapon = fixture<WeaponEntry>({
  id: 'rifle',
  group,
  parts: { magazine },
  magLen: 0.15,
  model: fixture<WeaponEntry['model']>({ id: 'rifle', scene: group, root: group }),
});
const system = new WeaponSystem();
system._droppedMags = [];
system.viewmodel = fixture<WeaponSystem['viewmodel']>({
  radio,
  scopeOverlay,
  reticle,
  grenade,
  weapons: new Map([['rifle', weapon]]),
});
system.rng = new Rng(1);
system.rng.signed = (): never => assert.fail('warmup consumed gameplay RNG');
const graph = fixture<NonNullable<RenderSystem['_graph']>>({});
const render = fixture<RenderSystem>({
  _graph: graph,
  patchMaterials(): void {},
  prewarmLightShadow(light): ReturnType<RenderSystem['_warmGraph']> {
    assert.equal(light, flashlight, 'hidden pickups and magazines need flashlight variants');
    return render._warmGraph();
  },
  _warmGraph(): ReturnType<RenderSystem['_warmGraph']> {
    calls++;
    assert(irons.visible && ironsRemoved.visible, 'warm both independent iron-sight variants');
    assert(muzzleDevice.visible && muzzleAdapter.visible, 'warm both muzzle states');
    assert.equal(scene.children.length, 3);
    assert.equal(system.pickups.items.length, 0);
    assert.equal(system.pickups._nextId, 1);
    assert(scene.children.every((o): boolean => o.visible));
    assert(
      scopeOverlay.visible && reticle.visible && grenade.visible,
      'hidden optics/grenade ancestors must be warmed'
    );
    return new Promise<Awaited<ReturnType<RenderSystem['_warmGraph']>>>((resolve): void => {
      finish = resolve;
    });
  },
});
system.ctx = createTestContext({
  scene,
  viewScene,
  viewCamera: new THREE.PerspectiveCamera(),
  providers: { player: fixture<PlayerSystem>({ flashlight }), render },
});
system.pickups = new AmmoPickups(system);
let loaded = (): void => {
  throw Error('asset resolver missing');
};
system._restTask = new Promise<void>((resolve): void => {
  loaded = resolve;
});
render._graph = null;
await assert.rejects(system.prewarmMaterials(), /not ready/, 'early calls must not report success');
render._graph = graph;
const pending = system.prewarmMaterials();
const concurrent = system.prewarmMaterials();
assert.equal(concurrent, pending, 'concurrent callers share the same work');
let settled = false;
void concurrent.then((): void => {
  settled = true;
});
await Promise.resolve();
assert.equal(settled, false, 'concurrent callers must wait for completion');
assert.equal(calls, 0, 'boot awaits deferred assets before warming');
assert.equal(scene.children.length, 0);
loaded();
await Promise.resolve();
assert.equal(calls, 1);
assert.equal(muzzleAdapter.visible, true, 'muzzle adapter remains warm until completion');
const graphWarm = { ms: 12, geometries: 8, frameUnchanged: true };
finish(graphWarm);
const report = await pending;
assert.deepEqual(report, { graphWarm });
assert.equal(system.prewarmMaterials(), pending, 'completed work stays cached');
assert.equal(calls, 1, 'completion never repeats native warmup');
assert.equal(radio.visible, false);
assert.equal(group.visible, false);
assert(irons.visible);
assert.equal(ironsRemoved.visible, false);
assert(muzzleDevice.visible);
assert.equal(muzzleAdapter.visible, false, 'restore the base muzzle after warmup');
assert.equal(scopeOverlay.visible || reticle.visible, false);
assert.equal(grenade.visible, false);
assert.equal(scene.children.length, 2, 'temporary ammo visual was removed');
for (const p of system._droppedMags) {
  assert.equal(p.group.visible, false);
  assert.equal(p.group.parent, scene);
  assert.equal(p.body, null);
  assert.equal(p.until, 0);
  const mesh = p.group.children[0];
  assert(mesh instanceof THREE.Mesh);
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, material);
}
// Failure restores visibility and leaves an existing pool/body untouched.
const failedSystem = new WeaponSystem();
failedSystem.ctx = system.ctx;
failedSystem.viewmodel = system.viewmodel;
failedSystem.pickups = system.pickups;
failedSystem._restTask = Promise.resolve();
failedSystem._droppedMags = system._droppedMags;
failedSystem._magPools = system._magPools;
const body = fixture<NonNullable<(typeof system._droppedMags)[number]['body']>>({});
system._droppedMags[0].body = body;
failedSystem.physics = fixture<PhysicsSystem>({
  removeRigidBody: (): never => assert.fail('warmup removed live debris'),
});
const failure = new Error('intentional warmup failure');
let failures = 0;
render._warmGraph = async (): ReturnType<RenderSystem['_warmGraph']> => {
  failures++;
  throw failure;
};
const failed = failedSystem.prewarmMaterials();
const failedConcurrent = failedSystem.prewarmMaterials();
assert.equal(failedConcurrent, failed);
await assert.rejects(failed, (error: unknown): boolean => error === failure);
assert.equal(failedSystem.prewarmMaterials(), failed, 'failed boot work stays failed');
assert.equal(failures, 1, 'failed warmup must not retry during gameplay');
// The coordinator, not the weapon operation, owns status/error presentation.
render.renderer = fixture<THREE.Renderer>({
  getRenderTarget: (): null => null,
  setRenderTarget(): void {},
});
const cases: [WeaponSystem, boolean][] = [
  [system, true],
  [failedSystem, false],
];
for (const [provider, ok] of cases) {
  const summary = await prewarm(
    fixture<Engine>({
      error: null,
      camera: new THREE.PerspectiveCamera(),
      scene,
      viewScene,
      ctx: system.ctx,
      registry: fixture<Engine['registry']>({ ordered: [provider] }),
    })
  );
  assert(summary.hooks);
  assert.equal(summary.ok, ok);
  if (ok) assert.equal(summary.hooks.weapons, report);
  else assert.deepEqual(summary.hooks.weapons, { ok: false, reason: failure.message });
}
assert.equal(failures, 1);
assert(muzzleDevice.visible);
assert.equal(muzzleAdapter.visible, false, 'failed warmup restores the muzzle too');
assert.equal(radio.visible, false);
assert.equal(group.visible, false);
assert(system._droppedMags.every((p): boolean => !p.group.visible));
assert.equal(scopeOverlay.visible || reticle.visible, false);
assert.equal(grenade.visible, false);
assert.equal(system._droppedMags[0].body, body);
assert.equal(scene.children.length, 2);
assert.equal(system.pickups.items.length, 0);
assert.equal(system.pickups._nextId, 1);
system.pickups.dispose();
geometry.dispose();
material.dispose();
console.log('magazine prewarm ownership/concurrency/failure restoration passed');
