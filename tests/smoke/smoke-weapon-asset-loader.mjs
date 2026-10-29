import assert from 'node:assert/strict';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

import { loadWeaponGLTF } from '../../src/weapons/asset-loader.ts';

const originalLoad = GLTFLoader.prototype.loadAsync;
const originalDispose = KTX2Loader.prototype.dispose;
const gates = [Promise.withResolvers(), Promise.withResolvers()];
const started = [];
const failure = new Error('first weapon failed');
const healthy = { scene: 'second weapon' };
let disposals = 0;
GLTFLoader.prototype.loadAsync = function (url) {
  this.ktx2Loader.transcoderPending = Promise.resolve();
  started.push(url);
  return gates[started.length - 1].promise;
};
KTX2Loader.prototype.dispose = function () {
  disposals++;
};
try {
  const rejected = assert.rejects(
    loadWeaponGLTF({ hasFeature: () => false }, 'first'),
    (error) => error === failure
  );
  const second = loadWeaponGLTF({ hasFeature: () => false }, 'second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['first'], 'concurrent requests do not start concurrent decoder pools');
  gates[0].reject(failure);
  await rejected;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['first', 'second'], 'a failed model does not block the next request');
  assert.equal(disposals, 1, 'previous decoder closes before the next model starts');
  gates[1].resolve(healthy);
  assert.equal(await second, healthy);
  assert.equal(disposals, 2);
} finally {
  gates[0].resolve();
  gates[1].resolve();
  GLTFLoader.prototype.loadAsync = originalLoad;
  KTX2Loader.prototype.dispose = originalDispose;
}
console.log(
  'Weapon asset loader: bounded decoder concurrency, failure recovery and ordered disposal passed'
);
