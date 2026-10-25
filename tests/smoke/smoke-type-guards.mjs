import assert from 'node:assert/strict';

import { BufferGeometry, Group, Mesh, MeshBasicMaterial, SkinnedMesh, Texture } from 'three';
import { float, vec3, vec4 } from 'three/tsl';

import { hasOwn, isClosable, isImageBitmap, isRecord } from '../../src/core/guards.ts';
import { EventBus } from '../../src/core/registry.ts';
import {
  isMesh,
  isSingleMaterialMesh,
  isSkinnedMesh,
  isTexture,
} from '../../src/core/three-guards.ts';
import { SURFACE, SURFACE_NAMES } from '../../src/physics/surfaces.ts';
import { createFogCompute } from '../../src/render/fog-compute-webgpu.ts';
import { setClass, setStyle } from '../../src/ui/util.ts';

for (const value of [null, undefined, 1, 'value', [], () => {}]) {
  assert.equal(isRecord(value), false);
  assert.equal(isImageBitmap(value), false);
  assert.equal(isClosable(value), false);
}
assert.equal(isRecord({ value: 1 }), true);
assert.equal(hasOwn({ value: 1 }, 'value'), true);
assert.equal(hasOwn({ value: 1 }, 'constructor'), false);
assert.equal(hasOwn({ value: 1 }, '__proto__'), false);
const image = { width: 2, height: 2, close() {} };
assert.equal(isImageBitmap(image), true);
assert.equal(isImageBitmap({ ...image, width: '2' }), false);
assert.equal(isImageBitmap({ ...image, close: true }), false);
assert.equal(isClosable({ close() {} }), true);

const geometry = new BufferGeometry();
const material = new MeshBasicMaterial();
const mesh = new Mesh(geometry, material);
assert.equal(isMesh(mesh), true);
assert.equal(isSingleMaterialMesh(mesh), true);
assert.equal(isSingleMaterialMesh(new Mesh(geometry, [material])), false);
assert.equal(isMesh(new Group()), false);
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
