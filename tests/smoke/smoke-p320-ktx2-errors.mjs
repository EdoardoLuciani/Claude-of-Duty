import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

import { loadP320, P320_URL } from '../../src/weapons/p320.ts';
import { inspectGLB } from '../../tools/lib/glb-fixture.mjs';

const bytes = readFileSync(new URL(P320_URL));
const { json } = inspectGLB(bytes);
const binaryOffset = 28 + bytes.readUInt32LE(12);
const originalGlobals = {
  self: globalThis.self,
  ProgressEvent: globalThis.ProgressEvent,
  fetch: globalThis.fetch,
};
const originalInit = KTX2Loader.prototype.init;
const originalDispose = KTX2Loader.prototype.dispose;
const transcodeFailure = 'fixture transcode failure after decoder setup';
let fixtureBytes = bytes,
  initializations = 0,
  transcodes = 0,
  disposals = 0;

// Keep GLTFLoader, blob fetching, KTX parsing and GLTF texture-error handling real.
globalThis.self = globalThis;
globalThis.ProgressEvent = class extends Event {
  constructor(type, properties) {
    super(type);
    Object.assign(this, properties);
  }
};
globalThis.fetch = (input, options) =>
  (input instanceof Request ? input.url : String(input)) === P320_URL
    ? Promise.resolve(new Response(fixtureBytes))
    : originalGlobals.fetch(input, options);
KTX2Loader.prototype.init = function () {
  if (!this.transcoderPending) {
    initializations++;
    this.transcoderPending = Promise.resolve();
    // Supply the worker's error reply, after real KTX parsing and setup complete.
    this.workerPool.postMessage = async () => {
      transcodes++;
      return { data: { type: 'error', error: transcodeFailure, data: {} } };
    };
  }
  return this.transcoderPending;
};
KTX2Loader.prototype.dispose = function () {
  // The test setup does not increment KTX2Loader's private active-loader count.
  disposals++;
  this.workerPool.dispose();
};
try {
  fixtureBytes = Buffer.from(bytes);
  for (const image of json.images) {
    const view = json.bufferViews[image.bufferView];
    fixtureBytes[binaryOffset + (view.byteOffset ?? 0)] = 0;
  }
  await assert.rejects(
    loadP320({ hasFeature: () => false }),
    (error) => error.message === 'Missing KTX 2.0 identifier.'
  );
  assert.equal(initializations, 0, 'malformed KTX fails before decoder setup');
  assert.equal(disposals, 0, 'no initialized decoder to dispose');

  fixtureBytes = bytes;
  await assert.rejects(
    loadP320({ hasFeature: () => false }),
    (error) => error === transcodeFailure
  );
  assert.equal(initializations, 1);
  assert.equal(transcodes, 4, 'all image callbacks pass through the actual GLTF texture path');
  assert.equal(disposals, 1, 'post-setup transcode failure still disposes the decoder');
} finally {
  Object.assign(globalThis, originalGlobals);
  KTX2Loader.prototype.init = originalInit;
  KTX2Loader.prototype.dispose = originalDispose;
}
console.log(
  'P320 KTX2: real GLTF texture path rejects malformed images and worker transcode errors'
);
