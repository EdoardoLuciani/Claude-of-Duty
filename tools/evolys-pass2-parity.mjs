// Independent pass-2 geometry oracle. Supply a native GLB extracted from base
// 875587a3, not a candidate-generated fixture. Never rewrites either product.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { makeEvolysModel, EvolysAnimation } from '../src/weapons/evolys.ts';
import { parseGLB } from './lib/glb-fixture.mjs';

assert(process.argv[2], 'usage: node tools/evolys-pass2-parity.mjs BASE_NATIVE_GLB');
const sourceBytes = readFileSync(process.argv[2]);
const targetBytes = readFileSync(
  new URL('../assets/weapons/fn-evolys-762/fn-evolys-762.glb', import.meta.url)
);
function images(bytes) {
  const length = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + length));
  return new Map(
    document.images.map((image) => {
      const view = document.bufferViews[image.bufferView];
      const offset = 28 + length + (view.byteOffset ?? 0);
      return [image.name, bytes.subarray(offset, offset + view.byteLength)];
    })
  );
}
for (const [name, bytes] of images(sourceBytes))
  assert(
    bytes.equals(images(targetBytes).get(name)),
    `${name}: original encoded normal/base/ORM images unchanged`
  );
const before = new EvolysAnimation(makeEvolysModel(await parseGLB(sourceBytes)));
const after = new EvolysAnimation(makeEvolysModel(await parseGLB(targetBytes)));
function geometry(animation) {
  animation._sample('Idle', 0);
  animation.root.updateMatrixWorld(true);
  const result = [];
  animation.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
    const { position, uv, uv1, normal } = mesh.geometry.attributes;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const vertices = Array.from({ length: position.count }, (_, index) => ({
      mesh,
      index,
      position: mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld),
      normal: new THREE.Vector3()
        .fromBufferAttribute(normal, index)
        .applyMatrix3(normalMatrix)
        .normalize(),
      uv: [uv.getX(index), uv.getY(index)],
      finish: [uv1.getX(index), uv1.getY(index)],
    }));
    const indices = mesh.geometry.index.array;
    for (let i = 0; i < indices.length; i += 3)
      result.push([vertices[indices[i]], vertices[indices[i + 1]], vertices[indices[i + 2]]]);
  });
  return result;
}
const original = geometry(before);
const candidate = geometry(after);
assert.equal(candidate.length, original.length, 'no added/deleted triangles');
const key = (triangle) =>
  triangle
    .map((vertex) => vertex.uv.join(','))
    .sort()
    .join('|');
const buckets = new Map();
for (const triangle of candidate) {
  const bucket = buckets.get(key(triangle)) ?? new Set();
  bucket.add(triangle);
  buckets.set(key(triangle), bucket);
}
const pairs = new Map();
let maximumPosition = 0;
let maximumNormal = 0;
const normalErrorsByMesh = new Map();
for (const triangle of original) {
  const bucket = buckets.get(key(triangle));
  assert(bucket?.size, 'exact original UV0 triangle exists');
  let match;
  let rotation;
  let error = Infinity;
  for (const target of bucket)
    for (let offset = 0; offset < 3; offset++) {
      if (
        triangle.some((vertex, i) =>
          vertex.uv.some((value, component) => value !== target[(i + offset) % 3].uv[component])
        )
      )
        continue;
      const positional = Math.max(
        ...triangle.map((vertex, i) =>
          vertex.position.distanceTo(target[(i + offset) % 3].position)
        )
      );
      if (positional >= 0.0000002) continue;
      const distance = Math.max(
        ...triangle.map((vertex, i) => vertex.normal.distanceTo(target[(i + offset) % 3].normal))
      );
      if (distance < error) {
        error = distance;
        match = target;
        rotation = offset;
      }
    }
  assert(
    match,
    `original oriented triangle positions remain present: ${triangle[0].mesh.name}/${triangle[0].index} ${triangle.map((v) => v.position.toArray())}`
  );
  const positionError = Math.max(
    ...triangle.map((vertex, i) => vertex.position.distanceTo(match[(i + rotation) % 3].position))
  );
  assert(positionError < 0.0000002, `unchanged actual oriented geometry: ${positionError} m`);
  maximumPosition = Math.max(maximumPosition, positionError);
  for (let i = 0; i < 3; i++) {
    const source = triangle[i];
    const target = match[(i + rotation) % 3];
    assert.deepEqual(source.uv, target.uv, 'normal UV0 unchanged');
    assert.deepEqual(source.finish, target.finish, 'finish UV1 unchanged');
    const normalError = source.normal.distanceTo(target.normal);
    maximumNormal = Math.max(maximumNormal, normalError);
    // Approved EVOLYS-only split-normal encoding exception: Blender stores
    // custom directions in INT16_2D. Never broaden geometry/contact gates.
    assert(
      normalError <= 0.0026,
      `split-normal encoding: ${source.mesh.name}/${source.index}: ${normalError}`
    );
    pairs.set(source, target);
  }
  bucket.delete(match);
}
assert(
  [...buckets.values()].every((bucket) => bucket.size === 0),
  'all candidate triangles accounted for'
);
for (const [source, target] of pairs) {
  const error = source.normal.distanceTo(target.normal);
  const stats = normalErrorsByMesh.get(source.mesh.name) ?? {
    vertices: 0,
    below1e7: 0,
    below1e4: 0,
    remainder: 0,
    maximum: 0,
  };
  stats.vertices++;
  stats.maximum = Math.max(stats.maximum, error);
  if (error < 1e-7) stats.below1e7++;
  else if (error < 1e-4) stats.below1e4++;
  else stats.remainder++;
  normalErrorsByMesh.set(source.mesh.name, stats);
}
function normalTransforms(animation) {
  const transforms = new Map();
  animation.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const objectNormal = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    if (!mesh.isSkinnedMesh) {
      transforms.set(mesh, [objectNormal]);
      return;
    }
    transforms.set(
      mesh,
      mesh.skeleton.bones.map((bone, index) => {
        const skin = new THREE.Matrix4()
          .copy(mesh.bindMatrixInverse)
          .multiply(bone.matrixWorld)
          .multiply(mesh.skeleton.boneInverses[index])
          .multiply(mesh.bindMatrix);
        return new THREE.Matrix3()
          .copy(objectNormal)
          .multiply(new THREE.Matrix3().setFromMatrix4(skin));
      })
    );
  });
  return transforms;
}
for (const animation of [before, after])
  animation.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const normal = mesh.geometry.attributes.normal;
    const direction = new THREE.Vector3();
    for (let index = 0; index < normal.count; index++) {
      direction.fromBufferAttribute(normal, index);
      assert(direction.toArray().every(Number.isFinite));
      assert(Math.abs(direction.length() - 1) < 1e-6, 'finite unit source/export normal');
    }
  });
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const normalA = new THREE.Vector3();
const normalB = new THREE.Vector3();
let maximumDeformedNormal = 0;
let poses = 0;
let evaluated = 0;
let maximumDeformed = 0;
for (const [name, action] of Object.entries(before.actions)) {
  const duration = action.getClip().duration;
  const times = new Set([0, duration]);
  for (let frame = 0; frame <= Math.ceil(duration * 30); frame++)
    times.add(Math.min(duration, frame / 30));
  for (const track of action.getClip().tracks)
    if (track.name.endsWith('.scale'))
      for (let index = 1; index < track.times.length; index++) {
        const width = track.getValueSize();
        if (
          Array.from(
            { length: width },
            (_, component) =>
              track.values[index * width + component] ===
              track.values[(index - 1) * width + component]
          ).every(Boolean)
        )
          continue;
        const time = track.times[index];
        times.add(time);
        times.add(Math.max(0, time - 1e-6));
        times.add(Math.min(duration, time + 1e-6));
      }
  for (const time of times) {
    for (const animation of [before, after]) {
      animation._sample(name, time);
      animation.root.updateMatrixWorld(true);
      animation.root.traverse((mesh) => {
        if (mesh.isSkinnedMesh) mesh.skeleton.update();
      });
    }
    poses++;
    const sourceNormals = normalTransforms(before);
    const targetNormals = normalTransforms(after);
    for (const [source, target] of pairs) {
      source.mesh.getVertexPosition(source.index, a).applyMatrix4(source.mesh.matrixWorld);
      target.mesh.getVertexPosition(target.index, b).applyMatrix4(target.mesh.matrixWorld);
      const error = a.distanceTo(b);
      maximumDeformed = Math.max(maximumDeformed, error);
      assert(error < 0.000002, `${name}/${time}: baseline deformed vertex error ${error} m`);
      const sourceJoint = source.mesh.geometry.attributes.skinIndex?.getX(source.index) ?? 0;
      const targetJoint = target.mesh.geometry.attributes.skinIndex?.getX(target.index) ?? 0;
      normalA
        .fromBufferAttribute(source.mesh.geometry.attributes.normal, source.index)
        .applyMatrix3(sourceNormals.get(source.mesh)[sourceJoint]);
      normalB
        .fromBufferAttribute(target.mesh.geometry.attributes.normal, target.index)
        .applyMatrix3(targetNormals.get(target.mesh)[targetJoint]);
      // Collapsed STEP/ammunition surfaces have no rendered normal direction.
      if (normalA.lengthSq() > 1e-12 && normalB.lengthSq() > 1e-12) {
        const normalError = normalA.normalize().distanceTo(normalB.normalize());
        maximumDeformedNormal = Math.max(maximumDeformedNormal, normalError);
        assert(normalError <= 0.0026, `${name}/${time}: deformed normal encoding ${normalError}`);
      }
      evaluated++;
    }
  }
}
before.dispose();
after.dispose();
console.log(
  JSON.stringify(
    {
      triangles: original.length,
      matchedVertices: pairs.size,
      maximumPosition,
      maximumNormal,
      normalErrorsByMesh: Object.fromEntries(normalErrorsByMesh),
      poses,
      evaluated,
      maximumDeformed,
      maximumDeformedNormal,
    },
    null,
    2
  )
);
