// Actual rigid surfaces follow the original named controls, not just empty helpers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { makeEvolysModel, EvolysAnimation } from '../../src/weapons/evolys.ts';
import { createWeaponInspection } from '../../src/weapons/inspection.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

for (const suffix of ['.glb', '.runtime.glb']) {
  const model = makeEvolysModel(
    await parseGLB(
      readFileSync(
        new URL(`../../assets/weapons/fn-evolys-762/fn-evolys-762${suffix}`, import.meta.url)
      )
    )
  );
  const animation = new EvolysAnimation(model);
  const surfaces = [];
  const skeletons = new Set();
  const ownership = new Map();
  const controls = {
    static_surfaces: 'EVOLYS_RIG',
    stock_mesh: 'stock',
    bolt_mesh: 'bolt',
    charging_handle_mesh: 'charging_handle',
    feed_cover_mesh: 'feed_cover',
    trigger_mesh: 'trigger',
  };
  for (const [name, controlName] of Object.entries(controls)) {
    const group = model.root.getObjectByName(name);
    const control = model.root.getObjectByName(controlName);
    assert(group && control, `${name}: real geometry and source control retained`);
    assert.equal(group.parent, control, `${name}: ordinary geometry belongs to its control`);
    group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      assert(!mesh.isSkinnedMesh, `${name}: rigid geometry must not pay for skinning`);
      assert(!mesh.geometry.attributes.skinIndex && !mesh.geometry.attributes.skinWeight);
      surfaces.push(mesh);
      const rest = new THREE.Matrix4()
        .copy(control.matrixWorld)
        .invert()
        .multiply(mesh.matrixWorld);
      ownership.set(mesh, { control, rest });
    });
  }
  model.root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    skeletons.add(mesh.skeleton);
    assert(mesh.skeleton.bones.every((bone) => /^belt_[0-7]$/.test(bone.name)));
  });
  assert.equal(skeletons.size, 1, 'only the independent deforming belt needs a skeleton');
  assert.equal(surfaces.length, 7, 'static opaque/lens, stock and four real moving controls');
  const point = new THREE.Vector3();
  const expected = new THREE.Vector3();
  let poses = 0;
  let vertices = 0;
  let maximum = 0;
  for (const [name, action] of Object.entries(animation.actions)) {
    const duration = action.getClip().duration;
    // Dense 240 Hz controls plus actual every-vertex checks at 30 Hz, endpoints,
    // and both sides of every STEP transition (including fractional clip ends).
    const times = new Set([0, duration]);
    for (let frame = 0; frame <= Math.ceil(duration * 30); frame++)
      times.add(Math.min(frame / 30, duration));
    for (const track of action.getClip().tracks)
      if (track.name.endsWith('.scale'))
        for (const time of track.times) {
          times.add(time);
          times.add(Math.max(0, time - 1e-6));
          times.add(Math.min(duration, time + 1e-6));
        }
    for (const time of times) {
      animation._sample(name, time);
      model.root.updateMatrixWorld(true);
      poses++;
      for (const mesh of surfaces) {
        const { control, rest } = ownership.get(mesh);
        const transform = new THREE.Matrix4().multiplyMatrices(control.matrixWorld, rest);
        const position = mesh.geometry.attributes.position;
        for (let index = 0; index < position.count; index++) {
          expected.fromBufferAttribute(position, index).applyMatrix4(transform);
          mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
          const error = point.distanceTo(expected);
          maximum = Math.max(maximum, error);
          assert(
            error < (suffix === '.glb' ? 0.000002 : 0.00004),
            `${name}/${time}/${control.name}: actual rigid surface drift ${error} m`
          );
          vertices++;
        }
      }
    }
  }
  animation.update(0, 'reloadEmpty', 2.4, true, false, 0);
  const originalCover = animation.cover.quaternion.clone();
  const originalBelt = animation.bones.map((bone) => bone.scale.clone());
  const inspection = createWeaponInspection({ model, def: WEAPON_DEFS.lmg });
  const inspectionSkeletons = new Set();
  inspection.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const source = model.scene.getObjectByName(mesh.name);
    assert.notEqual(mesh, source, 'inspection owns independent ordinary/skinned objects');
    assert.notEqual(mesh.position, source.position, 'inspection owns independent transforms');
    assert.equal(mesh.geometry, source.geometry, 'inspection borrows geometry');
    assert.equal(mesh.material, source.material, 'inspection borrows finish');
    if (!mesh.isSkinnedMesh) return;
    assert(!skeletons.has(mesh.skeleton), 'inspection owns independent skeletons');
    assert.notEqual(
      mesh.skeleton.bones[0],
      source.skeleton.bones[0],
      'inspection owns independent bones'
    );
    mesh.skeleton.computeBoneTexture();
    inspectionSkeletons.add(mesh.skeleton);
  });
  let borrowedDisposals = 0;
  for (const material of model.materials)
    material.addEventListener('dispose', () => borrowedDisposals++);
  inspection.dispose();
  assert.equal(borrowedDisposals, 0, 'inspection must not dispose gameplay finishes');
  for (const skeleton of inspectionSkeletons) assert.equal(skeleton.boneTexture, null);
  assert(animation.cover.quaternion.equals(originalCover));
  animation.bones.forEach((bone, index) => assert(bone.scale.equals(originalBelt[index])));
  let released = 0;
  for (const skeleton of skeletons) {
    skeleton.computeBoneTexture();
    skeleton.boneTexture.addEventListener('dispose', () => released++);
  }
  animation.dispose();
  assert.equal(released, 1, 'release the independent belt bone texture once');
  for (const skeleton of skeletons) assert.equal(skeleton.boneTexture, null);
  assert.equal(model.materials.size, 0);
  console.log(
    `EVOLYS ${suffix}: ${poses} poses / ${vertices} actual rigid vertices; max control drift ${maximum} m; inspection and skeleton disposal passed`
  );
}
