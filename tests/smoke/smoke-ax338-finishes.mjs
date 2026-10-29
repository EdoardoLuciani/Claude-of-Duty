// Exported AX338 finish packing: original albedo factors and UV roles, real PNG data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const bytes = readFileSync(new URL('../../assets/weapons/ax338/ax338.glb', import.meta.url));
const { json, imagePNG } = inspectGLB(bytes),
  gltf = await parseGLB(bytes);
const colors = [
  [0.28, 0.19, 0.085],
  [0.01, 0.012, 0.014],
  [0.018, 0.021, 0.023],
  [0.17, 0.18, 0.18],
  [0.015, 0.017, 0.018],
  [0.53, 0.35, 0.12],
  [0.6, 0.57, 0.47],
  [0.03, 0.1, 0.12],
];
const roughness = [0.7, 0.76, 0.52, 0.36, 0.9, 0.32, 0.88, 0.14];
const opaque = json.materials.find((m) => m.name === 'AX338 | opaque finishes');
const glass = json.materials.find((m) => m.name.startsWith('10 |'));
for (const [texture, expected] of [
  [opaque.normalTexture, 'c8a70397047fdfa8ac1a992bc790e1d96bbc4397f9f4bfd753b19aee73fd4a31'],
  [
    opaque.pbrMetallicRoughness.baseColorTexture,
    'd0856d5c7820a756a7c2fe8ab286edfb083da99e4cfc42f384e1084b17a5c734',
  ],
]) {
  const pixels = imagePNG(json.images[json.textures[texture.index].source]).data;
  assert.equal(
    createHash('sha256').update(pixels).digest('hex'),
    expected,
    'original normal XYZ/albedo pixels unchanged'
  );
}
assert.equal(json.materials.length, 2);
assert.equal(glass.alphaMode, 'BLEND');
assert(Math.abs(glass.pbrMetallicRoughness.baseColorFactor[3] - 0.13) < 1e-6);
for (const material of [opaque, glass]) {
  const pbr = material.pbrMetallicRoughness;
  assert.equal(pbr.baseColorTexture.texCoord ?? 0, 0, 'albedo retains UV0');
  assert.equal(material.normalTexture.texCoord ?? 0, 0, 'normal XYZ retains UV0');
  assert.equal(material.normalTexture.scale, 0.25);
  assert.equal(pbr.metallicRoughnessTexture.texCoord, 1, 'only scalar finish detail uses UV1');
}
const image = imagePNG(
  json.images[json.textures[opaque.pbrMetallicRoughness.metallicRoughnessTexture.index].source]
);
const used = new Set();
gltf.scene.traverse((mesh) => {
  if (!mesh.isMesh) return;
  const { uv1, color } = mesh.geometry.attributes;
  assert(uv1, 'finish coordinates exported');
  const optical = mesh.material.name.startsWith('10 |');
  assert(optical || color, 'opaque albedo factors exported as vertex colors');
  for (let i = 0; i < uv1.count; i++) {
    const x = Math.floor(uv1.getX(i) * image.width),
      y = Math.floor(uv1.getY(i) * image.height);
    const tile = Math.floor(x / 512) + 2 * (3 - Math.floor(y / 256));
    used.add(tile);
    assert.equal(optical, tile === 7, 'glass never shares an opaque finish tile');
    const offset = (y * image.width + x) * 4;
    assert.equal(
      image.data[offset + 2],
      [3, 5].includes(tile) ? 255 : 0,
      'exact dielectric/metal separation'
    );
    const r = image.data[offset + 1] / 255;
    assert(
      r >= 0.65 * roughness[tile] && r <= roughness[tile] + 1 / 255,
      'authored roughness factor preserved'
    );
    if (!optical)
      for (let c = 0; c < 3; c++)
        assert(
          Math.abs(color.getComponent(i, c) - colors[tile][c]) < 1e-7,
          'original linear albedo factor'
        );
  }
});
assert.equal(used.size, 8, 'all authored finishes remain represented');
console.log(
  'AX338 finish packing: eight finishes, two materials, UV0 normal/albedo, UV1 packed roughness/metalness and independent transparent lenses passed'
);
