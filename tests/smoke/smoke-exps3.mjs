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
assert.equal(
  createHash('sha256')
    .update(readFileSync(new URL('../../tools/blender/exps3_bake.py', import.meta.url)))
    .digest('hex'),
  manifest.bakeSourceSha256,
  'atlas came from the current native Blender bake recipe'
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
assert.equal(
  json.images.length,
  3,
  'only the three runtime atlases, not the high-source finish maps'
);
for (const image of json.images) {
  const png = imagePNG(image);
  const size = 1024;
  assert.equal(png.width, size);
  assert.equal(png.height, size);
}
const base = imagePNG(json.images.find((i) => i.name === 'exps3-base-color'));
let yellow = 0,
  print = 0;
for (let i = 0; i < base.data.length; i += 4) {
  const r = base.data[i],
    g = base.data[i + 1],
    b = base.data[i + 2];
  if (r > 150 && g > 100 && b < 100 && r > b * 2) yellow++;
  if (r > 180 && g > 180 && b > 180) print++;
}
assert(yellow > 500, 'warning label survives in the baked base-color atlas');
assert(print > 500, 'white lettering and print survive without separate decal primitives');
const orm = imagePNG(json.images.find((i) => i.name === 'exps3-orm'));
let minRough = 255,
  maxRough = 0,
  minMetal = 255,
  maxMetal = 0;
for (let i = 0; i < orm.data.length; i += 4) {
  minRough = Math.min(minRough, orm.data[i + 1]);
  maxRough = Math.max(maxRough, orm.data[i + 1]);
  minMetal = Math.min(minMetal, orm.data[i + 2]);
  maxMetal = Math.max(maxMetal, orm.data[i + 2]);
}
assert(
  minRough < 100 && maxRough > 180 && minMetal < 10 && maxMetal > 245,
  'one atlas material retains distinct rubber, ink and metal responses'
);
const primitives = json.meshes.flatMap((mesh) => mesh.primitives);
const triangles = primitives.reduce((sum, p) => sum + json.accessors[p.indices].count / 3, 0);
assert.equal(triangles, manifest.stats.triangles);
assert(triangles <= 12000, 'approved 8–12k target, not the former 45k budget');
assert.equal(primitives.length, 2);
assert.equal(json.materials.length, 2);
assert.equal(manifest.optimization.highSourceTriangles, 44617);
assert.equal(manifest.optimization.targetTriangles, triangles);
assert.equal(manifest.optimization.decodedTextureBytesRGBA8, 12 * 1024 * 1024);
assert.deepEqual(manifest.optimization.atlas, {
  baseColor: [1024, 1024],
  normal: [1024, 1024],
  orm: [1024, 1024],
});
assert(
  manifest.optimization.uvAllocation.print.texelsPerMm >
    manifest.optimization.uvAllocation.plain.texelsPerMm * 4
);
assert(
  manifest.optimization.uvAllocation.relief.texelsPerMm >
    manifest.optimization.uvAllocation.plain.texelsPerMm * 2
);
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
// The cap's former 0.14mm raised polarity print is now a texture. Nominal
// body width is58.4mm; height/length and optical/mount datums are not rescaled.
for (const [value, expected] of size.toArray().map((v, i) => [v, [58.4, 73.7, 96.47][i]]))
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
assert.equal(meshes.length, 2);
const body = root.getObjectByName('EXPS3_body');
const glass = root.getObjectByName('EXPS3_glass');
assert(body instanceof Mesh && glass instanceof Mesh);
assert.equal(
  body.material.transmission ?? 0,
  0,
  'opaque body does not enter transmission rendering'
);
assert.equal(body.material.roughness, 1, 'roughness is fully baked per texel');
assert.equal(
  body.material.metalness,
  1,
  'metal/rubber masks are not attenuated by a global scalar'
);
assert.equal(glass.material.transmission, 1);
assert.equal(glass.material.ior, 1.5);
for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'])
  assert.equal(glass.material[key], null, 'constant optical glass needs no texture allocation');
assert(
  body.material.map &&
    body.material.normalMap &&
    body.material.roughnessMap &&
    body.material.metalnessMap
);
assert(
  body.geometry.attributes.tangent,
  'native Mikk tangents accompany the baked tangent-space normal map'
);
for (const value of body.geometry.attributes.uv.array)
  assert(value >= 0 && value <= 1, 'unique packed UV atlas is in bounds');
// Merging the two panes into one primitive must not change either physical pane.
for (const [i, sign] of [1, -1].entries()) {
  const bounds = new Box3();
  const positions = glass.geometry.attributes.position;
  for (let v = 0; v < positions.count; v++) {
    const p = new Vector3().fromBufferAttribute(positions, v).applyMatrix4(glass.matrixWorld);
    if (Math.sign(p.z) === sign) bounds.expandByPoint(p);
  }
  const dimensions = bounds.getSize(new Vector3()).multiplyScalar(1000);
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
const opaque = [body];
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
const surfaceDensity = (origin, direction) => {
  firstOpaque(origin, direction);
  const hit = hits[0],
    geometry = hit.object.geometry,
    uv = geometry.attributes.uv;
  const ids = [hit.face.a, hit.face.b, hit.face.c];
  const [a, b, c] = ids.map((i) =>
    new Vector3()
      .fromBufferAttribute(geometry.attributes.position, i)
      .applyMatrix4(hit.object.matrixWorld)
  );
  const worldAreaMm2 = b.sub(a).cross(c.sub(a)).length() * 0.5 * 1e6;
  const [u, v, w] = ids.map((i) => [uv.getX(i), uv.getY(i)]);
  const uvArea = Math.abs((v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])) * 0.5;
  return Math.sqrt((uvArea * 1024 ** 2) / worldAreaMm2);
};
const printDensity = surfaceDensity([0.1, 0.054, 0.0025], [-1, 0, 0]);
const plainDensity = surfaceDensity([0.018, -0.05, -0.01], [0, 1, 0]);
const reliefDensity = surfaceDensity([0.0172, 0.002, 0.1], [0, 0, -1]);
assert(
  printDensity > plainDensity * 4,
  'actual label UVs have much higher density than plain clamp faces'
);
assert(
  reliefDensity > plainDensity * 2,
  'actual fine hardware UVs retain priority, not just manifest weights'
);
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
  // Fine moulded legends/arrows are now normal-map detail by request, not
  // raised geometry. The real well, dome and tool groove remain independently probed.
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
  const hood = mesh === body;
  const casting = mesh === body;
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
      if (point.x > 27.5 && point.x < 29.21 && point.y < 23)
        capRadius = Math.max(capRadius, Math.hypot(-point.z - 46.2, point.y - 23));
    }
    if (
      casting &&
      point.x > 25.79 &&
      point.x < 27.11 &&
      point.y < 18 &&
      -point.z >= 35 &&
      -point.z <= 60.31
    )
      mouthRadius = Math.max(mouthRadius, Math.hypot(-point.z - 46.2, point.y - 23));
  }
}
assert(planarSkirtCorners >= 5, 'regression reaches the actual stepped hood face');
assert(
  // The sub-pixel cap bevel is baked; the target keeps its nominal outer radius.
  Math.abs(capRadius - 11.75) < 0.00002,
  `cap/grip radius ${capRadius}mm follows the revised photo estimate; mouth=${mouthRadius}mm`
);
assert(
  Math.abs(mouthRadius / capRadius - 1.2) < 0.001, // small cap-edge rounding; photo ratio is approximate
  'surrounding retaining mouth remains visibly broader than the cap'
);
const atlasMaterial = json.materials.find((m) => m.name === 'EXPS3 | baked opaque PBR atlas');
assert(atlasMaterial.normalTexture && atlasMaterial.pbrMetallicRoughness.baseColorTexture);
assert(atlasMaterial.pbrMetallicRoughness.metallicRoughnessTexture);
assert.equal(atlasMaterial.extensions?.KHR_materials_transmission, undefined);
assert.equal(atlasMaterial.alphaMode ?? 'OPAQUE', 'OPAQUE');
assert.equal(
  createHash('sha256').update(blend).digest('hex'),
  manifest.blendSha256,
  'inspected editable high/low blend is the published product'
);
assert(
  !json.nodes.some((n) => n.name?.startsWith('HIGH_')),
  'high source never leaks into runtime export'
);
assert.deepEqual(manifest.reticle, { ringMoa: 68, dotMoa: 1, geometryBaked: false });
root.removeFromParent();
assert(!gltf.scene.getObjectByName('EXPS3_glass'), 'removal cannot leave floating glass');
assert(!gltf.scene.getObjectByName('SOCKET_sight'), 'removal cannot leave floating sight datums');
console.log(
  'EXPS3: authored asset provenance, budgets, metres/axes, removable assembly and open optical bore passed.'
);
