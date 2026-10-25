import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createWeaponAnimation } from '../../src/weapons/authored-animation.ts';
import { WEAPON_DEFS, WEAPON_IDS } from '../../src/weapons/defs.ts';
import { createWeaponInspection } from '../../src/weapons/inspection.ts';
import { loadWeapon } from '../../src/weapons/loaders.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

const original = GLTFLoader.prototype.loadAsync;
GLTFLoader.prototype.loadAsync = (url) => parseGLB(readFileSync(new URL(url)));
try {
  for (const id of WEAPON_IDS) {
    const model = await loadWeapon(id);
    const def = { ...WEAPON_DEFS[id], cycleTime: 60 / WEAPON_DEFS[id].rpm };
    const animation = createWeaponAnimation(model, def);
    // Inspect while the live gun is midway through an empty reload.
    animation.update(0, 'reloadEmpty', 0.8, true, false, 0);
    const snapshot = [];
    const resources = new Set([...model.materials, ...model.textures]);
    model.scene.traverse((node) => {
      snapshot.push([
        node,
        node.position.toArray(),
        node.quaternion.toArray(),
        node.scale.toArray(),
        node.visible,
      ]);
      if (node.isMesh) resources.add(node.geometry);
    });
    let disposals = 0;
    for (const resource of resources) resource.addEventListener('dispose', () => disposals++);
    const inspection = createWeaponInspection({ model, def });
    assert.notEqual(inspection.scene, model.scene);
    assert.notEqual(inspection.scene.getObjectByName(model.root.name), model.root);
    const liveMeshes = [];
    const previewMeshes = [];
    model.scene.traverse((node) => {
      if (node.isMesh) liveMeshes.push(node);
    });
    inspection.scene.traverse((node) => {
      if (node.isMesh) previewMeshes.push(node);
    });
    for (let i = 0; i < liveMeshes.length; i++) {
      assert.notEqual(previewMeshes[i], liveMeshes[i]);
      assert.equal(previewMeshes[i].geometry, liveMeshes[i].geometry);
      assert.equal(previewMeshes[i].material, liveMeshes[i].material);
      if (liveMeshes[i].isSkinnedMesh)
        assert.notEqual(previewMeshes[i].skeleton, liveMeshes[i].skeleton);
    }
    let objectDisposals = 0;
    let liveObjectDisposals = 0;
    for (const mesh of previewMeshes) mesh.addEventListener('dispose', () => objectDisposals++);
    for (const mesh of liveMeshes) mesh.addEventListener('dispose', () => liveObjectDisposals++);
    inspection.scene.position.set(9, 8, 7);
    inspection.dispose();
    assert.equal(objectDisposals, previewMeshes.length, id + ' releases every cloned mesh');
    assert.equal(liveObjectDisposals, 0, id + ' never disposes gameplay objects');
    for (const [node, position, quaternion, scale, visible] of snapshot) {
      assert.deepEqual(node.position.toArray(), position, id + ' live position');
      assert.deepEqual(node.quaternion.toArray(), quaternion, id + ' live orientation');
      assert.deepEqual(node.scale.toArray(), scale, id + ' live scale');
      assert.equal(node.visible, visible, id + ' live visibility');
    }
    assert.equal(disposals, 0, id + ' inspection never disposes borrowed gameplay resources');
    assert(model.materials.size > 0);
    animation.dispose();
    for (const mesh of liveMeshes) mesh.geometry.dispose();
  }
} finally {
  GLTFLoader.prototype.loadAsync = original;
}
console.log('Seven market inspections preserve gameplay poses and borrowed resource ownership.');
