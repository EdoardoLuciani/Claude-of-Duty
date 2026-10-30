import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { WorkerPool } from 'three/examples/jsm/utils/WorkerPool.js';

import { loadP320, P320_URL } from '../../src/weapons/p320.ts';
import { inspectGLB } from '../../tools/lib/glb-fixture.mjs';

const bytes = readFileSync(new URL(P320_URL));
const { json } = inspectGLB(bytes);
const binaryOffset = 28 + bytes.readUInt32LE(12);
const position = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
const compressed = json.bufferViews[position.bufferView].extensions.EXT_meshopt_compression;
const originalGlobals = {
  self: globalThis.self,
  ProgressEvent: globalThis.ProgressEvent,
  fetch: globalThis.fetch,
};
const originalInit = KTX2Loader.prototype.init;
const originalParse = KTX2Loader.prototype.parse;
const originalDispose = KTX2Loader.prototype.dispose;
const originalPostMessage = WorkerPool.prototype.postMessage;
const originalDecode = MeshoptDecoder.decodeGltfBufferAsync;
const transcodeFailure = 'fixture transcode failure after decoder setup';
const geometryFailure = new Error('fixture geometry failure');
let fixtureBytes = bytes,
  initializations = 0,
  transcodes = 0,
  disposals = 0,
  imageGate,
  setupGate,
  workerGate,
  geometryGate,
  onInit = () => {},
  onTranscode = () => {},
  onTextureError = () => {};

// Keep GLTFLoader, direct bufferView KTX parsing and texture-error handling real.
globalThis.self = globalThis;
globalThis.ProgressEvent = class extends Event {
  constructor(type, properties) {
    super(type);
    Object.assign(this, properties);
  }
};
globalThis.fetch = async (input, options) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === P320_URL) return new Response(fixtureBytes);
  return originalGlobals.fetch(input, options);
};
KTX2Loader.prototype.init = function () {
  if (!this.transcoderPending) {
    initializations++;
    this.transcoderPending = setupGate?.promise ?? Promise.resolve();
    onInit();
  }
  return this.transcoderPending;
};
KTX2Loader.prototype.parse = function (buffer, onLoad, onError) {
  const fail = (error) => {
    onTextureError(error);
    onError?.(error);
  };
  // r187 no longer fetches blob URLs for embedded KTX2; delay parse instead.
  if (imageGate) {
    imageGate.promise.then(() => originalParse.call(this, buffer, onLoad, fail)).catch(fail);
    return;
  }
  return originalParse.call(this, buffer, onLoad, fail);
};
WorkerPool.prototype.postMessage = async function () {
  transcodes++;
  onTranscode();
  await workerGate?.promise;
  return { data: { type: 'error', id: transcodes, error: transcodeFailure } };
};
KTX2Loader.prototype.dispose = function () {
  // Mock initialization does not increment the loader's private active count.
  disposals++;
  this.workerPool.dispose();
};
MeshoptDecoder.decodeGltfBufferAsync = function (count, size, ...args) {
  if (geometryGate && count === position.count && size === compressed.byteStride)
    return geometryGate.promise;
  return originalDecode.call(this, count, size, ...args);
};
function waitForTextureErrors() {
  const done = Promise.withResolvers();
  let count = 0;
  onTextureError = () => {
    if (++count === 4) done.resolve();
  };
  return done.promise;
}

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

  // Geometry can reject before image parsing starts. Late images must not start workers.
  fixtureBytes = Buffer.from(bytes);
  fixtureBytes[binaryOffset + compressed.byteOffset] = 0;
  imageGate = Promise.withResolvers();
  const lateImages = waitForTextureErrors();
  await assert.rejects(loadP320({ hasFeature: () => false }), /Malformed buffer data/);
  assert.equal(initializations, 0);
  imageGate.resolve();
  await lateImages;
  assert.equal(initializations, 0, 'late image completions cannot initialize a closed decoder');
  assert.equal(transcodes, 0);
  assert.equal(disposals, 0, 'never dispose a decoder that did not initialize');
  imageGate = undefined;

  fixtureBytes = bytes;
  onTextureError = () => {};
  await assert.rejects(
    loadP320({ hasFeature: () => false }),
    (error) => error === transcodeFailure
  );
  assert.equal(initializations, 1);
  assert.equal(transcodes, 4, 'real worker error replies retain their original diagnostic');
  assert.equal(disposals, 1, 'transcode failure still disposes the decoder');

  // Initialization already started: do not dispatch workers after geometry has failed.
  geometryGate = Promise.withResolvers();
  setupGate = Promise.withResolvers();
  const initializing = Promise.withResolvers();
  onInit = initializing.resolve;
  const setupImages = waitForTextureErrors();
  const rejectedSetup = assert.rejects(
    loadP320({ hasFeature: () => false }),
    (error) => error === geometryFailure
  );
  await initializing.promise;
  geometryGate.reject(geometryFailure);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposals, 1, 'wait for setup before disposing');
  setupGate.resolve();
  await rejectedSetup;
  await setupImages;
  assert.equal(transcodes, 4, 'no late dispatch after pending initialization settles');
  assert.equal(disposals, 2);
  setupGate = undefined;

  // Already-dispatched tasks must settle before their workers are terminated.
  geometryGate = Promise.withResolvers();
  workerGate = Promise.withResolvers();
  const working = Promise.withResolvers();
  onTranscode = () => {
    if (transcodes === 8) working.resolve();
  };
  const workerImages = waitForTextureErrors();
  const rejectedWorkers = assert.rejects(
    loadP320({ hasFeature: () => false }),
    (error) => error === geometryFailure
  );
  await working.promise;
  geometryGate.reject(geometryFailure);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposals, 2, 'drain active transcodes before disposal');
  workerGate.resolve();
  await rejectedWorkers;
  await workerImages;
  assert.equal(disposals, 3, 'geometry error remains authoritative after task failures');
} finally {
  imageGate?.resolve();
  setupGate?.resolve();
  workerGate?.resolve();
  Object.assign(globalThis, originalGlobals);
  KTX2Loader.prototype.init = originalInit;
  KTX2Loader.prototype.parse = originalParse;
  KTX2Loader.prototype.dispose = originalDispose;
  WorkerPool.prototype.postMessage = originalPostMessage;
  MeshoptDecoder.decodeGltfBufferAsync = originalDecode;
}
console.log(
  'P320 KTX2: real worker errors and early geometry failures reject without late decoding or worker leaks'
);
