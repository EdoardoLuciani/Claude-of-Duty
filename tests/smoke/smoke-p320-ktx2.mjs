import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  read as readKTX,
  KHR_DF_MODEL_UASTC,
  KHR_SUPERCOMPRESSION_ZSTD,
} from 'three/examples/jsm/libs/ktx-parse.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

import { loadP320, P320_URL, P320Animation } from '../../src/weapons/p320.ts';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/p320-compact/', import.meta.url);
const sourceBytes = readFileSync(new URL('p320-compact.glb', dir));
const bytes = readFileSync(new URL(P320_URL));
const source = inspectGLB(sourceBytes),
  cooked = inspectGLB(bytes);
const report = JSON.parse(readFileSync(new URL('p320-compact.ktx2.json', dir)));
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
assert.equal(report.encoder, 'toktx v4.4.2');
assert.equal(report.sourceSha256, hash(sourceBytes), 'recook after native source changes');
assert.equal(report.sha256, hash(bytes));
assert.equal(report.bytes, bytes.length);
assert.equal(report.sourceBytes, sourceBytes.length);
assert(cooked.json.extensionsRequired.includes('KHR_texture_basisu'));
for (const key of [
  'accessors',
  'meshes',
  'nodes',
  'skins',
  'animations',
  'materials',
  'samplers',
  'scenes',
])
  assert.deepEqual(
    cooked.json[key],
    source.json[key],
    `${key}: texture cooking must not rewrite weapon data`
  );
const imageViews = new Set(source.json.images.map((image) => image.bufferView));
assert.equal(cooked.json.bufferViews.length, source.json.bufferViews.length);
function viewData(container, index) {
  const view = container.json.bufferViews[index];
  return container.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}
for (let i = 0; i < source.json.bufferViews.length; i++) {
  if (!imageViews.has(i)) {
    assert.deepEqual(
      viewData(cooked, i),
      viewData(source, i),
      `buffer ${i}: geometry/skin/animation bytes`
    );
    const { byteOffset: oldOffset, ...oldView } = source.json.bufferViews[i];
    const { byteOffset: newOffset, ...newView } = cooked.json.bufferViews[i];
    assert.deepEqual(newView, oldView);
    assert(Number.isInteger(oldOffset) && Number.isInteger(newOffset));
  }
}
assert.equal(cooked.json.images.length, 4);
for (let i = 0; i < cooked.json.images.length; i++) {
  const image = cooked.json.images[i];
  assert.equal(image.name, source.json.images[i].name);
  assert.equal(image.mimeType, 'image/ktx2');
  assert.equal(image.uri, undefined, 'all runtime textures stay embedded and local');
  const raw = viewData(cooked, image.bufferView),
    ktx = readKTX(raw);
  const srgb = ['p320-base', 'p320-emission'].includes(image.name);
  assert.equal(ktx.pixelWidth, 1024);
  assert.equal(ktx.pixelHeight, 1024);
  assert.equal(ktx.levels.length, 11, 'complete mip chain');
  assert.equal(ktx.faceCount, 1);
  assert.equal(ktx.layerCount, 0);
  assert.equal(ktx.pixelDepth, 0);
  assert.equal(ktx.supercompressionScheme, KHR_SUPERCOMPRESSION_ZSTD);
  const dfd = ktx.dataFormatDescriptor[0];
  assert.equal(dfd.colorModel, KHR_DF_MODEL_UASTC);
  assert.equal(dfd.transferFunction, srgb ? 2 : 1);
  assert.equal(dfd.flags, 0, 'not premultiplied');
  assert.equal(dfd.samples.length, 1);
  assert.equal(
    dfd.samples[0].channelType,
    0,
    'RGB data, not packed XY requiring normal reconstruction'
  );
  assert.equal(report.images[i].sha256, hash(raw));
  assert.equal(
    report.images[i].sourceSha256,
    hash(viewData(source, source.json.images[i].bufferView))
  );
}
for (let i = 0; i < cooked.json.textures.length; i++) {
  const texture = cooked.json.textures[i];
  assert.equal(texture.source, undefined);
  assert.equal(texture.extensions.KHR_texture_basisu.source, source.json.textures[i].source);
  const { source: oldSource, extensions: oldExtensions, ...oldTexture } = source.json.textures[i];
  const { extensions, ...newTexture } = texture;
  assert.deepEqual(newTexture, oldTexture, 'sampler and other texture fields survive');
  assert.deepEqual(extensions, { ...oldExtensions, KHR_texture_basisu: { source: oldSource } });
}
for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm'])
  assert.deepEqual(
    readFileSync(new URL(`../../public/vendor/basis-e27dfa95/${name}`, import.meta.url)),
    readFileSync(
      new URL(`../../node_modules/three/examples/jsm/libs/basis/${name}`, import.meta.url)
    ),
    'serve transcoder bytes matching the pinned Three version'
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
  'P320 KTX2: immutable weapon buffers, UASTC/mips/color spaces, UVs, local transcoder and loader lifecycle passed'
);
