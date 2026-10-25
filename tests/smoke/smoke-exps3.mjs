import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

import { Box3, DoubleSide, Mesh, Raycaster, Vector3 } from 'three';

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
  ['SOCKET_sight', [0, 0.0482, 0.0231]],
  ['SOCKET_lens_rear', [0, 0.0482, 0.0231]],
  ['SOCKET_lens_front', [0, 0.0482, -0.0181]],
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
  const dimensions = new Box3().setFromObject(pane).getSize(new Vector3()).multiplyScalar(1000);
  assert(
    Math.abs(dimensions.x - 30) < 0.00002 && Math.abs(dimensions.y - 23) < 0.00002,
    'physical 30×23mm pane is not shrunk to conceal an obstruction'
  );
  const thickness = dimensions.z;
  assert(
    Math.abs(thickness - [4.76, 3.17][i]) < 0.00002,
    'manual-backed physical window thickness'
  );
}
assert.deepEqual(manifest.opticalWindow.nominalPaneMm, [30, 23]);
assert.deepEqual(manifest.opticalWindow.clearOpeningMm, [30, 22]);
assert.equal(manifest.opticalWindow.centreAboveArtDatumMm, 48.2);
assert.equal(manifest.opticalWindow.axialLowerClearanceMm, 0.5);
const opaque = meshes.filter((mesh) => !glass.includes(mesh));
for (const mesh of opaque) {
  // Count both face directions: back-face culling must not conceal an obstruction.
  mesh.material.side = DoubleSide;
  mesh.geometry.computeBoundingBox();
}
const ray = new Raycaster(new Vector3(), new Vector3(), 0, 0.2);
const hits = [];
let checked = 0;
const inside = (x, y) => {
  const dx = Math.max(Math.abs(x) - (15 - 5.4), 0);
  const dy = Math.max(Math.abs(y - 48.2) - (11 - 5.4), 0);
  return (
    Math.abs(x) <= 14.95 && Math.abs(y - 48.2) <= 10.95 && dx * dx + dy * dy < (5.4 - 0.05) ** 2
  );
};
const check = (x, y) => {
  if (!inside(x, y)) return;
  for (const direction of [-1, 1]) {
    ray.ray.origin.set(x / 1000, y / 1000, -direction * 0.1);
    ray.ray.direction.set(0, 0, direction);
    hits.length = 0;
    ray.intersectObjects(opaque, false, hits);
    assert.equal(hits.length, 0, `unobstructed clear opening from ${direction}: x=${x}mm y=${y}mm`);
    checked++;
  }
};
// Cover the rounded opening, not just a sparse rectangle above the battery roof.
for (let x = -14.95; x <= 14.95; x += 1) {
  for (let y = 37.25; y <= 59.15; y += 1) check(x, y);
}
// Extra resolution at the former clipping edge: the old roof blocked 37.25/37.5 mm.
for (let x = -14.95; x <= 14.95; x += 0.25) {
  for (const y of [37.25, 37.5, 37.75]) check(x, y);
}
assert(checked > 1500, 'regression samples the complete clear opening and lower edge');
ray.ray.origin.set(0, 0.1, -0.04);
ray.ray.direction.set(0, -1, 0);
hits.length = 0;
ray.intersectObjects(opaque, false, hits);
assert(hits.length > 0, 'probe reaches the actual battery roof');
assert(Math.abs(hits[0].point.y - 0.0367) < 2e-8, 'actual roof is relieved, not just metadata');
assert(
  Math.abs(0.0482 - 0.022 / 2 - hits[0].point.y - 0.0005) < 2e-8,
  'clear opening has a physical 0.5mm axial lower margin'
);
assert.deepEqual(manifest.reticle, { ringMoa: 68, dotMoa: 1, geometryBaked: false });
root.removeFromParent();
assert(!gltf.scene.getObjectByName('OPTIC_glass_front'), 'removal cannot leave floating glass');
assert(!gltf.scene.getObjectByName('SOCKET_sight'), 'removal cannot leave floating sight datums');
console.log(
  'EXPS3: authored asset provenance, budgets, metres/axes, removable assembly and open optical bore passed.'
);
