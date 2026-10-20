import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  Matrix4,
  Vector3,
  Quaternion,
  Sphere,
  Frustum,
  WebGPUCoordinateSystem,
} from 'three/webgpu';

import { identity, inverseAffine, multiply, planes, intersects } from './math.js';
const root = process.argv[2] || './direct-webgpu-data';
let checks = 0;
for (let i = 1; i <= 40; i++) {
  const m = new Matrix4().compose(
    new Vector3(i, -i / 3, i * 2),
    new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), i / 17),
    new Vector3(i % 2 ? -2 : 2, 0.5, 3)
  );
  const n = new Matrix4().makeTranslation(-i, i / 2, -i / 4),
    actual = multiply(new Float64Array(16), m.elements, n.elements),
    expected = new Matrix4().multiplyMatrices(m, n).elements;
  for (let j = 0; j < 16; j++) assert(Math.abs(actual[j] - expected[j]) < 1e-10);
  const inverse = inverseAffine(new Float64Array(16), m.elements),
    reference = m.clone().invert().elements;
  for (let j = 0; j < 16; j++) assert(Math.abs(inverse[j] - reference[j]) < 1e-10);
  const product = multiply(new Float64Array(16), m.elements, inverse),
    unit = identity(new Float64Array(16));
  for (let j = 0; j < 16; j++) assert(Math.abs(product[j] - unit[j]) < 1e-10);
  checks += 3;
}
for (const agents of [5, 12]) {
  const meta = JSON.parse(await readFile(`${root}/scene-${agents}.json`, 'utf8')),
    bytes = await readFile(`${root}/scene-${agents}.bin`);
  const world = [];
  for (let i = 0; i < meta.nodes.length; i++) {
    const n = meta.nodes[i];
    assert(n.parent < i);
    assert(n.matrix.every(Number.isFinite));
    const w = new Float64Array(n.matrix);
    if (n.parent >= 0) multiply(w, world[n.parent], n.matrix);
    world.push(w);
  }
  // Check WebGPU zero-to-one plane extraction on actual exported mesh bounds.
  const camera = new Matrix4().makePerspective(
    -0.1,
    0.1,
    0.06,
    -0.06,
    0.1,
    300,
    WebGPUCoordinateSystem
  );
  const frustum = new Frustum().setFromProjectionMatrix(camera, WebGPUCoordinateSystem),
    p = new Float64Array(24);
  planes(camera.elements, p);
  for (const m of meta.meshes) {
    const s = new Sphere(new Vector3(...m.sphere.slice(0, 3)), m.sphere[3]).applyMatrix4(
      new Matrix4().fromArray(world[m.node])
    );
    assert.equal(intersects(m.sphere, world[m.node], p), frustum.intersectsSphere(s));
    assert(!m.name.startsWith('fx-'));
    const g = meta.geometries[m.geometry];
    for (const r of m.ranges) {
      assert(r.start >= 0 && r.start + r.count <= g.indices);
      assert.equal(r.count % 3, 0);
    }
    checks++;
  }
  assert.equal(meta.frameCount, 120);
  assert(bytes.byteLength > 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = meta.frames.offset; at < meta.frames.offset + meta.frames.bytes; at += 4)
    assert(Number.isFinite(view.getFloat32(at, true)));
  console.log({
    agents,
    nodes: meta.nodes.length,
    meshes: meta.meshes.length,
    groups: meta.meshes.reduce((n, m) => n + m.ranges.length, 0),
    skeletons: meta.skeletons.length,
    dynamicNodes: meta.dynamic.length,
    bytes: bytes.byteLength,
  });
}
console.log(`${checks} math/frustum/mesh checks passed`);
