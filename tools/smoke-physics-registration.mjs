/**
 * Headless regressions for issue 286: explicit collision registration and
 * one ragdoll per death. Physics no longer auto-discovers visuals or listens
 * for actor:death.
 *
 *   node tools/smoke-physics-registration.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../src/core/registry.js';
import { Rng } from '../src/core/rng.js';
import { PhysicsSystem } from '../src/physics/index.js';

function makeCtx(scene) {
  return {
    events: new EventBus(),
    scene,
    camera: new THREE.PerspectiveCamera(),
    time: { alpha: 0, elapsed: 0, dt: 1 / 60 },
    rng: new Rng(0x51a7),
  };
}

function visualGround() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial()
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'ground_concrete';
  return mesh;
}

{
  const scene = new THREE.Scene();
  scene.add(visualGround());
  scene.updateMatrixWorld(true);
  const phys = new PhysicsSystem();
  const ctx = makeCtx(scene);
  await phys.init(ctx);
  phys.fixedUpdate(1 / 120);
  assert.equal(phys.triangleCount, 0, 'visuals in the scene are not silent collision');
  assert.equal(phys.stats.objects, 0, 'empty physics stays empty until addStatic');
}

{
  const scene = new THREE.Scene();
  const ground = visualGround();
  scene.add(ground);
  scene.updateMatrixWorld(true);
  const phys = new PhysicsSystem();
  await phys.init(makeCtx(scene));
  const id = phys.addStatic(ground, 'concrete');
  assert.ok(id >= 0, 'addStatic returns a handle');
  phys.rebuildStatic();
  assert.ok(phys.triangleCount > 0, 'explicit addStatic registers triangles');
  const hit = phys.raycast({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, 8);
  assert.equal(hit.hit, true, 'registered ground is raycastable');
}

{
  const phys = new PhysicsSystem();
  const ctx = makeCtx(new THREE.Scene());
  await phys.init(ctx);
  const rd = phys.createRagdoll({
    transform: new THREE.Matrix4().makeTranslation(0, 1.2, 0),
    height: 1.8,
    mass: 80,
  });
  assert.ok(rd, 'createRagdoll still works');
  assert.equal(phys.ragdolls.length, 1, 'one ragdoll from the factory');
  ctx.events.emit('actor:death', {
    actor: { ragdoll: rd, mesh: null, skeleton: { bones: [{ name: 'hips' }] } },
    point: { x: 0, y: 1, z: 0 },
    impulse: { x: 2, y: 0, z: 0 },
  });
  assert.equal(phys.ragdolls.length, 1, 'actor:death does not spawn a second ragdoll');
}

console.log('smoke-physics-registration: ok');
