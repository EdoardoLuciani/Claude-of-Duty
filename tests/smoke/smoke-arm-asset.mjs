import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Supply Vite's BASE_URL in Node without replacing the production conversion.
const assetURL = new URL('../../src/weapons/arm-asset.ts', import.meta.url);
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url !== assetURL.href) return nextLoad(url, context);
    return {
      format: 'module',
      shortCircuit: true,
      source:
        "import.meta.env = { BASE_URL: '' };\n" +
        stripTypeScriptTypes(readFileSync(assetURL, 'utf8')),
    };
  },
});
const { loadArmAsset } = await import(assetURL.href);
const { Arm } = await import('../../src/weapons/hands.ts');
hooks.deregister();
const bytes = readFileSync(new URL('../../public/models/player/arms.glb', import.meta.url));
const loader = new GLTFLoader().register(() => ({
  name: 'NODE_TEXTURE_STUB',
  loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const originalLoad = GLTFLoader.prototype.loadAsync;
for (const grouped of [false, true]) {
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  );
  const sources = [];
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh) sources.push(o);
  });
  assert.equal(sources.length, 5, 'committed arms have five separate material primitives');
  assert.ok(sources.every((m) => !Array.isArray(m.material) && m.geometry.groups.length === 0));
  if (grouped) {
    const mesh = sources[0],
      split = Math.floor(mesh.geometry.index.count / 6) * 3;
    mesh.material = [mesh.material, mesh.material.clone()];
    mesh.geometry.addGroup(0, split, 0);
    mesh.geometry.addGroup(split, mesh.geometry.index.count - split, 1);
  }
  const groups = sources.map((m) => m.geometry.groups.map((g) => ({ ...g })));
  GLTFLoader.prototype.loadAsync = async (url) => {
    assert.equal(url, 'models/player/arms.glb');
    return gltf;
  };
  let asset;
  try {
    asset = await loadArmAsset();
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoad;
  }
  try {
    for (const [i, mesh] of asset.meshes.entries()) {
      assert.equal(
        Array.isArray(mesh.material),
        grouped && i === 0,
        `${mesh.name}: preserve single/grouped material shape`
      );
      assert.deepEqual(
        mesh.geometry.groups,
        groups[i],
        'conversion preserves geometry submission groups'
      );
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      assert.equal(materials.length, grouped && i === 0 ? 2 : 1);
      assert.ok(
        materials.every((m) => m.isNodeMaterial),
        'actual loader converts authored materials to native materials'
      );
    }
    for (const side of [-1, 1]) {
      const arm = new Arm(side);
      try {
        arm.attachAsset(asset);
        assert.equal(arm.skins.length, 5);
        for (const [i, skin] of arm.skins.entries()) {
          assert.equal(
            skin.material,
            asset.meshes[i].material,
            'rebinding borrows converted materials without changing their shape'
          );
          assert.deepEqual(skin.geometry.groups, groups[i]);
          assert.notEqual(
            skin.geometry,
            asset.meshes[i].geometry,
            'each arm owns its bound geometry'
          );
        }
      } finally {
        arm.dispose();
      }
    }
  } finally {
    asset.dispose();
  }
}
console.log(
  'arm-asset: actual GLB loader preserves five single-material primitives and grouped arrays through both arm bindings'
);
