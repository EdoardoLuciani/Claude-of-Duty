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
// Probe shipped opaque surfaces, not just named empties or recipe metadata.
const firstOpaque = (origin, direction) => {
  ray.ray.origin.set(...origin);
  ray.ray.direction.set(...direction);
  hits.length = 0;
  ray.intersectObjects(opaque, false, hits);
  assert(hits.length > 0, 'exterior detail probe reaches the assembly');
  return hits[0].point.clone().multiplyScalar(1000);
};
const fromRight = (forward, height) =>
  firstOpaque([0.1, height / 1000, -forward / 1000], [-1, 0, 0]).x;
const fromRear = (x, height) => firstOpaque([x / 1000, height / 1000, 0.1], [0, 0, -1]).z;
for (const [forward, height] of [
  [-9, 30],
  [20, 21],
]) {
  const rim = fromRight(forward + 11.7, height);
  const face = fromRight(forward, height + 3);
  const slot = fromRight(forward, height);
  assert(rim - face > 2, 'adjustment face sits inside an actual hood opening');
  assert(face - slot > 0.4, 'adjustment tool slot has physical depth');
  assert(
    fromRight(forward + 7.5, height) - fromRight(forward + 9.5, height) > 0.7,
    'moulded adjustment annulus is domed rather than a flat applied disc'
  );
  // Interior samples catch an arrowhead whose corners are raised but centre is buried.
  for (let i = 1; i < 7; i++) {
    for (let j = 1; j < 8 - i; j++) {
      const a = i / 8,
        b = j / 8,
        c = 1 - a - b;
      const dy = -8.1 * a - 7 * b - 6.3 * c;
      const dz = 1.1 * a + 2.7 * b + 1.2 * c;
      const radius = Math.hypot(dy, dz);
      const dial =
        radius <= 7.5 ? 23.8 - ((radius - 5.75) * 0.2) / 1.75 : 23.6 - (radius - 7.5) * 0.5;
      assert(
        fromRight(forward + dy, height + dz) - dial > 0.03,
        'moulded arrowhead stays above the domed dial interior'
      );
    }
  }
}
for (const x of [-15.3, 15.3]) {
  const boss = fromRear(x, -1.7);
  const head = fromRear(x + 1.9, 2);
  assert(Math.abs(boss - 35.77) < 0.00002, 'rounded lower boss extends below the old cover');
  assert(boss - head > 0.35, 'lower screw head is counterbored inside its cast boss');
  assert(35 - fromRear(x + 1.9, 28) > 0.45, 'upper screw is recessed into the cover');
}
const castRelief = fromRear(-2.5, 23) - 35;
assert(
  castRelief > 0.08 && castRelief < 0.16,
  'rear mark is shallow seated cast relief, not a floating badge'
);
assert(
  fromRight(43.2, 23) - fromRight(46.2, 23) > 0.8,
  'battery cap tool groove is cut into its face'
);
assert(25 - fromRight(13, 0) > 0.9, 'tension nut has a real central recess');
let planarSkirtCorners = 0;
let capRadius = 0;
let mouthRadius = 0;
const point = new Vector3();
const normal = new Vector3();
for (const mesh of opaque) {
  const hood = mesh.material.name.startsWith('01 |');
  const casting = mesh.material.name.startsWith('02 |');
  if (!hood && !casting) continue;
  const positions = mesh.geometry.attributes.position;
  const normals = mesh.geometry.attributes.normal;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).multiplyScalar(1000);
    if (hood) {
      normal.fromBufferAttribute(normals, i);
      assert(Math.abs(normal.lengthSq() - 1) < 1e-5, 'hood has no zero-length split normals');
      normal.transformDirection(mesh.matrixWorld);
      if (
        Math.abs(point.x - 26) < 0.00002 &&
        point.y >= 3.69 &&
        point.y <= 8.01 &&
        -point.z >= -34.01 &&
        -point.z <= 1.51 &&
        normal.x > 0.5
      ) {
        assert(
          normal.x > 0.99999,
          'stepped sheet-metal face has a planar normal, not a curved highlight'
        );
        planarSkirtCorners++;
      }
      if (point.x > 26.1 && point.x < 29.21)
        capRadius = Math.max(capRadius, Math.hypot(-point.z - 46.2, point.y - 23));
    }
    if (
      casting &&
      point.x > 25.79 &&
      point.x < 27.11 &&
      point.y < 18 &&
      -point.z >= 32 &&
      -point.z <= 60.31
    )
      mouthRadius = Math.max(mouthRadius, Math.hypot(-point.z - 46.2, point.y - 23));
  }
}
assert(planarSkirtCorners >= 5, 'regression reaches the actual stepped hood face');
assert(
  // Native measured peak after the authored 0.08mm edge rounding, not nominal radius.
  Math.abs(capRadius - 11.74818) < 0.00002,
  `cap/grip radius ${capRadius}mm follows the revised photo estimate; mouth=${mouthRadius}mm`
);
assert(
  Math.abs(mouthRadius / capRadius - 1.2) < 0.001, // small cap-edge rounding; photo ratio is approximate
  'surrounding retaining mouth remains visibly broader than the cap'
);
for (const [prefix, roughness, strength] of [
  ['01 |', 0.86, 0.22],
  ['02 |', 1, 0.65],
  ['03 |', 0.94, 0.22],
]) {
  const material = json.materials.find((m) => m.name.startsWith(prefix));
  assert(Math.abs((material.pbrMetallicRoughness.roughnessFactor ?? 1) - roughness) < 1e-7);
  assert(
    Math.abs(material.normalTexture.scale - strength) < 1e-7,
    'native glTF retains authored finish separation'
  );
}
assert.deepEqual(manifest.reticle, { ringMoa: 68, dotMoa: 1, geometryBaked: false });
root.removeFromParent();
assert(!gltf.scene.getObjectByName('OPTIC_glass_front'), 'removal cannot leave floating glass');
assert(!gltf.scene.getObjectByName('SOCKET_sight'), 'removal cannot leave floating sight datums');
console.log(
  'EXPS3: authored asset provenance, budgets, metres/axes, removable assembly and open optical bore passed.'
);
