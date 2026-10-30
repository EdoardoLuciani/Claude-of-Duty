// Rigid skin geometry follows retained authored controls, not just empty helpers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { AX338Animation, makeAX338Model } from '../../src/weapons/ax338.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { createWeaponInspection } from '../../src/weapons/inspection.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

let maximumError = 0,
  poses = 0,
  probes = 0;
for (const product of ['ax338.glb', 'ax338.runtime.glb']) {
  const model = makeAX338Model(
    await parseGLB(readFileSync(new URL(`../../assets/weapons/ax338/${product}`, import.meta.url)))
  );
  const animation = new AX338Animation(model);
  model.scene.updateMatrixWorld(true);
  const vertices = [],
    dense = [],
    parts = new Set(),
    skeletons = new Set();
  const point = new THREE.Vector3(),
    expected = new THREE.Vector3();
  let draws = 0,
    visibleDraws = 0;
  model.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    draws++;
    let visible = true;
    for (let node = mesh; node; node = node.parent) visible &&= node.visible;
    if (visible) visibleDraws++;
    if (!mesh.isSkinnedMesh) return;
    skeletons.add(mesh.skeleton);
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      assert.equal(skinWeight.getX(i), 1, 'one complete rigid influence');
      assert.equal(skinWeight.getY(i) + skinWeight.getZ(i) + skinWeight.getW(i), 0);
      const bone = mesh.skeleton.bones[skinIndex.getX(i)];
      const part = bone.name.replace(/^MECH_/, '');
      parts.add(part);
      const helper = model.root.getObjectByName(part);
      assert(helper && !helper.isMesh, `${part}: retained original authored control`);
      const local = mesh
        .getVertexPosition(i, new THREE.Vector3())
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(helper.matrixWorld.clone().invert());
      const vertex = { mesh, index: i, helper, local };
      vertices.push(vertex);
      if (i % 251 === 0) dense.push(vertex);
    }
  });
  assert.equal(draws, 6, 'opaque skin + transparent lens + two magazine bodies + two rounds');
  assert.equal(visibleDraws, 4, 'loaded Idle excludes the spare body and rounds');
  assert.deepEqual([...parts].sort(), [
    'bolt',
    'handguard',
    'optic',
    'receiver',
    'stock',
    'trigger',
  ]);
  assert(
    vertices.length > 115000,
    'actual mechanical surfaces retained after codec vertex deduplication'
  );
  for (const clip of model.animations) {
    for (let frame = 0; frame <= Math.ceil(clip.duration * 240); frame++) {
      const time = Math.min(frame / 240, clip.duration);
      animation._sample(clip.name, time);
      model.scene.updateMatrixWorld(true);
      poses++;
      for (const vertex of frame === Math.ceil(clip.duration * 240) ? vertices : dense) {
        const { mesh, index, helper, local } = vertex;
        mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
        expected.copy(local).applyMatrix4(helper.matrixWorld);
        const error = point.distanceTo(expected);
        maximumError = Math.max(maximumError, error);
        // Bone and helper encode the same rotation in different rest bases.
        // Propagate the existing per-channel 1 um / 1e-4 rad codec bounds for
        // both paths, rather than weakening either channel or contact gate.
        const bound = product === 'ax338.glb' ? 0.000001 : 2 * (0.000001 + local.length() * 0.0001);
        assert(error < bound, `${product}/${clip.name}/${time}: real skin/control gap ${error}`);
        probes++;
      }
      for (const skeleton of skeletons)
        for (const bone of skeleton.bones)
          assert(
            Math.abs(bone.quaternion.length() - 1) < 1e-12,
            'unit sampled mechanical rotation'
          );
    }
    // Every gesture can be interrupted/reset without a stale skinned bolt/trigger.
    animation.update(0, 'cycle', 0.4, true, false);
    animation.update(0, null, 0, true, false);
    assert(!animation.magazineRound.visible && !animation.spare.visible);
    assert(animation.bolt.position.distanceTo(new THREE.Vector3(0, 0.075, 0.05)) < 0.000001);
  }
  for (const parent of [animation.magazine, animation.spare]) {
    let triangles = 0;
    parent.traverse((mesh) => {
      if (!mesh.isMesh) return;
      assert(!mesh.isSkinnedMesh, 'transferred/dropped magazine owns real independent geometry');
      triangles += mesh.geometry.index.count / 3;
    });
    assert.equal(triangles, 2680, 'body and real cartridge surfaces remain on both controls');
  }
  assert(animation.magazineBody.isMesh && !animation.magazineBody.isSkinnedMesh);
  assert.equal(
    animation.magazineBody.geometry.index.count / 3,
    1632,
    'real drop body, not a helper'
  );

  // Market cloning owns its new bones/textures, while geometry/materials stay borrowed.
  animation.update(0, 'cycle', 0.4, false);
  const snapshot = animation.bolt.position.clone();
  const inspection = createWeaponInspection({ model, def: WEAPON_DEFS.sniper });
  const previewSkeletons = new Set();
  inspection.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    assert(!skeletons.has(mesh.skeleton));
    assert(mesh.skeleton.bones.every((bone) => !model.root.getObjectById(bone.id)));
    previewSkeletons.add(mesh.skeleton);
    const live = model.scene.getObjectByName(mesh.name);
    assert.equal(mesh.geometry, live.geometry);
    assert.equal(mesh.material, live.material);
  });
  assert(previewSkeletons.size > 0);
  let liveDisposals = 0,
    previewDisposals = 0;
  for (const skeleton of skeletons) {
    skeleton.computeBoneTexture();
    skeleton.boneTexture.addEventListener('dispose', () => liveDisposals++);
  }
  for (const skeleton of previewSkeletons) {
    skeleton.computeBoneTexture();
    skeleton.boneTexture.addEventListener('dispose', () => previewDisposals++);
  }
  inspection.dispose();
  assert.equal(previewDisposals, previewSkeletons.size);
  assert.equal(liveDisposals, 0);
  assert(animation.bolt.position.equals(snapshot), 'inspection never changes gameplay controls');
  animation.dispose();
  assert.equal(
    liveDisposals,
    skeletons.size,
    'adapter releases all owned mechanical bone textures'
  );
}
console.log(
  `AX338 rigid skin: ${poses} half-frame poses / ${probes} actual vertex probes, maximum control gap ${maximumError} m; six draws/four Idle, real drop geometry, interruptions and independent inspection/disposal passed`
);
