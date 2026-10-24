import assert from 'node:assert/strict';

import * as THREE from 'three/webgpu';

import {
  buildSoldier,
  MATERIAL_SLOTS,
  prepareSoldierSurfaces,
  VARIANTS,
} from '../../src/ai/soldier.ts';
import { soldierTextureArray } from '../../src/ai/texture-array.ts';
import { SoldierMaterialsNode } from '../../src/ai/textures-tsl.ts';
import { Rng } from '../../src/core/rng.ts';

const placeholder = new THREE.MeshStandardMaterial();
const library = new SoldierMaterialsNode({}, {});
const names = [
  'camo_arid',
  'camo_urban',
  'camo_woodland',
  'nylon',
  'plate',
  'skin',
  'polymer',
  'steel',
  'rubber',
  'glass',
];
library.layers = new Map(names.map((name, i) => [name, i]));
library.arrays = Object.fromEntries(
  ['albedo', 'normal', 'orm', 'detail'].map((name) => [
    name,
    new THREE.DataArrayTexture(new Uint8Array(40), 1, 1, 10),
  ])
);
let disposedArrays = 0,
  disposedMaterials = 0,
  disposedTables = 0;
for (const array of Object.values(library.arrays))
  array.addEventListener('dispose', () => disposedArrays++);
for (const name of Object.keys(VARIANTS)) {
  const built = buildSoldier(name, {
    rng: new Rng(123),
    materials: { get: () => placeholder, glass: () => placeholder },
  });
  const g = built.geometry,
    index = g.index,
    groups = g.groups.map((group) => ({ ...group }));
  const inputs = Object.entries(g.attributes);
  prepareSoldierSurfaces(g);
  const labels = g.getAttribute('soldierSurface');
  assert.equal(labels.count, g.getAttribute('position').count);
  for (const [key, value] of inputs) assert.equal(g.getAttribute(key), value, `preserve ${key}`);
  assert.equal(g.index, index);
  assert.deepEqual(g.groups, groups, 'authoring groups remain available to model validation');
  for (let slot = 0; slot < groups.length; slot++) {
    const group = groups[slot];
    for (let i = group.start; i < group.start + group.count; i++)
      assert.equal(labels.getX(index.getX(i)), slot);
  }
  prepareSoldierSurfaces(g);
  assert.equal(g.getAttribute('soldierSurface'), labels, 'prepare once per loaded geometry');
  const material = library.soldier(name, built.slots);
  assert.equal(library.soldier(name, built.slots), material, 'share one material per variant');
  const mesh = new THREE.SkinnedMesh(g, material);
  assert.equal(
    Array.isArray(mesh.material),
    false,
    'native single-material path ignores draw splitting'
  );
  assert(
    material.colorNode && material.normalNode && material.roughnessNode && material.metalnessNode
  );
  assert.equal(material.transparent, false);
  assert.equal(material.alphaTest, 0);
  assert.equal(material.side, THREE.FrontSide);
  const clone = material.clone();
  assert.equal(clone.rimNode, material.rimNode);
  assert.equal(clone.normalNode, material.normalNode);
  clone.dispose();
  material.addEventListener('dispose', () => disposedMaterials++);
  const table = library.surfaceTables.at(-1);
  table.addEventListener('dispose', () => disposedTables++);
  assert.equal(table.type, THREE.FloatType);
  assert.equal(table.minFilter, THREE.NearestFilter);
  assert.equal(table.generateMipmaps, false);
  const values = table.image.data,
    n = built.slots.length;
  const base = (slot) =>
    values.subarray((n + built.slots.indexOf(slot)) * 4, (n + built.slots.indexOf(slot) + 1) * 4);
  assert.notEqual(base('gear')[0], base('boot')[0], 'boots retain their smoother finish');
  assert.equal(base('glass')[1], 0, 'goggles remain dielectric');
  assert.equal(base('glass')[3], 0, 'goggles use geometric normals');
  assert(Math.abs(base('skin')[2] - 0.6) < 1e-6, 'skin retains its AO factor');
  assert.equal(built.slots.join(), MATERIAL_SLOTS.join());
  g.dispose();
}
library.dispose();
assert.equal(disposedMaterials, 3);
assert.equal(disposedTables, 3);
assert.equal(disposedArrays, 4);
placeholder.dispose();

const bad = new THREE.BufferGeometry();
bad.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
bad.setIndex([0, 1, 2, 0, 2, 3]);
bad.addGroup(0, 3, 0);
bad.addGroup(3, 3, 1);
assert.throws(() => prepareSoldierSurfaces(bad), /must not share vertices/);
assert.equal(bad.hasAttribute('soldierSurface'), false);
bad.dispose();

// Exercise packing/filtering without a browser; no rendered pixel-diff gate.
const original = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = class {
  getContext() {
    let image;
    return {
      clearRect() {},
      drawImage(value) {
        image = value;
      },
      getImageData() {
        return { data: new Uint8Array(image.width * image.height * 4).fill(255) };
      },
    };
  }
};
try {
  const map = new THREE.Texture({ width: 2, height: 2 });
  const packed = soldierTextureArray([map, null], [128, 128, 255, 255], true, 8);
  assert.equal(packed.image.depth, 2);
  assert.equal(packed.image.data.length, 32);
  assert.equal(packed.colorSpace, THREE.SRGBColorSpace);
  assert.equal(packed.wrapS, THREE.RepeatWrapping);
  assert.equal(packed.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(packed.generateMipmaps, true);
  assert.equal(packed.anisotropy, 8);
  assert.throws(
    () =>
      soldierTextureArray(
        [map, new THREE.Texture({ width: 1, height: 1 })],
        [0, 0, 0, 255],
        false,
        8
      ),
    /matching dimensions/
  );
  packed.dispose();
  map.dispose();
} finally {
  globalThis.OffscreenCanvas = original;
}
console.log(
  'Soldier single-material surfaces, preserved skin/UV/index data, finishes, filtering and owned disposal passed'
);
