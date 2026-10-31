// Finish packing must preserve pigment/UV roles, not flatten MCX to one grey.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PNG } from 'pngjs';

import { makeMCXModel } from '../../src/weapons/mcx.ts';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

// Evaluate the actual small TSL selector graph at decoded finish coordinates,
// not a duplicate production selector. Fail closed if its node vocabulary grows.
function evaluate(node, coordinate) {
  if (node.isVarNode) return evaluate(node.node, coordinate);
  if (node.isConstNode) return node.value.toArray ? node.value.toArray() : node.value;
  if (node.constructor.name === 'AttributeNode') {
    assert.equal(node.getAttributeName(), 'uv1');
    return coordinate;
  }
  if (node.isSplitNode) return evaluate(node.node, coordinate)['xyzw'.indexOf(node.components)];
  if (node.method === 'floor') return Math.floor(evaluate(node.aNode, coordinate));
  if (node.condNode)
    return evaluate(evaluate(node.condNode, coordinate) ? node.ifNode : node.elseNode, coordinate);
  const a = evaluate(node.aNode, coordinate),
    b = evaluate(node.bNode, coordinate);
  if (node.op === '*') return Array.isArray(a) ? a.map((v) => v * b) : a * b;
  if (node.op === '+') return a + b;
  if (node.op === '-') return a - b;
  if (node.op === '==') return a === b;
  assert.fail(`Unexpected MCX finish node: ${node.constructor.name}`);
}

const directory = new URL('../../assets/weapons/mcx-virtus/', import.meta.url);
// Independent original linear pigments, roughness multipliers and metalness.
const finishes = [
  [[0.047, 0.053, 0.06], 0.72, 1],
  [[0.081, 0.087, 0.095], 0.59, 1],
  [[0.027, 0.031, 0.035], 0.84, 0],
  [[0.016, 0.019, 0.022], 0.91, 0],
  [[0.083, 0.091, 0.105], 0.44, 1],
  [[0.045, 0.046, 0.049], 0.76, 0],
  [[0.49, 0.285, 0.084], 0.35, 1],
  [[0.43, 0.16, 0.066], 0.39, 1],
  [[0.37, 0.39, 0.4], 0.65, 0],
  [[0.32, 0.025, 0.012], 0.62, 0],
  [[0.48, 0.56, 0.59], 0.08, 0],
  [[0.48, 0.025, 0.008], 0.28, 0],
  [[0.135, 0.13, 0.123], 0.44, 0],
];
const originalRoughness = PNG.sync.read(
  readFileSync(new URL('textures/roughness_variation.png', directory))
);
let roughnessMean = 0;
for (let i = 1; i < originalRoughness.data.length; i += 4)
  roughnessMean += originalRoughness.data[i] / 255;
roughnessMean /= originalRoughness.width * originalRoughness.height;
const native = readFileSync(new URL('mcx-virtus.glb', directory));
const inspected = inspectGLB(native);
for (const name of ['surface_variation', 'micro_normal']) {
  const embedded = inspected.imagePNG(inspected.json.images.find((image) => image.name === name));
  const original = PNG.sync.read(readFileSync(new URL(`textures/${name}.png`, directory)));
  assert.equal(embedded.width, 1024);
  assert.deepEqual(embedded.data, original.data, `${name}: original full-resolution RGB pixels`);
}
const lookup = inspected.imagePNG(
  inspected.json.images.find((image) => image.name === 'mcx_finish_scalars')
);
assert.equal(lookup.width, 64);
assert.equal(lookup.height, 64);
for (let index = 0; index < finishes.length; index++) {
  const [, roughness, metalness] = finishes[index];
  // PNG rows are top-down; Blender image pixels/lookup coordinates are bottom-up.
  const x = (index % 4) * 16,
    y = (3 - Math.floor(index / 4)) * 16;
  const center = (y + 8) * 64 * 4 + (x + 8) * 4;
  assert.ok(
    Math.abs(lookup.data[center + 1] / 255 - (index === 10 ? 1 : roughness) * roughnessMean) <
      1 / 255,
    `${index}: scalar roughness retains original mean, within PNG quantization`
  );
  assert.equal(lookup.data[center + 2], metalness * 255);
  for (let row = y; row < y + 16; row++) {
    for (let column = x; column < x + 16; column++) {
      const offset = (row * 64 + column) * 4;
      assert.deepEqual(
        lookup.data.subarray(offset, offset + 3),
        lookup.data.subarray(center, center + 3),
        `${index}: padded scalar tile has no neighbour contamination`
      );
    }
  }
}
let maximumPigmentError = 0;
for (const filename of ['mcx-virtus.glb', 'mcx-virtus.runtime.glb']) {
  const gltf = await parseGLB(readFileSync(new URL(filename, directory)));
  const seen = new Set();
  gltf.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const { uv, uv1, color } = mesh.geometry.attributes;
    assert.ok(uv && uv1, 'retain independent repeat and finish UV sets');
    assert.equal(mesh.material.map.channel, 0);
    assert.equal(mesh.material.normalMap.channel, 0);
    assert.equal(mesh.material.roughnessMap.channel, 1);
    assert.equal(mesh.material.metalnessMap.channel, 1);
    const indices = mesh.geometry.index;
    const role = (index) =>
      ({ 2: 'polymer', 3: 'rubber', 10: 'glass', 11: 'fiber' })[index] ?? 'fine';
    for (let triangle = 0; triangle < indices.count; triangle += 3) {
      const corners = [0, 1, 2].map((corner) => indices.getX(triangle + corner));
      const columns = corners.map((i) => Math.floor(uv1.getX(i) * 4));
      const rows = corners.map((i) => Math.floor((1 - uv1.getY(i)) * 4));
      const expectedRole = role(rows[0] * 4 + columns[0]);
      // The fixed cook merges two tiny anodized/edge triangles. Both are fine
      // surfaces: every tile crossed by interpolation must retain the SAME
      // normal/emission role, not accidentally acquire polymer/rubber/fiber.
      for (let row = Math.min(...rows); row <= Math.max(...rows); row++) {
        for (let column = Math.min(...columns); column <= Math.max(...columns); column++) {
          assert.equal(
            role(row * 4 + column),
            expectedRole,
            'no interpolated normal/emission mask boundary'
          );
        }
      }
    }
    if (mesh.material.name.startsWith('11 |')) {
      assert.ok(
        Math.abs(mesh.material.roughness - 0.08) < 1e-6,
        'lens factor stays outside lookup so the adapter override keeps its original meaning'
      );
    }
    for (let vertex = 0; vertex < uv1.count; vertex++) {
      const u = uv1.getX(vertex),
        v = 1 - uv1.getY(vertex);
      const column = Math.floor(u * 4),
        row = Math.floor(v * 4),
        index = row * 4 + column;
      assert.ok(index >= 0 && index < finishes.length);
      assert.ok(Math.abs(u - (column + 0.5) / 4) < 0.00002);
      assert.ok(Math.abs(v - (row + 0.5) / 4) < 0.00002);
      seen.add(index);
      const optical = index === 10;
      const expectedColor = optical ? [1, 1, 1] : finishes[index][0];
      assert.equal(mesh.material.name.startsWith('11 |'), index === 10);
      if (!optical) assert.equal(mesh.material.name, 'MCX | opaque finishes');
      if (!optical) assert.ok(mesh.material.vertexColors, 'shader uses corner pigment');
      const actual = color
        ? [color.getX(vertex), color.getY(vertex), color.getZ(vertex)]
        : [1, 1, 1];
      for (let channel = 0; channel < 3; channel++) {
        const error = Math.abs(actual[channel] - expectedColor[channel]);
        maximumPigmentError = Math.max(maximumPigmentError, error);
        assert.ok(
          error < 1 / 65535 + 1e-7,
          `${filename}: original linear pigment (16-bit runtime precision)`
        );
      }
    }
  });
  assert.equal(
    seen.size,
    13,
    'all original finish identities including markings/brass/copper survive'
  );
  const model = makeMCXModel(gltf);
  const materials = [...model.materials];
  const glass = materials.find((material) => material.name.startsWith('11 |'));
  const opaque = materials.find((material) => material.name === 'MCX | opaque finishes');
  assert.equal(materials.length, 2);
  assert.ok(opaque.normalNode && opaque.emissiveNode, 'weapon-local exact surface treatment');
  assert.equal(opaque.normalNode.node.node.value, opaque.normalMap, 'same full XYZ normal texture');
  for (let index = 0; index < finishes.length; index++) {
    if (index === 10) continue;
    const coordinate = [((index % 4) + 0.5) / 4, 1 - (Math.floor(index / 4) + 0.5) / 4];
    const strength = index === 2 ? 0.5 : index === 3 ? 0.9 : index === 11 ? 0.03 : 0.02;
    const scale = evaluate(opaque.normalNode.scaleNode, coordinate);
    assert.deepEqual(scale, [
      Math.sign(opaque.normalScale.x) * strength,
      Math.sign(opaque.normalScale.y) * strength,
    ]);
    assert.deepEqual(
      evaluate(opaque.emissiveNode, coordinate),
      index === 11 ? [0.336, 0.0175, 0.0056] : [0, 0, 0]
    );
  }
  assert.ok(glass.transparent && glass.opacity === 0.1 && !glass.depthWrite);
  assert.equal(glass.transmission, 0, 'established runtime scope pass policy');
  assert.equal(glass.roughness, 0.12, 'scope roughness still multiplies untinted mean grain');
  assert.equal(glass.specularIntensity, 0.25);
  assert.equal(glass.metalness, 0);
  assert.deepEqual(glass.color.toArray(), [0.035, 0.075, 0.085]);
}
console.log(
  `MCX finishes: 13 pigments / 2 materials; exact masked normal strengths/emission, unchanged UV0 detail RGB, scalar ORM tiles and optics; maximum pigment error ${maximumPigmentError}`
);
