import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

// Decode real embedded pixels; only the browser canvas transport is replaced.
const previousCanvas = globalThis.OffscreenCanvas;
const FixtureCanvas = class {
  getContext() {
    let image;
    return {
      clearRect() {},
      drawImage(value) {
        image = value;
      },
      getImageData() {
        return { data: image.data };
      },
    };
  }
};
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
const { Arm, HAND_POSES } = await import('../../src/weapons/hands.ts');
hooks.deregister();
const bytes = readFileSync(new URL('../../public/models/player/arms.glb', import.meta.url));
const { json, imagePNG } = inspectGLB(bytes);
for (const fixture of ['single', 'grouped', 'grouped-draw-range']) {
  globalThis.OffscreenCanvas = FixtureCanvas;
  const gltf = await parseGLB(bytes);
  gltf.scene.updateMatrixWorld(true);
  const sources = [];
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh) sources.push(o);
  });
  assert.equal(sources.length, 5, 'five editable authored surfaces');
  const expectedPixels = new Map();
  for (const mesh of sources) {
    const source = json.materials.find((m) => m.name === mesh.material.name);
    for (const [key, info] of [
      ['map', source.pbrMetallicRoughness.baseColorTexture],
      ['normalMap', source.normalTexture],
      ['roughnessMap', source.pbrMetallicRoughness.metallicRoughnessTexture],
      ['aoMap', source.occlusionTexture],
    ]) {
      const pixels = imagePNG(json.images[json.textures[info.index].source]);
      mesh.material[key].image = pixels;
      mesh.material[key].flipY = false;
      mesh.material[key].channel = info.texCoord ?? 0;
      expectedPixels.set(mesh.material[key], pixels.data);
    }
  }
  if (fixture !== 'single') {
    const mesh = sources[0],
      split = Math.floor(mesh.geometry.index.count / 6) * 3;
    const other = mesh.material.clone();
    // Keep the original acceptance fixture, but make the second finish distinct
    // so losing group material selection cannot accidentally pass byte checks.
    other.name += '_second_group';
    other.map = sources[1].material.map;
    other.color.setRGB(0.4, 0.6, 0.8);
    other.roughness = 0.63;
    mesh.material = [mesh.material, other];
    mesh.geometry.addGroup(0, split, 0);
    mesh.geometry.addGroup(split, mesh.geometry.index.count - split, 1);
    if (fixture === 'grouped-draw-range')
      mesh.geometry.setDrawRange(3, mesh.geometry.index.count - 6);
  }
  const reference = sources.flatMap((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const ranges = Array.isArray(mesh.material)
      ? mesh.geometry.groups
      : [{ start: 0, count: mesh.geometry.index.count, materialIndex: 0 }];
    return ranges.map((range) => {
      const copy = mesh.clone();
      copy.geometry = mesh.geometry.clone();
      const start = Math.max(range.start, mesh.geometry.drawRange.start);
      const end = Math.min(
        range.start + range.count,
        mesh.geometry.drawRange.start + mesh.geometry.drawRange.count
      );
      copy.geometry.setIndex(
        new THREE.BufferAttribute(mesh.geometry.index.array.slice(start, end), 1)
      );
      copy.geometry.clearGroups();
      copy.geometry.setDrawRange(0, Infinity);
      copy.material = materials[range.materialIndex].clone();
      return copy;
    });
  });
  const originalLoad = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async (url) => {
    assert.equal(url, 'models/player/arms.glb');
    return gltf;
  };
  let asset;
  try {
    asset = await loadArmAsset();
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoad;
    globalThis.OffscreenCanvas = previousCanvas;
  }
  try {
    assert.equal(asset.meshes.length, 1);
    const merged = asset.meshes[0];
    assert.equal(merged.geometry.groups.length, 0, 'no material-group submissions');
    const mat = merged.material;
    assert(mat.isMeshPhysicalNodeMaterial);
    assert(Math.abs(mat.specularIntensity - 0.16) < 1e-7);
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      const array = mat[key];
      assert(array.isDataArrayTexture);
      assert.equal(array.image.depth, fixture === 'single' ? 5 : 6);
      for (const [layer, mesh] of reference.entries()) {
        const pixels = expectedPixels.get(mesh.material[key]);
        assert.deepEqual(
          array.image.data.subarray(layer * pixels.length, (layer + 1) * pixels.length),
          new Uint8Array(pixels),
          `${key} layer preserves authored bytes`
        );
      }
    }
    let offset = 0;
    let indexOffset = 0;
    for (const [surface, mesh] of reference.entries()) {
      const count = mesh.geometry.attributes.position.count;
      for (const key of ['position', 'normal', 'uv', 'uv1', 'skinIndex', 'skinWeight']) {
        const original = mesh.geometry.getAttribute(key).clone();
        if (key === 'position') original.applyMatrix4(mesh.matrixWorld);
        if (key === 'normal')
          original.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
        const combined = merged.geometry.getAttribute(key);
        for (let i = 0; i < count; i++)
          for (let j = 0; j < original.itemSize; j++)
            assert(
              Math.abs(combined.getComponent(offset + i, j) - original.getComponent(i, j)) < 1e-6,
              `${key} ${surface}:${i}:${j}`
            );
      }
      for (let i = 0; i < count; i++) {
        assert.equal(merged.geometry.attributes.armSurface.getX(offset + i), surface);
      }
      for (let i = 0; i < mesh.geometry.index.count; i++) {
        const mergedIndex = merged.geometry.index.getX(indexOffset + i);
        assert.equal(
          mergedIndex,
          mesh.geometry.index.getX(i) + offset,
          `${fixture}: rendered group index range`
        );
        assert.equal(
          merged.geometry.attributes.armSurface.getX(mergedIndex),
          surface,
          'each rendered triangle selects its group finish'
        );
      }
      indexOffset += mesh.geometry.index.count;
      offset += count;
    }
    assert.equal(merged.geometry.index.count, indexOffset, 'exclude unrendered draw-range indices');
    const arms = [];
    for (const side of [-1, 1]) {
      const arm = new Arm(side);
      const old = new Arm(side);
      arms.push(arm);
      try {
        arm.attachAsset(asset);
        old.attachAsset({ meshes: reference });
        assert.equal(arm.skins.length, 1, 'one draw per independently controlled arm');
        assert.equal(arm.skins[0].material, mat);
        assert.notEqual(arm.skins[0].geometry, merged.geometry);
        assert.equal(arm.skins[0].geometry.groups.length, 0);
        assert.equal(arm.skins[0].castShadow, false);
        assert.equal(arm.skins[0].userData.owNoPrepass, true);
        const index = arm.skins[0].geometry.index;
        const input = merged.geometry.index;
        for (let i = 0; i < input.count; i += 3) {
          assert.equal(index.getX(i), input.getX(i + (side > 0 ? 2 : 0)));
          assert.equal(index.getX(i + 2), input.getX(i + (side > 0 ? 0 : 2)));
        }
        for (const pose of Object.keys(HAND_POSES)) {
          for (const rig of [arm, old]) {
            rig.setPose(pose);
            rig.solve(
              new THREE.Vector3(0.08, -0.05, -0.26),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, -0.3))
            );
            rig.root.updateMatrixWorld(true);
            rig.skeleton.update();
          }
          let start = 0;
          for (const skin of old.skins) {
            for (let i = 0; i < skin.geometry.attributes.position.count; i += 17) {
              const a = skin.getVertexPosition(i, new THREE.Vector3());
              const b = arm.skins[0].getVertexPosition(start + i, new THREE.Vector3());
              assert(a.distanceTo(b) < 1e-6, `${side} ${pose}: merged deformation unchanged`);
              const blood = arm.skins[0].geometry.attributes.armBloodPosition;
              const original = skin.geometry.attributes.armBloodPosition;
              assert(
                new THREE.Vector3()
                  .fromBufferAttribute(blood, start + i)
                  .distanceTo(new THREE.Vector3().fromBufferAttribute(original, i)) < 1e-6
              );
            }
            start += skin.geometry.attributes.position.count;
          }
        }
      } finally {
        old.dispose();
      }
    }
    assert.notEqual(arms[0].skeleton, arms[1].skeleton);
    assert.notEqual(arms[0].skins[0].geometry, arms[1].skins[0].geometry);
    for (const arm of arms) arm.dispose();
    const owned = new Set([
      mat,
      mat.map,
      mat.normalMap,
      mat.roughnessMap,
      merged.geometry,
      asset.blood.texture,
      merged.skeleton,
    ]);
    const disposed = new Map();
    for (const resource of owned) {
      const dispose = resource.dispose.bind(resource);
      resource.dispose = () => {
        disposed.set(resource, (disposed.get(resource) ?? 0) + 1);
        dispose();
      };
    }
    asset.dispose();
    for (const resource of owned)
      assert.equal(disposed.get(resource), 1, 'dispose owned resources exactly once');
    assert.equal(asset.meshes.length, 0);
  } finally {
    if (asset.meshes.length) asset.dispose();
    for (const mesh of reference) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
  console.log(`arm-asset fixture: ${fixture} passed`);
}
console.log(
  'arm-asset: 10 -> 2 draws; actual texture bytes, UVs, weights, bone order, all poses, bind-space blood coordinates, per-hand mirroring and disposal preserved'
);
