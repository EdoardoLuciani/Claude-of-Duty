import assert from 'node:assert/strict';
import test from 'node:test';

import { identity, inverseAffine, multiply, planes, intersects } from './math.mjs';
import { decodeScene } from './scene.mjs';

test('affine inverse/product and defined singular result', () => {
  const a = identity(new Float64Array(16));
  a[0] = 2;
  a[5] = 3;
  a[10] = 4;
  a[12] = 7;
  a[13] = -2;
  a[14] = 5;
  const out = multiply(new Float64Array(16), a, inverseAffine(new Float64Array(16), a));
  const expected = identity(new Float64Array(16));
  for (let i = 0; i < 16; i++) assert(Math.abs(out[i] - expected[i]) < 1e-12);
  assert.deepEqual(inverseAffine(new Float64Array(16), new Float64Array(16)), new Float64Array(16));
});
test('WebGPU near plane is z >= 0, not OpenGL z >= -w', () => {
  const frustum = new Float64Array(24),
    world = identity(new Float64Array(16));
  planes(world, frustum);
  assert(intersects([0, 0, 0.5, 0.01], world, frustum));
  assert(!intersects([0, 0, -0.5, 0.01], world, frustum));
  assert(!intersects([0, 0, 1.5, 0.01], world, frustum));
});
function fixture() {
  const buffer = new ArrayBuffer(120 * 64 * 4 + 16);
  const empty = { offset: 0, bytes: 0 };
  return {
    buffer,
    meta: {
      version: 1,
      frameCount: 120,
      nodes: [{ parent: -1, matrix: [...identity(new Float64Array(16))] }],
      meshes: [{ node: 0, scene: 0 }],
      skeletons: [{}],
      geometries: [],
      dynamic: [],
      frames: empty,
      visibility: empty,
      cameras: { offset: 0, bytes: 120 * 64 * 4 },
    },
  };
}
test('recording decoder constructs three shadows and typed frame views', () => {
  const { meta, buffer } = fixture(),
    scene = decodeScene(meta, buffer);
  assert.equal(scene.shadows.length, 3);
  assert.equal(scene.cameras.length, 120 * 64);
  assert.equal(scene.binary, buffer);
});
test('recording decoder rejects versions, cycles, misalignment and truncation', () => {
  for (const mutate of [
    (m) => (m.version = 2),
    (m) => (m.nodes[0].parent = 0),
    (m) => (m.cameras.offset = 1),
    (m) => (m.cameras.bytes += 64),
  ]) {
    const { meta, buffer } = fixture();
    mutate(meta);
    assert.throws(() => decodeScene(meta, buffer));
  }
});
