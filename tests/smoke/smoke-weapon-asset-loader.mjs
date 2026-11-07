import assert from 'node:assert/strict';

import { CompressedTexture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { WorkerPool } from 'three/examples/jsm/utils/WorkerPool.js';

import { disposeWeaponLoader, loadWeaponGLTF } from '../../src/weapons/asset-loader.ts';

const saved = {
  fetch: globalThis.fetch,
  parseGLTF: GLTFLoader.prototype.parseAsync,
  parseTexture: KTX2Loader.prototype.parse,
  init: KTX2Loader.prototype.init,
  dispose: KTX2Loader.prototype.dispose,
  postMessage: WorkerPool.prototype.postMessage,
};
const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const renderer = { hasFeature: (name) => name === 'texture-compression-bc' };
const downloads = new Map(),
  jobs = [],
  parsers = [],
  decoders = new Set();
let initializations = 0,
  disposals = 0,
  lateTextureDisposals = 0,
  initFailure = false;
let lateScope;
const buffer = (id) => new Uint8Array([id]).buffer;
try {
  globalThis.fetch = (url, { signal }) => {
    const request = pending();
    signal.addEventListener('abort', () => request.reject(new Error('aborted')), { once: true });
    downloads.set(url, request);
    return request.promise;
  };
  KTX2Loader.prototype.init = function () {
    if (!this.transcoderPending) {
      initializations++;
      decoders.add(this);
      assert.equal(this.workerPool.pool, 2);
      assert.equal(this.workerConfig.bptcSupported, true);
      this.transcoderPending = initFailure
        ? Promise.reject(new Error('decoder init failed'))
        : Promise.resolve();
    }
    return this.transcoderPending;
  };
  WorkerPool.prototype.postMessage = function (message) {
    const job = pending();
    jobs.push({ id: new Uint8Array(message.buffer)[0], ...job });
    return job.promise;
  };
  KTX2Loader.prototype.parse = function (data, onLoad, onError) {
    void this.init()
      .then(() => this.workerPool.postMessage({ buffer: data }))
      .then((event) => {
        // Like the pinned loader, destructure success data before inspecting errors.
        const { faces } = event.data.data;
        assert(faces);
        const texture = new CompressedTexture();
        texture.addEventListener('dispose', () => lateTextureDisposals++);
        onLoad(texture);
      })
      .catch(onError);
  };
  KTX2Loader.prototype.dispose = function () {
    disposals++;
  };
  GLTFLoader.prototype.parseAsync = async function (data, path) {
    const id = new Uint8Array(data)[0];
    assert.equal(path, '/models/');
    parsers.push(id);
    const textures = this.ktx2Loader;
    if (id === 9) {
      // Non-textured diagnostics never start Basis.
      return { id };
    }
    const image = new Promise((resolve) => textures.parse(data, resolve, () => resolve(null)));
    if (id === 3) {
      lateScope = textures;
      await tick(); // Start decoding before geometry fails.
      throw new Error('bad geometry');
    }
    const texture = await image; // GLTFLoader swallows image errors into null.
    return { id, texture };
  };
  const respond = (id, ok = true) =>
    downloads.get(`/models/${id}.glb`).resolve({
      ok,
      status: ok ? 200 : 404,
      arrayBuffer: async () => buffer(id),
    });
  const complete = (id, error = null) => {
    const job = jobs.find((job) => job.id === id);
    assert(job, `texture task ${id} started`);
    job.resolve({ data: error ? { type: 'error', error } : { data: { faces: [] } } });
  };

  const first = loadWeaponGLTF(renderer, '/models/1.glb');
  const second = loadWeaponGLTF(renderer, '/models/2.glb');
  assert.equal(downloads.size, 2, 'downloads start together, before parsing');
  respond(2);
  await tick();
  assert.deepEqual(parsers, [], 'later download cannot bypass bounded parse queue');
  respond(1);
  await tick();
  assert.deepEqual(parsers, [1]);
  const missing = loadWeaponGLTF(renderer, '/models/6.glb');
  const missingRejected = assert.rejects(missing, /HTTP 404/);
  respond(6, false);
  await tick(); // A queued HTTP failure is observed before its parse turn.
  assert.deepEqual(parsers, [1]);
  complete(1);
  await first;
  await tick();
  assert.deepEqual(parsers, [1, 2]);
  complete(2);
  await second;
  await missingRejected;
  assert.equal(initializations, 1);
  assert.equal(decoders.size, 1, 'both models use the same initialized transcoder');
  assert.equal(disposals, 0, 'keep workers alive between model loads');

  const bad = loadWeaponGLTF(renderer, '/models/3.glb');
  const rejected = assert.rejects(bad, /bad geometry/);
  const good = loadWeaponGLTF(renderer, '/models/4.glb');
  respond(3);
  respond(4);
  await tick();
  await tick();
  assert.equal(parsers.at(-1), 3, 'do not start next model while failed-model work drains');
  complete(3);
  await rejected;
  await tick();
  assert.equal(lateTextureDisposals, 1, 'discard textures completed after geometry rejection');
  let lateError;
  lateScope.parse(
    buffer(30),
    () => assert.fail('closed scope loaded texture'),
    (error) => {
      lateError = error;
    }
  );
  assert.match(lateError.message, /scope closed/);
  assert(!jobs.some((job) => job.id === 30));
  const requested = downloads.size;
  lateScope.load(
    '/late.ktx2',
    () => assert.fail('closed scope loaded image'),
    undefined,
    (error) => {
      assert.match(error.message, /scope closed/);
    }
  );
  assert.equal(downloads.size, requested, 'closed scope cannot start external image fetches');
  complete(4);
  await good;

  const brokenTexture = loadWeaponGLTF(renderer, '/models/5.glb');
  const textureRejected = assert.rejects(
    brokenTexture,
    (error) => error === 'original transcode error'
  );
  respond(5);
  await tick();
  complete(5, 'original transcode error');
  await textureRejected;
  await disposeWeaponLoader(renderer);
  await disposeWeaponLoader(renderer);
  assert.equal(disposals, 1, 'one release for the shared initialized pool');

  initFailure = true;
  const initBad = loadWeaponGLTF(renderer, '/models/7.glb');
  const initRejected = assert.rejects(initBad, /decoder init failed/);
  respond(7);
  await initRejected;
  await disposeWeaponLoader(renderer);
  assert.equal(disposals, 2, 'failed initialization still releases its loader');
  initFailure = false;
  const png = loadWeaponGLTF(renderer, '/models/9.glb');
  respond(9);
  await png;
  await disposeWeaponLoader(renderer);
  assert.equal(disposals, 2, 'uninitialized diagnostic facade does not decrement active loaders');

  const cancelled = loadWeaponGLTF(renderer, '/models/8.glb');
  const cancelRejected = assert.rejects(cancelled, /aborted/);
  const closing = disposeWeaponLoader(renderer);
  await cancelRejected;
  await closing;
  assert.equal(disposals, 2);
} finally {
  await disposeWeaponLoader(renderer);
  globalThis.fetch = saved.fetch;
  GLTFLoader.prototype.parseAsync = saved.parseGLTF;
  KTX2Loader.prototype.parse = saved.parseTexture;
  KTX2Loader.prototype.init = saved.init;
  KTX2Loader.prototype.dispose = saved.dispose;
  WorkerPool.prototype.postMessage = saved.postMessage;
}
console.log(
  'ok weapon loading: parallel downloads, bounded parsing, shared transcoder, error isolation and cleanup'
);
