// Actual decoded native/runtime geometry, mechanical skin and adapter parity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import manifest from '../../assets/weapons/mcx-virtus/manifest.json' with { type: 'json' };
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { makeMCXModel, MCXAnimation } from '../../src/weapons/mcx.ts';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const directory = new URL('../../assets/weapons/mcx-virtus/', import.meta.url);
const sources = [];
const position = new THREE.Vector3();
const expected = new THREE.Vector3();
let maximumSkinDeviation = 0;
for (const filename of ['mcx-virtus.glb', 'mcx-virtus.runtime.glb']) {
  const bytes = readFileSync(new URL(filename, directory));
  const { json } = inspectGLB(bytes);
  if (filename.includes('.runtime.')) {
    assert.ok(json.extensionsRequired.includes('EXT_meshopt_compression'));
    assert.ok(json.extensionsRequired.includes('KHR_texture_basisu'));
    assert.ok(bytes.length < 3_300_000, 'bounded runtime size');
  }
  const gltf = await parseGLB(bytes);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  function pose(name, time) {
    mixer.stopAllAction();
    const action = mixer.clipAction(gltf.animations.find((clip) => clip.name === name));
    action.reset().setLoop(THREE.LoopOnce, 1).play();
    action.clampWhenFinished = true;
    action.time = Math.fround(time);
    mixer.update(0);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((mesh) => {
      if (mesh.isSkinnedMesh) mesh.skeleton.update();
    });
  }
  pose('Idle', 0);
  const vertices = [];
  const parts = new Set();
  gltf.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const { position: positions, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < positions.count; i++) {
      assert.equal(skinWeight.getX(i), 1, 'one complete rigid influence');
      assert.equal(skinWeight.getY(i) + skinWeight.getZ(i) + skinWeight.getW(i), 0);
      const name = mesh.skeleton.bones[skinIndex.getX(i)].name;
      assert.ok(name.startsWith('MECH_'));
      const helper = gltf.scene.getObjectByName(name.slice(5));
      assert.ok(helper, `${name}: retained animated runtime helper`);
      parts.add(helper.name);
      const local = mesh
        .getVertexPosition(i, new THREE.Vector3())
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(helper.matrixWorld.clone().invert());
      vertices.push({ mesh, index: i, helper, local });
    }
  });
  assert.deepEqual([...parts].sort(), [
    'bolt',
    'bolt_release',
    'charging_handle',
    'dust_cover',
    'receiver',
    'stock_hinge',
    'trigger',
  ]);
  assert.ok(vertices.length > 30_000, 'actual bound mechanical surfaces');
  for (const clip of gltf.animations) {
    assert.ok(Math.abs(clip.duration - manifest.clips[clip.name].duration) < 1e-5);
    for (const time of [0, 2 / 60, 4.5 / 60, 0.5, 1, 1.475, 2.417, clip.duration]) {
      pose(clip.name, Math.min(time, clip.duration));
      for (const { mesh, index, helper, local } of vertices) {
        mesh.getVertexPosition(index, position).applyMatrix4(mesh.matrixWorld);
        expected.copy(local).applyMatrix4(helper.matrixWorld);
        const error = position.distanceTo(expected);
        maximumSkinDeviation = Math.max(maximumSkinDeviation, error);
        assert.ok(error < 0.00004, `${filename}/${clip.name}: skin follows helper within 40µm`);
      }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  const model = makeMCXModel(gltf);
  const animation = new MCXAnimation(model, WEAPON_DEFS.mcx);
  sources.push({ model, animation });
}

let maximumContactDeviation = 0;
let maximumContactAngle = 0;
for (const clip of ['reloadTac', 'reloadEmpty', 'inspect']) {
  const duration = clip === 'reloadTac' ? 2.6 : clip === 'reloadEmpty' ? 3.3 : 4;
  for (let frame = 0; frame <= duration * 120; frame++) {
    const time = Math.min(frame / 120, duration);
    const contacts = sources.map(({ model, animation }) => {
      animation.update(0, clip, time, false);
      const pos = new THREE.Vector3(...model.nodes.gripL.pos);
      const quat = new THREE.Quaternion();
      animation.handTarget('left', pos, quat);
      return { pos, quat: quat.normalize() };
    });
    maximumContactDeviation = Math.max(
      maximumContactDeviation,
      contacts[0].pos.distanceTo(contacts[1].pos)
    );
    maximumContactAngle = Math.max(maximumContactAngle, contacts[0].quat.angleTo(contacts[1].quat));
  }
}
assert.ok(maximumContactDeviation < 0.00004, 'native/runtime wrist contact within 40µm');
assert.ok(maximumContactAngle < 0.0002, 'native/runtime wrist orientation within 0.012 degrees');
for (const { model, animation } of sources) {
  const mag = model.root.getObjectByName('magazine');
  const spare = model.root.getObjectByName('magazine_spare');
  for (const clip of ['reloadTac', 'reloadEmpty']) {
    const end = clip === 'reloadTac' ? 2.6 : 3.3;
    for (const [time, oldVisible, newVisible] of [
      [63 / 60 - 1 / 120, true, false],
      [63 / 60, false, false],
      [64 / 60, false, true],
      [end - 1 / 120, false, true],
      [end, true, false],
    ]) {
      animation.update(0, clip, time, false);
      assert.equal(mag.visible, oldVisible, `${clip}/${time}: old magazine STEP`);
      assert.equal(spare.visible, newVisible, `${clip}/${time}: spare magazine STEP`);
      for (const part of [mag, spare]) {
        let triangles = 0;
        part.traverse((mesh) => {
          assert.ok(!mesh.isSkinnedMesh, 'detachable parts must not borrow mechanical skeleton');
          if (mesh.isMesh) triangles += mesh.geometry.index.count / 3;
        });
        assert.ok(triangles > 1000, 'detachable magazine owns real independent geometry');
      }
    }
    // Interrupt either reload while a replacement is visible; reset must not
    // retain its pose, visibility or locked-open bolt on the next clip.
    animation.update(0, clip, 1.4, true);
    animation.reset();
    assert.equal(mag.visible, true);
    assert.equal(spare.visible, false);
  }
  function boltVertex() {
    model.scene.updateMatrixWorld(true);
    const inverseRoot = model.root.matrixWorld.clone().invert();
    let point;
    model.scene.traverse((mesh) => {
      if (!mesh.isSkinnedMesh || point) return;
      mesh.skeleton.update();
      const joint = mesh.skeleton.bones.findIndex((bone) => bone.name === 'MECH_bolt');
      const indices = mesh.geometry.attributes.skinIndex;
      for (let i = 0; i < indices.count; i++) {
        if (indices.getX(i) !== joint) continue;
        point = mesh
          .getVertexPosition(i, new THREE.Vector3())
          .applyMatrix4(mesh.matrixWorld)
          .applyMatrix4(inverseRoot);
        break;
      }
    });
    assert.ok(point, 'visible bolt surface is bound to bolt bone');
    return point;
  }
  animation.reset();
  const closedBolt = boltVertex();
  animation.update(0, '', 0, true);
  assert.ok(
    boltVertex()
      .sub(closedBolt)
      .distanceTo(new THREE.Vector3(-0.068, 0, 0)) < 1e-6,
    'empty state retracts actual bolt vertices by 68 mm'
  );
  assert.equal(animation.bolt.position.x, -0.068);
  assert.equal(
    animation.boltBone.position.x,
    -0.068,
    'empty bolt moves actual skin, not just helper'
  );
  animation.reset();
  assert.ok(Math.abs(animation.boltBone.position.x) < 1e-6);
  animation.fire();
  animation.update(0, '', 0, false);
  assert.equal(
    model.root.getObjectByName('spent_case').visible,
    false,
    'live casing remains FX-owned'
  );
  const skeletons = new Set();
  model.root.traverse((mesh) => {
    if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
  });
  let boneTextureDisposals = 0;
  for (const skeleton of skeletons) {
    skeleton.computeBoneTexture();
    skeleton.boneTexture.addEventListener('dispose', () => {
      boneTextureDisposals++;
    });
  }
  animation.dispose();
  assert.equal(
    boneTextureDisposals,
    skeletons.size,
    'mechanical skin bone textures are owned and released'
  );
  assert([...skeletons].every((skeleton) => skeleton.boneTexture === null));
}
console.log(
  `MCX decoded: skin error ${maximumSkinDeviation * 1000} mm; contact error ${maximumContactDeviation * 1000} mm / ${maximumContactAngle} rad; native/runtime reload STEP, interruptions and empty bolt verified`
);
