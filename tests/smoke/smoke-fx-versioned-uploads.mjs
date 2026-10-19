import assert from 'node:assert/strict';

import * as THREE from 'three';
import Attributes from 'three/src/renderers/common/Attributes.js';
import { AttributeType } from 'three/src/renderers/common/Constants.js';
import WebGPUAttributeUtils from 'three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js';

import { DecalSystem } from '../../src/fx/decals.ts';
import { ParticleLayer, STRIDE, disposeQuadSource, resetSpawn } from '../../src/fx/particles.ts';

// Exercise the pinned renderer's real version/range decisions. Only the GPU
// device is replaced, with mapped-at-creation storage and a recording queue.
function uploadHarness() {
  const data = new WeakMap();
  const writes = [];
  const backend = {
    get(attribute) {
      if (!data.has(attribute)) data.set(attribute, {});
      return data.get(attribute);
    },
    getBufferAttribute(attribute) {
      return attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
    },
    createAttribute(attribute) {
      this.get(attribute).buffer = attribute.array.slice();
    },
    updateAttribute(attribute) {
      utils.updateAttribute(attribute);
    },
    destroyAttribute() {},
    device: {
      queue: {
        writeBuffer(buffer, offset, array, start = 0, count = array.length - start) {
          buffer.set(array.subarray(start, start + count), offset / array.BYTES_PER_ELEMENT);
          writes.push({ offset, count });
        },
      },
    },
  };
  const utils = new WebGPUAttributeUtils(backend);
  const manager = new Attributes(backend, { createAttribute() {}, destroyAttribute() {} });
  return {
    writes,
    update(attributes) {
      for (const attribute of attributes) manager.update(attribute, AttributeType.VERTEX);
    },
    resident(attributes) {
      for (const attribute of attributes)
        assert.deepEqual(backend.get(attribute).buffer, attribute.array, 'GPU matches CPU storage');
    },
    dispose() {
      manager.dispose();
    },
  };
}

const negative = process.argv.find((arg) => arg.startsWith('--negative='))?.split('=')[1];
assert.ok(!negative || ['particle', 'decal'].includes(negative));
const texture = new THREE.Texture();
try {
  for (const mode of ['additive', 'lit', 'distort']) {
    const layer = new ParticleLayer({ capacity: 16, mode, atlas: texture, cols: 4 });
    const harness = uploadHarness();
    const attributes = [layer.ibuf];
    try {
      assert.equal(layer.ibuf.usage, THREE.StaticDrawUsage);
      harness.update(attributes);
      layer.flush(0);
      harness.update(attributes);
      assert.equal(harness.writes.length, 0, 'An empty unchanged ring does not upload');
      for (let i = 0; i < layer.capacity + 3; i++) {
        const s = resetSpawn();
        s.x = i + 1;
        s.life = 2;
        s.delay = i % 2 ? 0.5 : 0;
        const slot = layer.emit(s, i / 100);
        if (negative === 'particle') {
          layer._dirtyLo = Infinity;
          layer._dirtyHi = -Infinity;
        }
        const version = layer.ibuf.version;
        layer.flush(i / 100);
        assert.equal(layer.ibuf.version, version + 1);
        harness.update(attributes);
        harness.resident(attributes);
        assert.deepEqual(harness.writes.at(-1), { offset: slot * STRIDE * 4, count: STRIDE });
        const writes = harness.writes.length;
        layer.flush(i / 100 + 0.01);
        harness.update(attributes);
        assert.equal(harness.writes.length, writes, 'Time alone does not upload slot data');
        assert.equal(layer.uniforms.uTime.value, i / 100 + 0.01);
      }
      assert.equal(layer.geometry.instanceCount, layer.capacity, 'Ring wrap retains full capacity');
      const writes = harness.writes.length;
      layer.flush(100);
      harness.update(attributes);
      assert.equal(layer.mesh.visible, false, 'Expired particles hide without rewriting storage');
      assert.equal(harness.writes.length, writes);
      layer.emit(resetSpawn(), 101);
      layer.flush(101.1);
      harness.update(attributes);
      harness.resident(attributes);
      assert.equal(layer.mesh.visible, true, 'A new emission revives an expired ring');
      // Multiple flushes without a draw must retain all pending spans.
      layer.cursor = layer.capacity - 1;
      layer.emit(resetSpawn(), 102);
      layer.flush(102);
      layer.emit(resetSpawn(), 102);
      layer.flush(102);
      assert.equal(layer.ibuf.updateRanges.length, 2);
      harness.update(attributes);
      harness.resident(attributes);
      assert.equal(layer.ibuf.updateRanges.length, 0);
    } finally {
      harness.dispose();
      layer.dispose();
    }
  }

  const decals = new DecalSystem({
    capacity: 8,
    cols: 4,
    albedo: texture,
    normal: texture,
    orm: texture,
  });
  const harness = uploadHarness();
  const attributes = [decals.aPos, decals.aNrm, decals.aUv, decals.aDec];
  const world = {
    triCount: 2,
    candidates: new Uint32Array([0, 1]),
    pos: new Float32Array([-2, -2, -2, 2, -2, -2, 2, 2, -2, -2, -2, -2, 2, 2, -2, -2, 2, -2]),
    nrm: new Float32Array([0, 0, 1, 0, 0, 1]),
    queryAabb: () => 2,
  };
  try {
    for (const attribute of attributes) assert.equal(attribute.usage, THREE.StaticDrawUsage);
    harness.update(attributes);
    const options = {
      point: new THREE.Vector3(0, 0, -2),
      normal: new THREE.Vector3(0, 0, 1),
      size: 1,
      tile: 0,
      life: 2,
      world,
      now: 0,
    };
    for (let i = 0; i < decals.capacity; i++) {
      options.now = i / 100;
      assert.ok(decals.add(options));
      if (negative === 'decal') {
        decals._dirtyLo = Infinity;
        decals._dirtyHi = -Infinity;
      }
      decals.flush(options.now);
      harness.update(attributes);
      harness.resident(attributes);
      const writes = harness.writes.length;
      decals.flush(options.now + 0.01);
      harness.update(attributes);
      assert.equal(harness.writes.length, writes, 'Decal fading does not upload vertex data');
      assert.equal(decals.uNow.value, options.now + 0.01);
      for (const attribute of attributes) assert.equal(attribute.updateRanges.length, 0);
    }
    assert.ok(
      decals.pos.slice(18, 36).some((v) => v !== 0),
      'Clipped slot has more than six vertices'
    );
    assert.equal(decals.cursor, 0);
    // Recycle a larger clipped decal into a six-vertex fallback quad.
    assert.ok(decals.add({ ...options, world: null, now: 1 }));
    decals.flush(1);
    harness.update(attributes);
    harness.resident(attributes);
    assert.ok(decals.pos.slice(18, decals.vertsPerDecal * 3).every((v) => v === 0));
    assert.equal(decals.geometry.drawRange.count, decals.capacity * decals.vertsPerDecal);
    const writes = harness.writes.length;
    decals.flush(100);
    harness.update(attributes);
    assert.equal(decals.mesh.visible, false);
    assert.equal(harness.writes.length, writes);
    decals.add({ ...options, now: 101 });
    decals.flush(101);
    harness.update(attributes);
    harness.resident(attributes);
    assert.equal(decals.mesh.visible, true);
  } finally {
    harness.dispose();
    decals.dispose();
  }
} finally {
  disposeQuadSource();
  texture.dispose();
}
console.log(
  'Version-driven FX uploads preserve dirty spans, wrap, replacement, expiry and revival'
);
