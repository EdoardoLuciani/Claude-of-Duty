import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KHR_DF_MODEL_UASTC,
  KHR_SUPERCOMPRESSION_ZSTD,
  read as readKTX,
} from 'three/examples/jsm/libs/ktx-parse.module.js';

import { M4Animation, makeM4Model } from '../../src/weapons/m4.ts';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/m4a1-block-ii/', import.meta.url);
const nativeBytes = readFileSync(new URL('m4a1-block-ii.glb', dir));
const runtimeBytes = readFileSync(new URL('m4a1-block-ii.runtime.glb', dir));
const native = inspectGLB(nativeBytes),
  runtime = inspectGLB(runtimeBytes);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
assert(runtimeBytes.length < 5500000);
assert.deepEqual(
  runtime.json.nodes.map((node) => node.name).sort(),
  native.json.nodes.map((node) => node.name).sort(),
  'keep named controls, seats and sockets, including static empty helpers'
);
assert.equal(runtime.json.materials.length, 1, 'one opaque finish graph');
assert.equal(runtime.json.images.length, 4);
for (const image of runtime.json.images) {
  assert.equal(image.mimeType, 'image/ktx2');
  const view = runtime.json.bufferViews[image.bufferView];
  const ktx = readKTX(runtime.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength));
  assert.equal(ktx.pixelWidth, 1024);
  assert.equal(ktx.pixelHeight, 1024);
  assert.equal(ktx.levels.length, 11);
  assert.equal(ktx.supercompressionScheme, KHR_SUPERCOMPRESSION_ZSTD);
  const dfd = ktx.dataFormatDescriptor[0];
  assert.equal(dfd.colorModel, KHR_DF_MODEL_UASTC);
  assert.equal(dfd.transferFunction, /surface/.test(image.name) ? 2 : 1);
  assert.equal(dfd.samples.length, 1);
  assert.equal(dfd.samples[0].channelType, 0, 'full RGB normal XYZ, not reconstructed Z');
}
const source = makeM4Model(await parseGLB(nativeBytes));
const cooked = makeM4Model(await parseGLB(runtimeBytes));
// Measured decoded CPU geometry budget, not actual uploaded GPU allocation.
// Ordinary assembly streams retain exact finish factors without skin attributes.
const arrayBytes = (model) => {
  const arrays = new Set();
  model.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    for (const attribute of Object.values(mesh.geometry.attributes)) arrays.add(attribute.array);
    arrays.add(mesh.geometry.index.array);
  });
  return [...arrays].reduce((sum, array) => sum + array.byteLength, 0);
};
assert(arrayBytes(source) <= 5_967_346, 'bounded native ordinary assembly/finish arrays');
assert(arrayBytes(cooked) <= 5_141_354, 'bounded decoded runtime ordinary assembly/finish arrays');
const materials = (model) => {
  const result = new Map();
  model.root.traverse((mesh) => {
    if (mesh.isMesh) result.set(mesh.material.name, mesh.material);
  });
  return result;
};
const sourceMaterials = materials(source);
for (const [name, material] of materials(cooked)) {
  const original = sourceMaterials.get(name);
  assert(original, `${name}: retained finish`);
  for (const property of ['roughness', 'metalness', 'opacity', 'emissiveIntensity', 'side'])
    assert(Math.abs(material[property] - original[property]) < 1e-8, `${name}: ${property}`);
  for (const property of ['color', 'emissive', 'normalScale']) {
    const actual = material[property].toArray(),
      expected = original[property].toArray();
    assert(actual.every((value, axis) => Math.abs(value - expected[axis]) < 1e-8));
  }
  for (const property of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'])
    assert.equal(Boolean(material[property]), Boolean(original[property]), `${name}: ${property}`);
}
for (const clip of runtime.json.animations) {
  for (const channel of clip.channels)
    if (channel.target.path === 'scale')
      assert.equal(clip.samplers[channel.sampler].interpolation, 'STEP');
  const duration = Math.max(...clip.samplers.map((s) => runtime.json.accessors[s.input].max[0]));
  if (clip.name === 'Idle') assert.equal(duration, 0, 'gltfpack collapses constant Idle keys');
  else assert(Math.abs(duration - manifest.clips[clip.name].duration) < 1e-6);
  assert.equal(
    cooked.animations.find((animation) => animation.name === clip.name).duration,
    clip.name === 'Idle'
      ? manifest.clips.Idle.duration
      : source.animations.find((animation) => animation.name === clip.name).duration,
    `${clip.name}: adapter preserves the authored duration, including constant Idle`
  );
}
const originalAnimation = new M4Animation(source),
  cookedAnimation = new M4Animation(cooked);
let maxMatrixDeviation = 0,
  samples = 0;
let maxPositionDeviation = 0,
  maxRotationDeviation = 0;
for (const clip of source.animations) {
  const times = new Set([0, clip.duration]);
  for (let frame = 0; frame <= clip.duration * 240; frame++) times.add(frame / 240);
  for (const event of manifest.clips[clip.name].events)
    for (const delta of [-1e-6, 0, 1e-6]) times.add(event.time + delta);
  for (const time of times) {
    originalAnimation._sample(clip.name, time);
    cookedAnimation._sample(clip.name, time);
    source.root.updateMatrixWorld(true);
    cooked.root.updateMatrixWorld(true);
    for (const node of native.json.nodes) {
      const a = source.root.getObjectByName(node.name.replaceAll(' ', '_'));
      const b = cooked.root.getObjectByName(node.name.replaceAll(' ', '_'));
      assert(a && b, `${node.name}: authored node survives decoding`);
      maxPositionDeviation = Math.max(maxPositionDeviation, a.position.distanceTo(b.position));
      maxRotationDeviation = Math.max(
        maxRotationDeviation,
        a.quaternion.clone().normalize().angleTo(b.quaternion.clone().normalize())
      );
      for (let i = 0; i < 16; i++)
        maxMatrixDeviation = Math.max(
          maxMatrixDeviation,
          Math.abs(a.matrixWorld.elements[i] - b.matrixWorld.elements[i])
        );
      assert.equal(a.visible, b.visible, `${clip.name}/${time}: ${node.name} visibility`);
    }
    samples++;
  }
}
// gltfpack also reduces redundant quaternion keys with -af 0. Bound the
// measured local rotation error independently from native-metre translation.
assert(maxPositionDeviation < 0.000002, `translation deviation: ${maxPositionDeviation}`);
assert(maxRotationDeviation < 0.00015, `rotation deviation: ${maxRotationDeviation}`);
originalAnimation.reset();
cookedAnimation.reset();

// The selected -noq cook must preserve every nondegenerate indexed triangle's
// positions and UV0. Vertex/index reordering is not geometry loss. Check that
// welded normals still use a source direction at the same position/UV below.
function surfaces(model) {
  const surfaces = new Map();
  const normals = new Map();
  model.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry,
      positions = geometry.attributes.position;
    const triangles = surfaces.get(mesh.material.name) ?? [];
    for (let index = 0; index < geometry.index.count; index += 3) {
      const vertices = [];
      for (let corner = 0; corner < 3; corner++) {
        const vertex = geometry.index.getX(index + corner);
        const values = [];
        for (const name of ['position', 'uv', 'uv1', 'uv2']) {
          const attribute = geometry.attributes[name];
          assert(attribute, `${mesh.name}: ${name}`);
          for (let axis = 0; axis < (name === 'position' ? 3 : 2); axis++)
            values.push(attribute.getComponent(vertex, axis));
        }
        const key = `${mesh.material.name}:${values.join(',')}`;
        const normal = geometry.attributes.normal;
        assert(normal, `${mesh.name}: full XYZ normals`);
        const directions = normals.get(key) ?? [];
        directions.push([normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)]);
        normals.set(key, directions);
        vertices.push(values);
      }
      const [a, b, c] = vertices;
      const ab = b.slice(0, 3).map((v, i) => v - a[i]);
      const ac = c.slice(0, 3).map((v, i) => v - a[i]);
      const area = Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0]
      );
      if (area < 1e-18) continue;
      assert(positions.count > 0);
      const keys = vertices.map((v) => v.join(','));
      // Rotate the triangle's start without permitting reversed winding.
      const starts = keys.map((_, i) => [...keys.slice(i), ...keys.slice(0, i)].join(';'));
      triangles.push(starts.sort()[0]);
    }
    surfaces.set(mesh.material.name, triangles);
  });
  for (const triangles of surfaces.values()) triangles.sort();
  return { surfaces, normals };
}
const a = surfaces(source),
  b = surfaces(cooked);
assert.deepEqual(b.surfaces, a.surfaces, 'exact unsimplified indexed positions/UVs/winding');
let maxNormalDeviation = 0;
for (const [key, normals] of b.normals) {
  const original = a.normals.get(key);
  assert(original, 'no invented surface vertices');
  for (const normal of normals) {
    const closest = Math.min(
      ...original.map((n) => Math.hypot(...n.map((v, axis) => v - normal[axis])))
    );
    maxNormalDeviation = Math.max(maxNormalDeviation, closest);
  }
}
assert.equal(maxNormalDeviation, 0, 'normal direction retained at each position/UV');
originalAnimation.dispose();
cookedAnimation.dispose();
console.log(
  `M4 cook: UASTC RGB/mips/color spaces, exact indexed surfaces, ${samples} fractional poses, max matrix deviation ${maxMatrixDeviation}, translation ${maxPositionDeviation} m, rotation ${maxRotationDeviation} rad, normal-vector deviation ${maxNormalDeviation}`
);
