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
  model.root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    skeletons.add(mesh.skeleton);
    if (mesh.skeleton.bones.some((bone) => bone.name === 'MECH_stock')) surfaces.push(mesh);
  });
  assert.equal(skeletons.size, 2, 'independent deforming belt and rigid mechanical skin');
  assert.equal(surfaces.length, 2, 'one opaque draw and one real transparent optical boundary');
  const ownership = new Map();
  const point = new THREE.Vector3();
  const expected = new THREE.Vector3();
  for (const mesh of surfaces) {
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    const members = new Map();
    for (let i = 0; i < position.count; i++) {
      assert.equal(skinWeight.getX(i), 1);
      assert.equal(skinWeight.getY(i) + skinWeight.getZ(i) + skinWeight.getW(i), 0);
      const joint = skinIndex.getX(i);
      const indices = members.get(joint) ?? [];
      indices.push(i);
      members.set(joint, indices);
    }
    for (const [joint, indices] of members) {
      const bone = mesh.skeleton.bones[joint];
      const control = model.root.getObjectByName(bone.name.slice('MECH_'.length));
      assert(control, `${bone.name}: original source control retained`);
      const rest = new THREE.Matrix4()
        .copy(control.matrixWorld)
        .invert()
        .multiply(bone.matrixWorld)
        .multiply(mesh.skeleton.boneInverses[joint])
        .multiply(mesh.bindMatrix);
      members.set(joint, { indices, control, rest });
    }
    ownership.set(mesh, members);
  }
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
        mesh.skeleton.update();
        for (const { indices, control, rest } of ownership.get(mesh).values()) {
          const transform = new THREE.Matrix4().multiplyMatrices(control.matrixWorld, rest);
          for (const index of indices) {
            expected
              .fromBufferAttribute(mesh.geometry.attributes.position, index)
              .applyMatrix4(transform);
            mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
            const error = point.distanceTo(expected);
            maximum = Math.max(maximum, error);
            assert(
              error < (suffix === '.glb' ? 0.000002 : 0.00004),
              `${name}/${time}/${control.name}: actual skin drift ${error} m`
            );
            vertices++;
          }
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
    if (!mesh.isSkinnedMesh) return;
    assert(!skeletons.has(mesh.skeleton), 'inspection owns independent skeletons');
    const source = model.scene.getObjectByName(mesh.name);
    assert.notEqual(
      mesh.skeleton.bones[0],
      source.skeleton.bones[0],
      'inspection owns independent bones'
    );
    assert.equal(mesh.geometry, source.geometry, 'inspection borrows geometry');
    assert.equal(mesh.material, source.material, 'inspection borrows finish');
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
  assert.equal(released, 2, 'release each unique belt/mechanical bone texture once');
  for (const skeleton of skeletons) assert.equal(skeleton.boneTexture, null);
  assert.equal(model.materials.size, 0);
  console.log(
    `EVOLYS ${suffix}: ${poses} poses / ${vertices} actual rigid vertices; max control drift ${maximum} m; inspection and skeleton disposal passed`
  );
}
