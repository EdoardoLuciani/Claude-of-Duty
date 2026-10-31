// Ordinary geometry follows retained authored controls without unnecessary skins.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { AX338Animation, makeAX338Model } from '../../src/weapons/ax338.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { createWeaponInspection } from '../../src/weapons/inspection.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';
import { ax338GeometryControl } from './ax338-geometry.mjs';

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
    partTriangles = new Map();
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
    assert(!mesh.isSkinnedMesh, 'no unnecessary weapon skeleton or skin attributes');
    assert(!mesh.geometry.attributes.skinIndex && !mesh.geometry.attributes.skinWeight);
    const helper = ax338GeometryControl(mesh);
    if (!helper) return;
    parts.add(helper.name);
    partTriangles.set(
      helper.name,
      (partTriangles.get(helper.name) ?? 0) + mesh.geometry.index.count / 3
    );
    const { position } = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      const local = mesh
        .getVertexPosition(i, new THREE.Vector3())
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(helper.matrixWorld.clone().invert());
      const vertex = { mesh, index: i, helper, local };
      vertices.push(vertex);
      if (i % 251 === 0) dense.push(vertex);
    }
  });
  assert.equal(draws, 11, 'six natural parts + lens + two magazine bodies + two rounds');
  assert.equal(visibleDraws, 9, 'loaded Idle excludes the spare body and rounds');
  assert.deepEqual([...parts].sort(), [
    'bolt',
    'handguard',
    'optic',
    'receiver',
    'stock',
    'trigger',
  ]);
  assert.deepEqual(
    Object.fromEntries([...partTriangles].sort()),
    {
      bolt: 3024,
      handguard: 30958,
      optic: 26319,
      receiver: 16828,
      stock: product === 'ax338.glb' ? 17828 : 17764,
      trigger: 380,
    },
    'actual per-control geometry, not a vertex-count target'
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
        assert(error < 0.000001, `${product}/${clip.name}/${time}: real mesh/control gap ${error}`);
        probes++;
      }
      for (const control of animation.rotationControls)
        assert(Math.abs(control.quaternion.length() - 1) < 1e-12, 'unit sampled rotation');
    }
    // Every gesture can be interrupted/reset without a stale bolt/trigger.
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

  // Market clones borrow resources, own transforms and never mutate live pose.
  animation.update(0, 'cycle', 0.4, false);
  const snapshot = animation.bolt.position.clone();
  const inspection = createWeaponInspection({ model, def: WEAPON_DEFS.sniper });
  const previewBolt = inspection.scene.getObjectByName('bolt');
  assert.notEqual(previewBolt, animation.bolt);
  assert(previewBolt.position.distanceTo(new THREE.Vector3(0, 0.075, 0.05)) < 0.000001);
  assert(
    previewBolt.quaternion.angleTo(new THREE.Quaternion()) < 0.000001,
    'inspection is canonical Idle even while gameplay cycles'
  );
  let previewMeshes = 0,
    geometryDisposals = 0,
    materialDisposals = 0,
    textureDisposals = 0;
  const geometries = new Set();
  inspection.scene.traverse((mesh) => {
    assert(!mesh.isSkinnedMesh, 'inspection also needs no weapon skeleton');
    if (!mesh.isMesh) return;
    previewMeshes++;
    const live = model.scene.getObjectByName(mesh.name);
    assert.notEqual(mesh, live);
    assert.equal(mesh.geometry, live.geometry);
    assert.equal(mesh.material, live.material);
    geometries.add(mesh.geometry);
  });
  assert.equal(previewMeshes, draws);
  for (const geometry of geometries)
    geometry.addEventListener('dispose', () => geometryDisposals++);
  const materialCount = model.materials.size,
    textureCount = model.textures.size;
  for (const material of model.materials)
    material.addEventListener('dispose', () => materialDisposals++);
  for (const texture of model.textures)
    texture.addEventListener('dispose', () => textureDisposals++);
  inspection.dispose();
  assert.equal(geometryDisposals, 0, 'inspection borrows geometry');
  assert.equal(materialDisposals, 0, 'inspection borrows materials');
  assert.equal(textureDisposals, 0, 'inspection borrows textures');
  assert(animation.bolt.position.equals(snapshot), 'inspection never changes gameplay controls');
  animation.dispose();
  assert.equal(geometryDisposals, 0, 'adapter does not own cached geometry');
  assert.equal(materialDisposals, materialCount, 'adapter releases owned materials');
  assert.equal(textureDisposals, textureCount, 'adapter releases owned map clones');
  assert.equal(model.materials.size, 0);
  assert.equal(model.textures.size, 0);
}
console.log(
  `AX338 ordinary meshes: ${poses} half-frame poses / ${probes} actual vertex probes, maximum control gap ${maximumError} m; eleven draws/nine Idle, real drop geometry, interruptions and borrowed inspection resources/owned material disposal passed`
);
