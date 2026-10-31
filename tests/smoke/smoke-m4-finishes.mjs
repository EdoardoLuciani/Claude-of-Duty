import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { makeM4Model } from '../../src/weapons/m4.ts';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/m4a1-block-ii/', import.meta.url);
const bytes = readFileSync(new URL('m4a1-block-ii.glb', dir));
const native = inspectGLB(bytes);
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
    `${name}: unchanged full-resolution source map, including A2 checkering`
  );
  assert.equal(native.imagePNG(image).width, 1024);
}
// Source-named color, roughness, metalness, normal strength, albedo/emission role.
const green = [57, 255, 20].map((v) =>
  v / 255 > 0.04045 ? ((v / 255 + 0.055) / 1.055) ** 2.4 : v / 255 / 12.92
);
const finishes = [
  ['receiver', [0.041, 0.043, 0.046], 0.44, 1, 0.08, 1],
  ['FDE', [0.235, 0.15, 0.084], 0.56, 1, 0.16, 0],
  ['furniture/checkering', [0.026, 0.029, 0.032], 0.8, 0, 0.55, 0],
  ['rubber', [0.022, 0.024, 0.026], 0.92, 0, 0.9, 0],
  ['steel', [0.071, 0.078, 0.086], 0.56, 1, 0.16, 0],
  ['burnished', [0.115, 0.125, 0.137], 0.48, 1, 0.1, 0],
  ['magazine', [0.145, 0.155, 0.164], 0.67, 1, 0.18, 0],
  ['brass', [0.49, 0.285, 0.084], 0.35, 1, 0.1, 0],
  ['copper', [0.43, 0.16, 0.066], 0.39, 1, 0.1, 0],
  ['markings', [0.115, 0.122, 0.129], 0.72, 0, 0.05, 0],
  ['follower', [0.085, 0.103, 0.056], 0.78, 0, 0.3, 0],
  ['paint', green, 0.8, 0, 0, 2],
];
for (const [format, data] of [
  ['native', bytes],
  ['runtime', readFileSync(new URL('m4a1-block-ii.runtime.glb', dir))],
]) {
  const model = makeM4Model(await parseGLB(data));
  assert.equal(model.materials.size, 1);
  const seen = new Set();
  let meshes = 0;
  model.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    meshes++;
    const { material, geometry } = mesh;
    assert.equal(material.name, 'M4 | unified opaque finishes');
    assert(!material.transparent && material.opacity === 1 && material.alphaTest === 0);
    assert(material.vertexColors);
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'emissiveMap'])
      assert.equal(material[slot].channel, 0, `${slot}: full-resolution original UV0`);
    for (const slot of [
      'colorNode',
      'normalNode',
      'roughnessNode',
      'metalnessNode',
      'emissiveNode',
    ])
      assert(material[slot], `physical graph owns ${slot}`);
    const emission = material.emissiveNode;
    assert.equal(emission.condNode.op, '==');
    assert.equal(emission.condNode.bNode.value, 2, 'emission is restricted to role 2');
    assert.equal(emission.ifNode.op, '*');
    assert.equal(emission.ifNode.aNode.getAttributeName(), 'color');
    assert.equal(emission.ifNode.bNode.value, 2, 'original emission strength, not compensation');
    assert.equal(emission.elseNode.value.length(), 0, 'other finishes remain nonemissive');
    assert.equal(material.colorNode.condNode, emission.condNode);
    const receiverSelect = material.colorNode.elseNode;
    assert.equal(receiverSelect.condNode.bNode.value, 1, 'only receiver uses balanced albedo');
    assert.equal(receiverSelect.ifNode.node.value, material.emissiveMap);
    assert.equal(receiverSelect.elseNode.node.value, material.map);
    assert.equal(material.normalNode.node.node.value, material.normalMap);
    assert.equal(geometry.attributes.tangent, undefined, 'use the derivative tangent frame');
    assert.deepEqual(material.normalScale.toArray(), [1, -1], 'GLTFLoader normal-map signs');
    const normalScale = material.normalNode.scaleNode;
    assert.equal(normalScale.op, '*');
    assert.deepEqual(
      normalScale.aNode.value.toArray(),
      material.normalScale.toArray().map(Math.sign),
      'finish strength must preserve the loader normal-Y correction'
    );
    assert.equal(normalScale.bNode.components, 'x');
    const detail = normalScale.bNode.node;
    assert.equal(detail.interpolationType, 'flat');
    assert.equal(detail.node.node.getAttributeName(), 'uv2');
    assert.equal(material.normalNode.node.node.uvNode.getAttributeName(), 'uv');
    const { color, uv, uv1, uv2 } = geometry.attributes;
    assert(color && uv && uv1 && uv2, `${format}: -kv retains finish transport`);
    const partFinishes = new Set();
    const finishIndices = [];
    for (let i = 0; i < color.count; i++) {
      const index = finishes.findIndex(([, expected]) =>
        expected.every((value, axis) => Math.abs(color.getComponent(i, axis) - value) < 1 / 65535)
      );
      assert(index >= 0, `${format}: original linear tint, not averaged`);
      const [name, , roughness, metalness, strength, role] = finishes[index];
      for (const [actual, expected] of [
        [uv1.getX(i), roughness],
        [uv1.getY(i), metalness],
        [uv2.getX(i), strength],
        [uv2.getY(i), role],
      ])
        assert(
          Math.abs(actual - expected) < 1e-7,
          `${format}/${mesh.name}/${name}: exact finish factors`
        );
      finishIndices.push(index);
      seen.add(index);
      partFinishes.add(index);
    }
    for (let triangle = 0; triangle < geometry.index.count; triangle += 3) {
      const indices = [0, 1, 2].map(
        (corner) => finishIndices[geometry.index.getX(triangle + corner)]
      );
      assert(
        indices.every((index) => index === indices[0]),
        `${mesh.name}: no interpolation across finish boundaries`
      );
    }
    if (['magazine_mesh', 'magazine_spare_mesh'].includes(mesh.name))
      assert.deepEqual(
        [...partFinishes].sort((a, b) => a - b),
        [6, 10],
        'drop body retains aluminum/follower only'
      );
    if (['magazine_round_mesh', 'magazine_spare_round_mesh'].includes(mesh.name))
      assert.deepEqual(
        [...partFinishes].sort((a, b) => a - b),
        [7, 8],
        'brass/copper remain independently hidden'
      );
    if (mesh.name === 'spent_case_mesh') assert.deepEqual([...partFinishes], [7]);
  });
  assert.equal(meshes, 18);
  assert.equal(seen.size, 12, `${format}: every original finish survives`);
}
for (const name of ['Fire', 'Idle']) {
  const damaged = await parseGLB(bytes);
  damaged.animations.find((clip) => clip.name === name).duration = 0;
  assert.throws(() => makeM4Model(damaged), new RegExp(`invalid ${name} duration`));
}
console.log(
  'M4 finishes: four unchanged 1024² maps; all 12 original tints/factors/roles on native and cooked triangles; full UV0 normals/checkering, receiver selection and paint emission graph passed'
);
