// The real Viewmodel must retain its native-converted radio screen. A small
// canvas recorder checks the labels drawn by radioScreenTexture without a GPU.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Rng } from '../../src/core/rng.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';

const originalDocument = globalThis.document;
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const labels = [];
    return { width: 0, height: 0, labels, getContext(kind) {
      assert.equal(kind, '2d');
      return { fillRect() {}, fillText(text) { labels.push(text); } };
    } };
  },
};

function makeViewmodel() {
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.004, 60);
  return new Viewmodel({ camera, viewCamera: camera, viewScene: new THREE.Scene(), rng: new Rng(704) }, {
    get: () => new THREE.MeshStandardMaterial(),
    reticle: () => new THREE.MeshBasicMaterial(),
    reticleOutline: () => new THREE.MeshBasicMaterial(),
  });
}

const viewmodels = [];
try {
  const vm = makeViewmodel();
  viewmodels.push(vm);
  const screen = vm.radio.userData.screen;
  assert(screen.material instanceof MeshPhysicalNodeMaterial, 'screen uses the converted native physical material');
  assert(vm.radioScreen === screen, 'Viewmodel retains the converted screen');
  const material = screen.material;
  const initial = material.map;
  assert(initial instanceof THREE.CanvasTexture);
  assert(initial.image.labels.includes('x1'), 'initial screen shows one charge');

  const other = makeViewmodel();
  viewmodels.push(other);
  const otherMaterial = other.radioScreen.material;
  const otherMap = otherMaterial.map;
  assert.notEqual(otherMaterial, material, 'converted materials are instance-owned');
  assert.notEqual(otherMap, initial, 'initial screen textures are instance-owned');

  for (const [count, label] of [[1, 'x1'], [0, 'NO CHG'], [2, 'x2']]) {
    const previous = material.map;
    let disposals = 0;
    previous.addEventListener('dispose', () => {
      disposals++;
      assert.notEqual(material.map, previous, 'replacement is installed before the old texture is disposed');
    });
    vm.setRadioScreen(count);
    assert.equal(vm.radioScreen, screen, 'updates retain the same screen');
    assert.equal(screen.material, material, 'updates retain the converted material');
    assert.notEqual(material.map, previous, `count ${count} replaces the texture`);
    assert(material.map instanceof THREE.CanvasTexture);
    assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
    assert.equal(material.map.anisotropy, 4);
    assert.equal(material.map.image.labels.find(text => /^x\d+$|^NO CHG$/.test(text)), label,
      `count ${count} draws the correct display label`);
    assert.equal(disposals, 1, 'old texture is disposed exactly once');
    assert.equal(otherMaterial.map, otherMap, 'updates do not change another Viewmodel screen');
    assert(otherMap.image.labels.includes('x1'));
  }
  console.log('Radio screen checks passed: retained native material, counts 1 -> 0 -> 2, instance ownership and texture replacement/disposal');
} finally {
  for (const vm of viewmodels) {
    vm.radio.userData.screen.material.map.dispose();
    vm.dispose();
  }
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
