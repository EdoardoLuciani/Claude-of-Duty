import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

import { Box3, Mesh, Raycaster, Vector3 } from 'three';

import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const asset = new URL('../../assets/attachments/eotech-exps3-0/', import.meta.url);
const bytes = readFileSync(new URL('exps3-0.glb', asset));
const manifest = JSON.parse(readFileSync(new URL('manifest.json', asset), 'utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
assert.equal(
  createHash('sha256')
    .update(readFileSync(new URL('../../tools/blender/exps3.py', import.meta.url)))
    .digest('hex'),
  manifest.sourceSha256,
  'committed asset was built from the current Blender source'
);
const blend = readFileSync(new URL('exps3-0.blend', asset));
// Blender 5.2 saves Zstandard-compressed .blend products by default.
const unpacked = blend.subarray(0, 7).toString() === 'BLENDER' ? blend : zstdDecompressSync(blend);
assert.equal(unpacked.subarray(0, 7).toString(), 'BLENDER');
const { json, imagePNG } = inspectGLB(bytes);
assert.equal(json.animations, undefined, 'static attachment has no weapon/hand animation tracks');
assert.equal(json.cameras, undefined);
assert(!json.extensions?.KHR_lights_punctual, 'review studio never enters the runtime asset');
assert.equal(json.buffers.length, 1);
assert.equal(json.buffers[0].uri, undefined, 'runtime geometry is local and embedded');
assert.equal(json.images.length, 2);
for (const image of json.images) {
  const png = imagePNG(image);
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
}
const primitives = json.meshes.flatMap((mesh) => mesh.primitives);
const triangles = primitives.reduce((sum, p) => sum + json.accessors[p.indices].count / 3, 0);
assert.equal(triangles, manifest.stats.triangles);
assert(triangles < 45000 && primitives.length <= 14 && json.materials.length <= 10);
assert(bytes.length < 5 * 1024 * 1024);
for (const primitive of primitives) {
  assert(primitive.attributes.NORMAL !== undefined);
  assert(primitive.attributes.TEXCOORD_0 !== undefined);
}

const gltf = await parseGLB(bytes);
gltf.scene.updateMatrixWorld(true);
const root = gltf.scene.getObjectByName('ATTACHMENT_exps3');
assert(root, 'one independently removable attachment root');
const size = new Box3().setFromObject(root).getSize(new Vector3()).multiplyScalar(1000);
// Declared visual envelope differs from the rounded manufacturer nominal by
// +0.14mm in width (raised cap marking) and -0.03mm in length; height is exact.
for (const [value, expected] of size.toArray().map((v, i) => [v, [58.54, 73.7, 96.47][i]]))
  assert(Math.abs(value - expected) < 0.00002, 'native-metre exported envelope');
for (const [name, expected] of [
  ['SOCKET_mount', [0, 0, 0]],
  ['SOCKET_sight', [0, 0.046, 0.0231]],
  ['SOCKET_lens_rear', [0, 0.046, 0.0231]],
  ['SOCKET_lens_front', [0, 0.046, -0.0181]],
]) {
  const node = root.getObjectByName(name);
  assert(node && node.parent === root, name + ' belongs to the removable assembly');
  assert(node.getWorldPosition(new Vector3()).distanceTo(new Vector3(...expected)) < 1e-8);
}
const meshes = [];
root.traverse((node) => {
  if (node instanceof Mesh) meshes.push(node);
});
const glass = ['rear', 'front'].map((side) => root.getObjectByName('OPTIC_glass_' + side));
for (const [i, pane] of glass.entries()) {
  assert(pane instanceof Mesh);
  assert.equal(pane.material.transmission, 1);
  assert.equal(pane.material.ior, 1.5);
  const thickness = new Box3().setFromObject(pane).getSize(new Vector3()).z * 1000;
  assert(
    Math.abs(thickness - [4.76, 3.17][i]) < 0.00002,
    'manual-backed physical window thickness'
  );
}
const opaque = meshes.filter((mesh) => !glass.includes(mesh));
for (const x of [-0.012, 0, 0.012]) {
  for (const y of [0.038, 0.046, 0.054]) {
    const ray = new Raycaster(new Vector3(x, y, 0.1), new Vector3(0, 0, -1), 0, 0.2);
    assert.equal(
      ray.intersectObjects(opaque, false).length,
      0,
      'optical aperture is real, not painted'
    );
  }
}
assert.deepEqual(manifest.reticle, { ringMoa: 68, dotMoa: 1, geometryBaked: false });
root.removeFromParent();
assert(!gltf.scene.getObjectByName('OPTIC_glass_front'), 'removal cannot leave floating glass');
assert(!gltf.scene.getObjectByName('SOCKET_sight'), 'removal cannot leave floating sight datums');
console.log(
  'EXPS3: authored asset provenance, budgets, metres/axes, removable assembly and open optical bore passed.'
);
