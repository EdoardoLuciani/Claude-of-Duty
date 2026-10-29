import assert from 'node:assert/strict';

import * as THREE from 'three';

import { convertWeaponScene, disposeWeaponMaterials } from '../../src/weapons/asset-material.ts';

let closes = 0;
const source = new THREE.Texture({
  width: 4,
  height: 4,
  close() {
    closes++;
  },
});
source.channel = 1;
const scene = new THREE.Group();
const geometry = new THREE.BoxGeometry();
function add(texture) {
  const material = new THREE.MeshStandardMaterial({
    roughnessMap: texture,
    metalnessMap: texture.clone(),
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  return mesh;
}
const first = add(source.clone()),
  second = add(source.clone());
const distinct = [
  (texture) => {
    texture.channel = 0;
  },
  (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
  },
  (texture) => {
    texture.offset.set(0.25, 0);
  },
  (texture) => {
    texture.repeat.set(2, 1);
  },
  (texture) => {
    texture.rotation = 0.5;
  },
  (texture) => {
    texture.wrapS = THREE.RepeatWrapping;
  },
  (texture) => {
    texture.minFilter = THREE.NearestFilter;
  },
  (texture) => {
    texture.anisotropy = 4;
  },
  (texture) => {
    texture.flipY = false;
  },
].map((change) => {
  const texture = source.clone();
  change(texture);
  return add(texture);
});
const model = convertWeaponScene(scene);
assert.equal(
  first.material.roughnessMap,
  first.material.metalnessMap,
  'share equivalent UV1 role clones'
);
assert.equal(
  first.material.roughnessMap,
  second.material.roughnessMap,
  'share across compatible finishes'
);
assert.equal(
  model.textures.size,
  1 + distinct.length,
  'one texture per distinct source/sampling state'
);
for (const mesh of distinct) {
  assert.notEqual(
    mesh.material.roughnessMap,
    first.material.roughnessMap,
    'different sampling state stays independent'
  );
  assert.equal(mesh.material.roughnessMap, mesh.material.metalnessMap);
}
const disposals = new Map([...model.textures].map((texture) => [texture, 0]));
for (const texture of model.textures)
  texture.addEventListener('dispose', () => disposals.set(texture, disposals.get(texture) + 1));
disposeWeaponMaterials(model);
assert([...disposals.values()].every((count) => count === 1));
assert.equal(closes, 1, 'aliased decoded image closes once');
geometry.dispose();
console.log(
  'Weapon textures: share identical UV1 maps, preserve distinct sampling states and dispose shared images once'
);
