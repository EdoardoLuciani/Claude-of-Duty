import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import {
  read as readKTX,
  KHR_DF_MODEL_UASTC,
  KHR_SUPERCOMPRESSION_ZSTD,
} from 'three/examples/jsm/libs/ktx-parse.module.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

import { loadP320, P320_URL, P320Animation, makeP320Model } from '../../src/weapons/p320.ts';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/p320-compact/', import.meta.url);
const sourceBytes = readFileSync(new URL('p320-compact.glb', dir));
const bytes = readFileSync(new URL(P320_URL));
const source = inspectGLB(sourceBytes),
  cooked = inspectGLB(bytes);
const report = JSON.parse(readFileSync(new URL('p320-compact.ktx2.json', dir)));
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
assert.equal(report.encoder, 'gltfpack 1.3');
assert.equal(
  report.cookSha256,
  hash(readFileSync(new URL('../../tools/cook-p320.mjs', import.meta.url)))
);
assert.equal(report.sourceSha256, hash(sourceBytes), 'recook after native source changes');
assert.equal(report.sha256, hash(bytes));
assert.equal(report.bytes, bytes.length);
assert.equal(report.sourceBytes, sourceBytes.length);
assert.deepEqual(report.flags, [
  '-kn',
  '-ke',
  '-ac',
  '-af',
  '0',
  '-vpf',
  '-vp',
  '14',
  '-vtf',
  '-vt',
  '16',
  '-vn',
  '8',
  '-ar',
  '16',
  '-at',
  '24',
  '-as',
  '24',
  '-cc',
  '-si',
  '0.50',
  '-se',
  '0.001',
  '-sp',
  '-tu',
  '-tq',
  '10',
  '-tj',
  '1',
]);
for (const extension of ['KHR_texture_basisu', 'EXT_meshopt_compression', 'KHR_mesh_quantization'])
  assert(cooked.json.extensionsRequired.includes(extension));
assert(
  !cooked.json.extensionsUsed.includes('KHR_texture_transform'),
  'float UVs avoid duplicate ORM texture allocations'
);
assert.deepEqual(
  new Set(cooked.json.nodes.map((n) => n.name)),
  new Set(source.json.nodes.map((n) => n.name)),
  'named animation/handling nodes survive'
);
assert.equal(cooked.json.meshes.length, 1);
assert.equal(cooked.json.meshes[0].primitives.length, 1);
assert.equal(cooked.json.materials.length, 1);
assert.equal(cooked.json.skins.length, 1);
assert.deepEqual(
  new Set(cooked.json.skins[0].joints.map((i) => cooked.json.nodes[i].name)),
  new Set(source.json.skins[0].joints.map((i) => source.json.nodes[i].name))
);
const primitive = cooked.json.meshes[0].primitives[0];
assert.equal(report.stats.triangles, cooked.json.accessors[primitive.indices].count / 3);
assert.equal(report.stats.vertices, cooked.json.accessors[primitive.attributes.POSITION].count);
assert(
  report.stats.triangles >= 17000 && report.stats.triangles < 18000,
  'approved tight-error triangle budget'
);
assert.equal(report.stats.primitives, 1);
assert.equal(report.stats.materials, 1);
assert.equal(report.stats.joints, 9);

function imageData(container, image) {
  const view = container.json.bufferViews[image.bufferView];
  return container.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}
assert.equal(cooked.json.images.length, 4);
for (let i = 0; i < cooked.json.images.length; i++) {
  const image = cooked.json.images[i],
    native = source.json.images.find((s) => s.name === image.name);
  assert(native, 'each runtime map comes from a native bake');
  assert.equal(image.mimeType, 'image/ktx2');
  assert.equal(image.uri, undefined);
  const raw = imageData(cooked, image),
    ktx = readKTX(raw);
  const srgb = ['p320-base', 'p320-emission'].includes(image.name);
  assert.equal(ktx.pixelWidth, 1024);
  assert.equal(ktx.pixelHeight, 1024);
  assert.equal(ktx.levels.length, 11);
  assert.equal(ktx.faceCount, 1);
  assert.equal(ktx.layerCount, 0);
  assert.equal(ktx.pixelDepth, 0);
  assert.equal(ktx.supercompressionScheme, KHR_SUPERCOMPRESSION_ZSTD);
  const dfd = ktx.dataFormatDescriptor[0];
  assert.equal(dfd.colorModel, KHR_DF_MODEL_UASTC);
  assert.equal(dfd.transferFunction, srgb ? 2 : 1);
  assert.equal(dfd.flags, 0);
  assert.equal(dfd.samples.length, 1);
  assert.equal(dfd.samples[0].channelType, 0, 'RGB, not packed XY normal data');
  assert.equal(report.images[i].name, image.name);
  assert.equal(report.images[i].sha256, hash(raw));
  assert.equal(report.images[i].sourceSha256, hash(imageData(source, native)));
}
for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm'])
  assert.deepEqual(
    readFileSync(new URL(`../../public/vendor/basis-e27dfa95/${name}`, import.meta.url)),
    readFileSync(
      new URL(`../../node_modules/three/examples/jsm/libs/basis/${name}`, import.meta.url)
    ),
    'serve transcoder bytes matching the pinned Three version'
  );

// Geometry/animation optimization is now intentional; bound the approved motion loss.
const nativeModel = makeP320Model(await parseGLB(sourceBytes));
const packedModel = makeP320Model(await parseGLB(bytes));
const nativeAnimation = new P320Animation(nativeModel),
  packedAnimation = new P320Animation(packedModel);
assert.equal(packedModel.textures.size, 4);
const nativeMaterial = [...nativeModel.materials][0],
  packedMaterial = [...packedModel.materials][0];
assert.equal(packedMaterial.roughnessMap, packedMaterial.metalnessMap);
for (const key of [
  'metalness',
  'roughness',
  'emissiveIntensity',
  'specularIntensity',
  'ior',
  'opacity',
  'side',
])
  assert.equal(packedMaterial[key], nativeMaterial[key], `authored ${key}`);
for (const key of ['color', 'emissive', 'normalScale'])
  assert.deepEqual(packedMaterial[key].toArray(), nativeMaterial[key].toArray(), `authored ${key}`);
for (const [map, channel] of [
  ['map', 1],
  ['normalMap', 0],
  ['roughnessMap', 0],
  ['metalnessMap', 0],
  ['emissiveMap', 0],
])
  assert.equal(packedMaterial[map].channel, channel);
const pairs = [];
nativeModel.root.traverse((node) => {
  if (node.name && !node.isMesh) pairs.push([node, packedModel.root.getObjectByName(node.name)]);
});
const p0 = new THREE.Vector3(),
  p1 = new THREE.Vector3();
const q0 = new THREE.Quaternion(),
  q1 = new THREE.Quaternion();
const s0 = new THREE.Vector3(),
  s1 = new THREE.Vector3();
let maxPosition = 0,
  maxAngle = 0;
for (const clip of nativeModel.animations) {
  const packedClip = packedModel.animations.find((c) => c.name === clip.name);
  assert.equal(packedClip.duration, clip.duration, `${clip.name}: duration`);
  for (let frame = 0; frame <= Math.ceil(clip.duration * 120); frame++) {
    const t = Math.min(frame / 120, clip.duration);
    nativeAnimation._sample(clip.name, t);
    packedAnimation._sample(clip.name, t);
    nativeModel.scene.updateMatrixWorld(true);
    packedModel.scene.updateMatrixWorld(true);
    for (const [a, b] of pairs) {
      assert(b, a.name);
      a.matrixWorld.decompose(p0, q0, s0);
      b.matrixWorld.decompose(p1, q1, s1);
      const distance = p0.distanceTo(p1),
        angle = q0.normalize().angleTo(q1.normalize());
      assert(Number.isFinite(distance) && Number.isFinite(angle));
      assert(s0.distanceTo(s1) < 0.0001, `${clip.name}/${t}: ${a.name} scale/visibility drift`);
      assert(distance < 0.0003, `${clip.name}/${t}: ${a.name} position drift ${distance}`);
      assert(angle < THREE.MathUtils.degToRad(0.12), `${clip.name}/${t}: ${a.name} rotation drift`);
      maxPosition = Math.max(maxPosition, distance);
      maxAngle = Math.max(maxAngle, angle);
    }
  }
}
const idleRotation = packedModel.animations
  .find((c) => c.name === 'Idle')
  .tracks.find((t) => t.name === 'P320_RIG.quaternion');
assert.equal(idleRotation.times.length, 1, 'approved tiny idle tilt is folded to a constant');
nativeAnimation.dispose();
packedAnimation.dispose();
assert(maxPosition > 0 && maxAngle > 0, 'comparison exercises the approved lossy motion');
console.log(
  `P320 gltfpack motion: max ${(maxPosition * 1000).toFixed(3)} mm / ${THREE.MathUtils.radToDeg(maxAngle).toFixed(3)} degrees`
);

// Actual loader configuration/lifecycle; only image decoding and fetch are stubbed.
const originalLoad = GLTFLoader.prototype.loadAsync;
const originalDispose = KTX2Loader.prototype.dispose;
const sentinel = new Error('fixture load failure');
const initFailure = new Error('fixture decoder initialization failure');
let mode = 'compressed',
  disposals = 0,
  finishInit,
  config;
GLTFLoader.prototype.loadAsync = async function (url) {
  assert.equal(url, mode === 'png' ? new URL('p320-compact.glb', dir).href : P320_URL);
  assert.equal(this.meshoptDecoder, MeshoptDecoder, 'runtime uses the local meshopt decoder');
  const decoder = this.ktx2Loader;
  config = decoder.workerConfig;
  assert.match(decoder.transcoderPath, /vendor\/basis-e27dfa95\/$/);
  if (mode !== 'png')
    decoder.transcoderPending =
      mode === 'error' || mode === 'init-error'
        ? new Promise((_resolve, reject) => {
            finishInit = () => reject(initFailure);
          })
        : Promise.resolve();
  if (mode === 'error') throw sentinel;
  return parseGLB(mode === 'png' ? sourceBytes : bytes);
};
KTX2Loader.prototype.dispose = function () {
  disposals++;
};
try {
  for (const supported of [
    new Set(['texture-compression-bc']),
    new Set(['texture-compression-astc']),
    new Set(),
  ]) {
    const model = await loadP320({ hasFeature: (feature) => supported.has(feature) });
    assert.equal(config.bptcSupported, supported.has('texture-compression-bc'));
    assert.equal(config.astcSupported, supported.has('texture-compression-astc'));
    assert(
      !config.astcHDRSupported &&
        !config.etc1Supported &&
        !config.etc2Supported &&
        !config.dxtSupported &&
        !config.pvrtcSupported
    );
    new P320Animation(model).dispose();
  }
  assert.equal(disposals, 3, 'transcoding workers close after each completed asset load');
  mode = 'png';
  new P320Animation(
    await loadP320({ hasFeature: () => false }, new URL('p320-compact.glb', dir).href)
  ).dispose();
  assert.equal(disposals, 3, 'do not decrement an uninitialized PNG diagnostic decoder');
  mode = 'error';
  const rejected = assert.rejects(
    loadP320({ hasFeature: () => false }),
    (error) => error === sentinel
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposals, 3, 'initialization must settle before disposal');
  finishInit();
  await rejected;
  assert.equal(
    disposals,
    4,
    'model failure stays authoritative when decoder initialization also fails'
  );
  // GLTFLoader can resolve after dropping failed textures instead of rejecting.
  mode = 'init-error';
  const rejectedInit = assert.rejects(
    loadP320({ hasFeature: () => false }),
    (error) => error === initFailure
  );
  await new Promise((resolve) => setImmediate(resolve));
  finishInit();
  await rejectedInit;
  assert.equal(disposals, 5, 'decoder initialization failure rejects the model and still disposes');
} finally {
  GLTFLoader.prototype.loadAsync = originalLoad;
  KTX2Loader.prototype.dispose = originalDispose;
}
console.log(
  'P320 gltfpack: source/product hashes, quantization budget, UASTC/mips/UVs, bounded motion and decoder lifecycle passed'
);
