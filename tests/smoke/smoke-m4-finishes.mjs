import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { convertWeaponScene, disposeWeaponMaterials } from '../../src/weapons/asset-material.ts';
import { batchM4Finishes } from '../../src/weapons/m4-finishes.ts';
import { makeM4Model, M4_URL } from '../../src/weapons/m4.ts';
import { parseM4 } from './m4-fixture.mjs';

const bytes = readFileSync(new URL(M4_URL));
const gltf = await parseM4(bytes);
const parts = ['receiver_mesh', 'handguard_mesh', 'stock_mesh'];
const original = new Map(
  parts.map((name) => [name, [...gltf.scene.getObjectByName(name).children]])
);
const untouched = new Map();
gltf.scene.traverse((o) => {
  if (!parts.some((name) => o.parent?.name === name)) untouched.set(o, o.parent);
});
const model = makeM4Model(gltf);
const close = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} ~= ${b}`);
for (const [name, primitives] of original) {
  const part = model.scene.getObjectByName(name);
  const meshes = part.children.filter((o) => o.isMesh);
  assert.equal(meshes.length, 1, `${name}: ${primitives.length} -> 1`);
  const mesh = meshes[0],
    g = mesh.geometry;
  assert(!Array.isArray(mesh.material), 'one material, not group draws');
  assert.equal(g.groups.length, 0);
  assert.equal(
    g.index.count,
    primitives.reduce((sum, p) => sum + p.geometry.index.count, 0)
  );
  const albedos = [...new Set(primitives.map((p) => p.material.map))];
  assert.equal(albedos.length, name === 'receiver_mesh' ? 2 : 1, 'reuse shared maps');
  let offset = 0;
  for (const primitive of primitives) {
    const source = primitive.geometry,
      finish = primitive.material;
    const marker = model.scene.getObjectByName(primitive.name);
    assert(
      marker && !marker.isMesh,
      'primitive names remain discoverable without hidden mesh draws'
    );
    assert.deepEqual(marker.matrix, primitive.matrix);
    // Compare every rendered corner, not just bounding boxes or aggregate counts.
    for (let i = 0; i < source.index.count; i++) {
      const before = source.index.getX(i),
        after = g.index.getX(offset++);
      for (const field of ['position', 'normal', 'uv']) {
        const a = source.attributes[field],
          b = g.attributes[field];
        for (let c = 0; c < a.itemSize; c++)
          assert.equal(a.getComponent(before, c), b.getComponent(after, c));
      }
      for (const [c, value] of finish.color.toArray().entries())
        close(g.attributes.weaponColor.getComponent(after, c), value);
      for (const [c, value] of [
        finish.roughness,
        finish.metalness,
        finish.normalScale.x,
        finish.normalScale.y,
      ].entries())
        close(g.attributes.weaponFinish.getComponent(after, c), value);
      assert.equal(g.attributes.weaponAlbedo.getX(after), albedos.indexOf(finish.map));
    }
  }
  assert(mesh.material.isMeshPhysicalNodeMaterial);
  for (const field of [
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'specularIntensity',
    'specularColor',
    'ior',
    'emissive',
    'side',
  ])
    assert.deepEqual(mesh.material[field], primitives[0].material[field], `preserve ${field}`);
  const clone = mesh.material.clone();
  assert.equal(clone.customProgramCacheKey(), mesh.material.customProgramCacheKey());
  for (const field of ['colorNode', 'roughnessNode', 'metalnessNode', 'normalNode'])
    assert.equal(clone[field], mesh.material[field], `native clone retains ${field}`);
  clone.dispose();
}
const retained = new Set();
model.scene.traverse((object) => retained.add(object));
for (const [object, parent] of untouched) {
  assert(retained.has(object), `${object.name}: independent node identity`);
  assert.equal(object.parent, parent, `${object.name}: independent hierarchy`);
}
assert.equal(model.textures.size, 4, 'no duplicated images or generated finish maps');
const disposals = new Map([...model.materials, ...model.textures].map((resource) => [resource, 0]));
for (const resource of disposals.keys())
  resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
disposeWeaponMaterials(model);
assert([...disposals.values()].every((count) => count === 1));

// A shared accessor contains poisoned unused vertices at both ends. The merged
// geometry must slice the used index range instead of copying the whole accessor.
function fixture() {
  const scene = new THREE.Group(),
    part = new THREE.Group();
  part.name = 'receiver_mesh';
  scene.add(part);
  const shared = new THREE.BufferGeometry();
  shared.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [999, 999, 999, 0, 0, 0, 1, 0, 0, 0, 1, 0, -999, -999, -999],
      3
    )
  );
  shared.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(15).fill(1), 3));
  shared.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(10), 2));
  shared.setIndex([1, 2, 3]);
  const source = new THREE.MeshPhysicalMaterial({ color: 0x334455, specularIntensity: 0.37 });
  for (let i = 0; i < 2; i++) {
    const m = source.clone();
    m.roughness = 0.2 + i * 0.6;
    const mesh = new THREE.Mesh(shared, m);
    mesh.name = `primitive-${i}`;
    part.add(mesh);
  }
  const owned = convertWeaponScene(scene);
  return { scene, part, owned };
}
{
  const { scene, part, owned } = fixture();
  let borrowedDisposals = 0;
  part.children[0].geometry.addEventListener('dispose', () => borrowedDisposals++);
  batchM4Finishes(scene, owned);
  const mesh = part.children.find((o) => o.isMesh);
  assert.equal(mesh.geometry.attributes.position.count, 6);
  assert.equal(mesh.geometry.index.count, 6);
  mesh.geometry.computeBoundingBox();
  assert.deepEqual(mesh.geometry.boundingBox.min.toArray(), [0, 0, 0]);
  assert.deepEqual(mesh.geometry.boundingBox.max.toArray(), [1, 1, 0]);
  assert.equal(mesh.material.specularIntensity, 0.37);
  assert.equal(borrowedDisposals, 0, 'do not dispose loader-owned shared geometry');
  disposeWeaponMaterials(owned);
}
{
  const { scene, part, owned } = fixture();
  const maps = [new THREE.Texture(), new THREE.Texture()];
  maps[0].offset.set(0.17, 0.31);
  maps[1].repeat.set(3, 7);
  maps[1].rotation = 0.37;
  const normal = new THREE.Texture();
  normal.format = THREE.RGFormat;
  normal.offset.x = 0.42;
  part.children.forEach((mesh, i) => {
    mesh.material.map = maps[i];
    mesh.material.normalMap = normal;
  });
  const transforms = maps.map((map) => [map.offset.toArray(), map.repeat.toArray(), map.rotation]);
  batchM4Finishes(scene, owned);
  const mesh = part.children.find((o) => o.isMesh);
  assert.equal(mesh.material.normalNode.unpackNormalMode, THREE.NormalRGPacking);
  const sampled = new Set();
  mesh.material.colorNode.traverse((node) => {
    if (node.isTextureNode) sampled.add(node.value);
  });
  assert.deepEqual(
    sampled,
    new Set(maps),
    'borrow both authored albedos, not a flattened replacement'
  );
  assert.deepEqual(
    maps.map((map) => [map.offset.toArray(), map.repeat.toArray(), map.rotation]),
    transforms
  );
  assert.equal(mesh.material.normalMap, normal);
  assert.equal(normal.offset.x, 0.42);
  disposeWeaponMaterials(owned);
  for (const map of [...maps, normal]) map.dispose();
}
for (const [label, mutate] of [
  ['physical specular', (mesh) => (mesh.material.specularIntensity = 0.4)],
  ['emission', (mesh) => mesh.material.emissive.setRGB(1, 0, 0)],
  ['optics', (mesh) => (mesh.material.transparent = true)],
  ['alpha hash', (mesh) => (mesh.material.alphaHash = true)],
  [
    'normal UV transform',
    (mesh) => {
      mesh.material.normalMap = new THREE.Texture();
      mesh.material.normalMap.offset.x = 0.2;
    },
  ],
  ['independent transform', (mesh) => (mesh.position.x = 0.01)],
  ['visibility', (mesh) => (mesh.visible = false)],
]) {
  const { scene, part, owned } = fixture();
  const children = [...part.children];
  mutate(children[1]);
  batchM4Finishes(scene, owned);
  assert.deepEqual(part.children, children, `${label}: incompatible authoring remains untouched`);
  disposeWeaponMaterials(owned);
}
console.log(
  'M4 actual receiver 5->1, handguard 2->1, stock 3->1; all indexed corners/UVs/finishes, names, borrowed maps, physical clone/disposal, accessor slicing and compatibility exclusions passed'
);
