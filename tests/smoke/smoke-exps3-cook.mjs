import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Box3, DoubleSide, Raycaster, Vector3 } from 'three';
import {
  read as readKTX,
  KHR_DF_MODEL_UASTC,
  KHR_SUPERCOMPRESSION_ZSTD,
} from 'three/examples/jsm/libs/ktx-parse.module.js';

import { MODEL_COOKS } from '../../build/models.mjs';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/attachments/eotech-exps3-0/', import.meta.url);
const nativeBytes = readFileSync(new URL('exps3-0.glb', dir));
const bytes = readFileSync(new URL('exps3-0.runtime.glb', dir));
const native = inspectGLB(nativeBytes),
  cooked = inspectGLB(bytes);
assert.deepEqual(MODEL_COOKS.exps3, {
  directory: 'assets/attachments/eotech-exps3-0',
  source: 'exps3-0.glb',
  output: 'exps3-0.runtime.glb',
  flags: ['-si', '0.50', '-se', '0.0002', '-sp'],
});
for (const extension of ['KHR_texture_basisu', 'EXT_meshopt_compression', 'KHR_mesh_quantization'])
  assert(cooked.json.extensionsRequired.includes(extension));
assert(!cooked.json.extensionsUsed.includes('KHR_texture_transform'));
assert.equal(cooked.json.animations, undefined);
assert.equal(cooked.json.cameras, undefined);
assert.equal(cooked.json.materials.length, 2);
assert.equal(cooked.json.meshes.flatMap((m) => m.primitives).length, 2);
assert.deepEqual(
  new Set(cooked.json.nodes.map((n) => n.name)),
  new Set(native.json.nodes.map((n) => n.name))
);
assert(bytes.length < nativeBytes.length);
assert.equal(cooked.json.images.length, 3);
for (const image of cooked.json.images) {
  assert.equal(image.mimeType, 'image/ktx2');
  assert.equal(image.uri, undefined);
  assert(native.json.images.some((n) => n.name === image.name));
  const view = cooked.json.bufferViews[image.bufferView];
  const ktx = readKTX(cooked.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength));
  assert.equal(ktx.pixelWidth, 1024);
  assert.equal(ktx.pixelHeight, 1024);
  assert.equal(ktx.levels.length, 11);
  assert.equal(ktx.supercompressionScheme, KHR_SUPERCOMPRESSION_ZSTD);
  const dfd = ktx.dataFormatDescriptor[0];
  assert.equal(dfd.colorModel, KHR_DF_MODEL_UASTC);
  assert.equal(dfd.transferFunction, image.name === 'exps3-base-color' ? 2 : 1);
  assert.equal(dfd.samples.length, 1);
  assert.equal(dfd.samples[0].channelType, 0, 'full RGB normal data, no shader reconstruction');
}
const source = await parseGLB(nativeBytes),
  runtime = await parseGLB(bytes);
source.scene.updateMatrixWorld(true);
runtime.scene.updateMatrixWorld(true);
const root = runtime.scene.getObjectByName('ATTACHMENT_exps3');
assert(root);
for (const name of ['SOCKET_mount', 'SOCKET_sight', 'SOCKET_lens_front', 'SOCKET_lens_rear']) {
  const node = root.getObjectByName(name),
    original = source.scene.getObjectByName(name);
  assert.equal(node.parent, root);
  assert(
    node.getWorldPosition(new Vector3()).distanceTo(original.getWorldPosition(new Vector3())) < 1e-9
  );
}
const body = root.getObjectByName('EXPS3_body'),
  glass = root.getObjectByName('EXPS3_glass');
assert(body.isMesh && glass.isMesh);
const triangles = (body.geometry.index.count + glass.geometry.index.count) / 3;
assert(
  triangles >= 11000 && triangles < 12000,
  'conservative EXPS3 simplification, not the P320 error limit'
);
assert.equal(body.material.roughnessMap, body.material.metalnessMap);
for (const mesh of [body, glass]) {
  const original = source.scene.getObjectByName(mesh.name);
  for (const key of ['roughness', 'metalness', 'transmission', 'ior', 'opacity'])
    assert(Math.abs((mesh.material[key] ?? 0) - (original.material[key] ?? 0)) < 1e-8, key);
  assert.equal(mesh.material.side, original.material.side);
  for (const key of ['r', 'g', 'b'])
    assert(Math.abs(mesh.material.color[key] - original.material.color[key]) < 1e-8);
  const a = new Box3().setFromObject(mesh, true),
    b = new Box3().setFromObject(original, true);
  assert(
    a.min.distanceTo(b.min) < 0.00001 && a.max.distanceTo(b.max) < 0.00001,
    'native-metre bounds within 10 micrometres'
  );
}
for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'])
  assert.equal(glass.material[key], null, 'glass remains texture-free');
assert.equal(glass.material.transmission, 1);
assert(body.geometry.attributes.tangent);
for (const value of body.geometry.attributes.uv.array) assert(value >= 0 && value <= 1);
for (const [i, sign] of [1, -1].entries()) {
  const bounds = new Box3(),
    position = glass.geometry.attributes.position;
  for (let v = 0; v < position.count; v++) {
    const point = new Vector3().fromBufferAttribute(position, v).applyMatrix4(glass.matrixWorld);
    if (Math.sign(point.z) === sign) bounds.expandByPoint(point);
  }
  const actual = bounds.getSize(new Vector3()).multiplyScalar(1000).toArray();
  for (const [axis, expected] of [30, 23, [4.76, 3.17][i]].entries())
    assert(
      Math.abs(actual[axis] - expected) < 0.005,
      'physical panes retain dimensions within float-position quantization'
    );
}
body.material.side = DoubleSide;
const ray = new Raycaster(new Vector3(), new Vector3(), 0, 0.2),
  hits = [];
let checked = 0;
// Include the rounded aperture's upper corners, which the P320 profile clips.
for (let x = -14.95; x <= 14.95; x += 0.5) {
  for (let y = 37.25; y <= 59.15; y += 0.5) {
    const dx = Math.max(Math.abs(x) - 9.6, 0),
      dy = Math.max(Math.abs(y - 48.2) - 5.6, 0);
    if (Math.abs(y - 48.2) > 10.95 || dx * dx + dy * dy >= 5.35 ** 2) continue;
    for (const direction of [-1, 1]) {
      ray.ray.origin.set(x / 1000, y / 1000, -direction * 0.1);
      ray.ray.direction.set(0, 0, direction);
      hits.length = 0;
      ray.intersectObject(body, false, hits);
      assert.equal(hits.length, 0, `cooked optical bore: x=${x} y=${y} direction=${direction}`);
      checked++;
    }
  }
}
assert(checked > 4900);
ray.ray.origin.set(0, 0.1, -0.04);
ray.ray.direction.set(0, -1, 0);
hits.length = 0;
ray.intersectObject(body, false, hits);
assert(hits.length);
assert(
  Math.abs(hits[0].point.y - 0.0367) < 0.000005,
  'roof retains the 0.5 mm axial margin within quantization'
);
// Keep the normal-mapped return above the previously observed subpixel failure.
for (const x of [-0.01, 0, 0.01]) {
  ray.ray.origin.set(x, 0.06655576, 0.1);
  ray.ray.direction.set(0, 0, -1);
  hits.length = 0;
  ray.intersectObject(body, false, hits);
  assert(hits.length);
  const hit = hits[0],
    uv = body.geometry.attributes.uv;
  assert(hit.face.normal.y < -0.7 && hit.face.normal.z > 0.6);
  const [a, b, c] = [hit.face.a, hit.face.b, hit.face.c].map((i) => [uv.getX(i), uv.getY(i)]);
  const twiceArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const longestEdge = Math.max(
    Math.hypot(a[0] - b[0], a[1] - b[1]),
    Math.hypot(b[0] - c[0], b[1] - c[1]),
    Math.hypot(c[0] - a[0], c[1] - a[1])
  );
  assert((twiceArea * 1024) / longestEdge > 1.9, 'cooked return retains its UV sampling floor');
}
console.log(
  `EXPS3 cook: ${triangles} triangles, UASTC/mips, sockets, physical panes and ${checked} clear-bore probes passed`
);
