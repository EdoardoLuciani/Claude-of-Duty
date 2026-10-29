import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { makeM4Model } from '../../src/weapons/m4.ts';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/m4a1-block-ii/', import.meta.url);
const bytes = readFileSync(new URL('m4a1-block-ii.glb', dir));
const native = inspectGLB(bytes);
const images = new Map(native.json.images.map((image) => [image.name, native.imagePNG(image)]));
// Original source images are deliberately independent from the compact atlas.
for (const [name, hash] of Object.entries({
  m4_normal: '68bd012cdafd6836ac158e863ec78a170888225119defa97901b59fed73840a7',
  m4_surface: '2e841cf31a0b81a00320a59f6c3fbdabd2c26e99f07597d0b4a6d8f41fff41db',
  m4_roughness: 'b3c1ecbe9d51878ad3821a2f4c31098105800ec40a847e6444b6e98ad8785479',
  m4_receiver_surface: 'ef6b3c707a2057fc1e1bc577b4716f57b95791133aca2eb1c954e94812c139f5',
})) {
  const image = native.json.images.find((image) => image.name === name);
  const view = native.json.bufferViews[image.bufferView];
  assert.equal(
    createHash('sha256')
      .update(native.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength))
      .digest('hex'),
    hash,
    `${name}: unchanged full-resolution source map`
  );
}
// Source-named factors in sorted atlas order: color, metalness, roughness, normalScale.
const finishes = [
  ['FDE', [0.235, 0.15, 0.084], 1, 0.56, 0.16],
  ['rubber', [0.022, 0.024, 0.026], 0, 0.92, 0.9],
  ['steel', [0.071, 0.078, 0.086], 1, 0.56, 0.16],
  ['burnished', [0.115, 0.125, 0.137], 1, 0.48, 0.1],
  ['magazine', [0.145, 0.155, 0.164], 1, 0.67, 0.18],
  ['brass', [0.49, 0.285, 0.084], 1, 0.35, 0.1],
  ['copper', [0.43, 0.16, 0.066], 1, 0.39, 0.1],
  ['markings', [0.115, 0.122, 0.129], 0, 0.72, 0.05],
  ['follower', [0.085, 0.103, 0.056], 0, 0.78, 0.3],
];
function sample(image, x, y, channel) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(x0 + 1, image.width - 1),
    y1 = Math.min(y0 + 1, image.height - 1);
  const get = (px, py) => image.data[(py * image.width + px) * 4 + channel] / 255;
  const tx = x - x0,
    ty = y - y0;
  return (
    (get(x0, y0) * (1 - tx) + get(x1, y0) * tx) * (1 - ty) +
    (get(x0, y1) * (1 - tx) + get(x1, y1) * tx) * ty
  );
}
for (const [index, [name, , metal, roughness, strength]] of finishes.entries()) {
  const orm = images.get('m4_finish_orm'),
    normal = images.get('m4_finish_normal');
  assert.equal(orm.width, 512);
  assert.equal(normal.height, 512);
  for (const x of [0, 17, 59, 93, 119])
    for (const y of [0, 23, 61, 98, 119]) {
      const sx = (x * 1023) / 119,
        sy = 1023 - (y * 1023) / 119;
      const tx = (index % 4) * 128 + 4 + x,
        ty = 511 - (Math.floor(index / 4) * 128 + 4 + y);
      const expectedRoughness = sample(images.get('m4_roughness'), sx, sy, 1) * roughness;
      assert(Math.abs(sample(orm, tx, ty, 1) - expectedRoughness) < 2 / 255, `${name}: roughness`);
      assert.equal(sample(orm, tx, ty, 2), metal, `${name}: metallic boundary`);
      const direction = [0, 1, 2].map(
        (channel) =>
          (sample(images.get('m4_normal'), sx, sy, channel) * 2 - 1) *
          (channel === 2 ? 1 : strength)
      );
      const length = Math.hypot(...direction);
      for (let channel = 0; channel < 3; channel++)
        assert(
          Math.abs(sample(normal, tx, ty, channel) - ((direction[channel] / length) * 0.5 + 0.5)) <
            3 / 255,
          `${name}: runtime-equivalent normal XYZ channel ${channel}`
        );
      // Four-pixel guards repeat the endpoint rather than sampling another finish.
      if (x === 0) assert.equal(sample(orm, tx - 4, ty, 2), metal);
      if (x === 119) assert.equal(sample(orm, tx + 4, ty, 2), metal);
    }
}
for (const [format, data] of [
  ['native', bytes],
  ['runtime', readFileSync(new URL('m4a1-block-ii.runtime.glb', dir))],
]) {
  const model = makeM4Model(await parseGLB(data));
  const seen = new Set();
  model.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    if (/^(01|03) \|/.test(mesh.material.name)) {
      assert.equal(mesh.material.map.channel, 0);
      assert.equal(mesh.material.normalMap.channel, 0);
      const color = mesh.geometry.attributes.color;
      if (color)
        for (let i = 0; i < color.count; i++)
          assert(color.getX(i) === 1 && color.getY(i) === 1 && color.getZ(i) === 1);
      return;
    }
    if (mesh.material.name !== 'M4 | packed opaque finishes') return;
    const { color, uv, uv1 } = mesh.geometry.attributes;
    assert(color && uv && uv1);
    assert(mesh.material.vertexColors);
    assert.equal(mesh.material.normalMap.channel, 1);
    assert.equal(mesh.material.roughnessMap.channel, 1);
    assert.equal(mesh.material.metalnessMap.channel, 1);
    assert.equal(mesh.material.map.channel, 0);
    assert.equal(mesh.material.normalScale.x, 1);
    const partFinishes = new Set();
    for (let i = 0; i < color.count; i++) {
      const actual = [color.getX(i), color.getY(i), color.getZ(i)];
      const index = finishes.findIndex(([, expected]) =>
        actual.every((value, axis) => Math.abs(value - expected[axis]) < 1 / 65535)
      );
      assert(index >= 0, `${format}: original linear COLOR_0, not an averaged tint`);
      seen.add(index);
      partFinishes.add(index);
      const expectedU = ((index % 4) * 128 + 4.5 + uv.getX(i) * 119) / 512;
      const expectedV = 1 - (Math.floor(index / 4) * 128 + 4.5 + (1 - uv.getY(i)) * 119) / 512;
      assert(Math.abs(uv1.getX(i) - expectedU) < 1e-7);
      assert(
        Math.abs(uv1.getY(i) - expectedV) < 1e-7,
        'positive affine UV1 preserves tangent orientation'
      );
    }
    if (['magazine_mesh', 'magazine_spare_mesh'].includes(mesh.name))
      assert.deepEqual(
        [...partFinishes].sort(),
        [4, 8],
        'drop body retains aluminum/follower only'
      );
    if (['magazine_round_mesh', 'magazine_spare_round_mesh'].includes(mesh.name))
      assert.deepEqual(
        [...partFinishes].sort(),
        [5, 6],
        'loaded brass/copper stay independently hidden'
      );
  });
  assert.equal(seen.size, 9, `${format}: all nine packed finishes remain represented`);
}
// Moving endpoints and nonconstant Idle must fail, not be silently repaired.
for (const name of ['Fire', 'Idle']) {
  const damaged = await parseGLB(bytes);
  damaged.animations.find((clip) => clip.name === name).duration = 0;
  assert.throws(() => makeM4Model(damaged), new RegExp(`invalid ${name} duration`));
}
console.log(
  'M4 finishes: unchanged full-resolution receiver/checkering maps, nine linear colors, padded ORM, strength-baked XYZ normals, UV roles/tangents and strict duration gates passed'
);
