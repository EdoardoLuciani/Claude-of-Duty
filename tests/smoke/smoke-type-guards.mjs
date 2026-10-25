import assert from 'node:assert/strict';

import { BufferGeometry, Group, Mesh, MeshBasicMaterial, SkinnedMesh, Texture } from 'three';
import { float, vec3, vec4 } from 'three/tsl';

import { hasOwn, isClosable, isImageBitmap, isRecord } from '../../src/core/guards.ts';
import { EventBus } from '../../src/core/registry.ts';
import {
  isGroup,
  isMesh,
  isSingleMaterialMesh,
  isSkinnedMesh,
  isTexture,
} from '../../src/core/three-guards.ts';
import { SURFACE, SURFACE_NAMES } from '../../src/physics/surfaces.ts';
import { createFogCompute } from '../../src/render/fog-compute-webgpu.ts';
import { setClass, setStyle } from '../../src/ui/util.ts';
import { FixtureImageBitmap, installImageBitmapFixture } from '../lib/image-bitmap.mjs';

for (const value of [null, undefined, 1, 'value', [], () => {}]) {
  assert.equal(isRecord(value), false);
  assert.equal(isImageBitmap(value), false);
  assert.equal(isClosable(value), false);
}
assert.equal(isRecord({ value: 1 }), true);
assert.equal(hasOwn({ value: 1 }, 'value'), true);
assert.equal(hasOwn({ value: 1 }, 'constructor'), false);
assert.equal(hasOwn({ value: 1 }, '__proto__'), false);
const previousBitmap = Object.getOwnPropertyDescriptor(globalThis, 'ImageBitmap');
try {
  delete globalThis.ImageBitmap;
  assert.equal(isImageBitmap({ width: 2, height: 2, close() {} }), false);
} finally {
  if (previousBitmap) Object.defineProperty(globalThis, 'ImageBitmap', previousBitmap);
}
const restoreImageBitmap = installImageBitmapFixture();
try {
  const image = new FixtureImageBitmap({ width: 2, height: 2 });
  assert.equal(isImageBitmap(image), true);
  assert.equal(
    isImageBitmap({ width: 2, height: 2, close() {} }),
    false,
    'a native canvas rejects plain lookalikes'
  );
  assert.equal(isImageBitmap({ ...image, width: '2' }), false);
  assert.equal(isImageBitmap({ ...image, close: true }), false);
} finally {
  restoreImageBitmap();
}
assert.equal(isClosable({ close() {} }), true);

const geometry = new BufferGeometry();
const material = new MeshBasicMaterial();
const mesh = new Mesh(geometry, material);
assert.equal(isMesh(mesh), true);
assert.equal(isSingleMaterialMesh(mesh), true);
assert.equal(isSingleMaterialMesh(new Mesh(geometry, [material])), false);
assert.equal(isMesh(new Group()), false);
assert.equal(isGroup(new Group()), true);
assert.equal(isGroup(mesh), false);
assert.equal(isGroup({ isGroup: true }), false);
assert.equal(isMesh({ isMesh: true }), false, 'flags alone do not establish a Three instance');
assert.equal(isSkinnedMesh(new SkinnedMesh(geometry, material)), true);
const texture = new Texture();
assert.equal(isTexture(texture), true);
assert.equal(isTexture({ isTexture: true }), false);
texture.dispose();
geometry.dispose();
material.dispose();

// Exercise the pinned compute API, not a newer @types-only method such as setCount.
const fog = createFogCompute(() => vec3(0), { color: vec4(0), depth: float(1) });
assert.deepEqual(fog.computeNode.workgroupSize, [8, 8, 1]);
assert.deepEqual(fog.computeNode.dispatchSize, [1, 1, 1]);
assert.equal(fog.computeNode.count, null);
fog.dispose();
for (const [index, name] of SURFACE_NAMES.entries()) assert.equal(SURFACE[name], index);

// Mapped listener buckets must preserve arbitrary property keys as Map did.
const bus = new EventBus();
const received = [];
for (const key of ['__proto__', 'constructor', 'normal', Symbol('event')]) {
  const off = bus.on(key, (payload) => received.push(payload));
  bus.emit(key, key);
  assert.equal(received.at(-1), key);
  off();
  const length = received.length;
  bus.emit(key, 'ignored');
  assert.equal(received.length, length);
}
let once = 0;
bus.once('__proto__', () => once++);
bus.emit('__proto__', {});
bus.emit('__proto__', {});
assert.equal(once, 1);
bus.on('cleared', () => assert.fail('cleared listener ran'));
bus.clear();
bus.emit('cleared', {});

// Number/string pairs remain separate channels, including Map's numeric edge cases.
for (const [numeric, text] of [
  [1, '1'],
  [0, '0'],
  [NaN, 'NaN'],
  [Infinity, 'Infinity'],
]) {
  const keyed = new EventBus();
  const calls = [];
  const listener = (payload) => calls.push(payload);
  const offNumeric = keyed.on(numeric, listener);
  keyed.on(text, listener);
  keyed.emit(numeric, 'number');
  assert.deepEqual(calls, ['number']);
  keyed.emit(text, 'string');
  assert.deepEqual(calls, ['number', 'string']);
  offNumeric();
  keyed.emit(numeric, 'removed');
  assert.equal(calls.length, 2);
  keyed.emit(text, 'string remains');
  assert.equal(calls.at(-1), 'string remains');
  let numericOnce = 0;
  keyed.once(numeric, () => numericOnce++);
  keyed.emit(text, 'does not consume numeric once');
  keyed.emit(numeric, 'once');
  keyed.emit(numeric, 'not twice');
  assert.equal(numericOnce, 1);
  keyed.on(numeric, () => assert.fail('numeric listener survived clear'));
  keyed.clear();
  keyed.emit(numeric, 'cleared');
  keyed.emit(text, 'cleared');
}
const zeroBus = new EventBus();
let zeroCalls = 0;
zeroBus.on(-0, () => zeroCalls++);
zeroBus.emit(0, {});
assert.equal(zeroCalls, 1, 'numeric -0 and 0 share a channel, like Map');
const failure = new Error('numeric event failure');
const reported = [];
const errors = new EventBus((key, error) => reported.push([key, error]));
errors.on(1, () => {
  throw failure;
});
errors.on('1', () => assert.fail('numeric error crossed to string key'));
assert.throws(
  () => errors.emit(1, {}),
  (error) => error === failure
);
assert.deepEqual(reported, [[1, failure]]);

// UI caches are allocated once; duplicate writes still stay out of the DOM.
let styles = 0,
  classes = 0;
const element = {
  style: {
    setProperty() {
      styles++;
    },
  },
  classList: {
    toggle() {
      classes++;
    },
  },
};
for (const key of ['color', 'constructor', '__proto__']) {
  setStyle(element, key, 'red');
  setStyle(element, key, 'red');
  setClass(element, key, true);
  setClass(element, key, true);
}
assert.equal(styles, 3);
assert.equal(classes, 3);
const styleCache = element._ows,
  classCache = element._owc;
setStyle(element, 'color', 'blue');
setClass(element, 'color', false);
assert.equal(styles, 4);
assert.equal(classes, 4);
assert.equal(element._ows, styleCache);
assert.equal(element._owc, classCache);
console.log(
  'type guards: boundary validation, concrete Three types, event keys and retained UI caches passed'
);
