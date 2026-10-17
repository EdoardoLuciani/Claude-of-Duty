import assert from 'node:assert/strict';

import { PNG } from 'pngjs';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Actual GLTFLoader/geometry/animation; only image decoding is stubbed in Node. */
export function parseGLB(bytes) {
  const loader = new GLTFLoader().register(() => ({
    name: 'NODE_TEXTURE_STUB',
    loadTexture: () => Promise.resolve(new Texture()),
  }));
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  );
}

/** Raw container assertions stay independent of the runtime loader. */
export function inspectGLB(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  assert.equal(json.asset.version, '2.0');
  assert.equal(bytes.readUInt32LE(24 + length), 0x004e4942);
  const bin = bytes.subarray(28 + length);
  assert.equal(bytes.readUInt32LE(20 + length), bin.length);
  const formats = {
    5126: ['readFloatLE', 4],
    5125: ['readUInt32LE', 4],
    5123: ['readUInt16LE', 2],
  };
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function accessor(index) {
    const a = json.accessors[index];
    assert.ok(a && !a.sparse);
    assert.ok(formats[a.componentType] && widths[a.type], 'supported accessor format');
    const [read, size] = formats[a.componentType];
    const width = widths[a.type];
    const view = json.bufferViews[a.bufferView];
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const stride = view.byteStride ?? width * size;
    const values = new Float64Array(a.count * width);
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < width; j++) {
        const offset = start + i * stride + j * size;
        assert.ok(offset + size <= (view.byteOffset ?? 0) + view.byteLength);
        const value = bin[read](offset);
        assert.ok(Number.isFinite(value));
        values[i * width + j] = value;
      }
    return values;
  }
  function imagePNG(image) {
    assert.equal(image.uri, undefined);
    assert.ok(Number.isInteger(image.bufferView), 'embedded image');
    const view = json.bufferViews[image.bufferView];
    const start = view.byteOffset ?? 0;
    return PNG.sync.read(bin.subarray(start, start + view.byteLength));
  }
  return { json, bin, accessor, imagePNG };
}
