// Independent native representation comparison; supply a frozen pre-change GLB.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { inspectGLB, parseGLB } from './lib/glb-fixture.mjs';

const baselinePath = process.argv[2];
assert(baselinePath, 'usage: node tools/ax338-representation-parity.mjs frozen-baseline.glb');
const bytes = [baselinePath, 'assets/weapons/ax338/ax338.glb'].map((path) => readFileSync(path));
const products = await Promise.all(bytes.map((buffer) => parseGLB(buffer)));
const imageHashes = bytes.map((buffer) => {
  const { json, bin } = inspectGLB(buffer);
  return json.images
    .map((image) => {
      const view = json.bufferViews[image.bufferView],
        offset = view.byteOffset ?? 0;
      return createHash('sha256')
        .update(bin.subarray(offset, offset + view.byteLength))
        .digest('hex');
    })
    .sort();
});
assert.deepEqual(imageHashes[0], imageHashes[1], 'all three embedded image payloads unchanged');
const parts = ['receiver', 'handguard', 'stock', 'optic', 'bolt', 'trigger'];
function surfaces(gltf, part) {
  gltf.scene.updateMatrixWorld(true);
  const vertices = [],
    triangles = [];
  gltf.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const a = mesh.geometry.attributes,
      index = mesh.geometry.index;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const cache = new Map();
    for (let i = 0; i < index.count; i += 3) {
      const ids = [0, 1, 2].map((k) => index.getX(i + k));
      if (
        !ids.every((id) =>
          mesh.isSkinnedMesh
            ? mesh.skeleton.bones[a.skinIndex.getX(id)].name === `MECH_${part}`
            : mesh.parent.name === part || mesh.parent.parent?.name === part
        )
      )
        continue;
      triangles.push(
        ids.map((id) => {
          if (!cache.has(id)) {
            const vertex = {
              p: mesh.getVertexPosition(id, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld),
              n: new THREE.Vector3().fromBufferAttribute(a.normal, id).applyMatrix3(normalMatrix),
              uv: new THREE.Vector2().fromBufferAttribute(a.uv, id),
              uv1: new THREE.Vector2().fromBufferAttribute(a.uv1, id),
              color: a.color ? new THREE.Vector3().fromBufferAttribute(a.color, id) : null,
            };
            cache.set(id, vertex);
            vertices.push(vertex);
          }
          return cache.get(id);
        })
      );
    }
  });
  return { vertices, triangles };
}
let retainedAnimationTracks = 0;
for (const clip of products[0].animations) {
  const candidate = products[1].animations.find((other) => other.name === clip.name);
  assert(candidate, `${clip.name}: retained clip`);
  assert.equal(candidate.duration, clip.duration);
  const controls = clip.tracks.filter((track) => !track.name.startsWith('MECH_'));
  assert.equal(candidate.tracks.length, controls.length);
  for (const track of controls) {
    const other = candidate.tracks.find((copy) => copy.name === track.name);
    assert(other, `${clip.name}/${track.name}: retained control`);
    assert.equal(other.getInterpolation(), track.getInterpolation());
    assert.deepEqual(other.times, track.times);
    assert.deepEqual(other.values, track.values);
    retainedAnimationTracks++;
  }
}
const report = { retainedAnimationTracks, nativeImagePayloadsUnchanged: true };
for (const part of parts) {
  const [before, after] = products.map((gltf) => surfaces(gltf, part));
  assert.equal(before.triangles.length, after.triangles.length, `${part}: triangle count`);
  const grid = new Map(),
    size = 0.00001;
  const cell = (p) => p.toArray().map((v) => Math.floor(v / size));
  for (const v of before.vertices) {
    const key = cell(v.p).join(',');
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(v);
  }
  let maximumPosition = 0,
    maximumNormal = 0,
    changedNormals = 0,
    maximumUV1 = 0,
    maximumColor = 0;
  const matches = new Map();
  for (const v of after.vertices) {
    const c = cell(v.p),
      candidates = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          for (const other of grid.get([c[0] + x, c[1] + y, c[2] + z].join(',')) ?? [])
            if (v.uv.distanceTo(other.uv) < 0.000001 && v.p.distanceTo(other.p) < 0.000001)
              candidates.push(other);
    assert(candidates.length, `${part}: no baseline position/UV match`);
    const distance = Math.min(...candidates.map((other) => v.p.distanceTo(other.p)));
    const close = candidates.filter((other) => v.p.distanceTo(other.p) <= distance + 0.00000005);
    close.sort((a, b) => v.n.distanceTo(a.n) - v.n.distanceTo(b.n));
    const nearest = close[0],
      normal = v.n.distanceTo(nearest.n);
    maximumPosition = Math.max(maximumPosition, v.p.distanceTo(nearest.p));
    maximumNormal = Math.max(maximumNormal, normal);
    if (normal > 0.00001) changedNormals++;
    maximumUV1 = Math.max(maximumUV1, v.uv1.distanceTo(nearest.uv1));
    if (v.color) maximumColor = Math.max(maximumColor, v.color.distanceTo(nearest.color));
    matches.set(v, nearest);
  }
  const changedNormalTriangles = after.triangles.filter((tri) =>
    tri.some((v) => v.n.distanceTo(matches.get(v).n) > 0.00001)
  );
  const changedNormalArea = changedNormalTriangles.reduce(
    (sum, tri) => sum + new THREE.Triangle(...tri.map((v) => v.p)).getArea(),
    0
  );
  const ids = new Map(
    before.vertices.map((v) => [
      v,
      [...v.p.toArray(), ...v.uv.toArray()].map((n) => Math.round(n * 1e5 + 0.12345)).join(','),
    ])
  );
  const key = (tri) =>
    [0, 1, 2]
      .map((j) => [...tri.slice(j), ...tri.slice(0, j)].map((v) => ids.get(v)).join(','))
      .sort()[0];
  const original = new Set(before.triangles.map(key));
  const unmatched = after.triangles.filter(
    (tri) => !original.has(key(tri.map((v) => matches.get(v))))
  );
  const candidate = new Set(after.triangles.map((tri) => key(tri.map((v) => matches.get(v)))));
  const removed = before.triangles.filter((tri) => !candidate.has(key(tri)));
  const patchBoundary = (triangles) => {
    const edges = new Map();
    for (const tri of triangles)
      for (let i = 0; i < 3; i++) {
        const a = ids.get(tri[i]),
          b = ids.get(tri[(i + 1) % 3]);
        if (a === b) continue;
        const forward = `${a};${b}`,
          reverse = `${b};${a}`;
        if (edges.get(reverse)) edges.set(reverse, edges.get(reverse) - 1);
        else edges.set(forward, (edges.get(forward) ?? 0) + 1);
      }
    return [...edges].filter(([, count]) => count).sort();
  };
  const mapped = unmatched.map((tri) => tri.map((v) => matches.get(v)));
  assert.deepEqual(
    patchBoundary(mapped),
    patchBoundary(removed),
    `${part}: directed patch boundary/UV0`
  );
  const uvVertices = (triangles) => [...new Set(triangles.flat().map((v) => ids.get(v)))].sort();
  assert.deepEqual(
    uvVertices(mapped),
    uvVertices(removed),
    `${part}: patch positions and UV0 vertices`
  );
  assert(maximumUV1 < 0.0000001 && maximumColor < 0.0000001, `${part}: UV1/finish colours`);
  const baselineArea = removed.reduce(
    (sum, tri) => sum + new THREE.Triangle(...tri.map((v) => v.p)).getArea(),
    0
  );
  const area = unmatched.reduce(
    (sum, tri) => sum + new THREE.Triangle(...tri.map((v) => v.p)).getArea(),
    0
  );
  assert(Math.abs(area - baselineArea) < 0.0000000001, `${part}: retessellated patch area`);
  report[part] = {
    maximumUV1,
    maximumColor,
    baselineUnmatchedArea: baselineArea,
    directedBoundaryAndUVVerticesEqual: true,
    triangles: after.triangles.length,
    vertices: after.vertices.length,
    maximumPosition,
    maximumNormal,
    changedNormals,
    changedNormalTriangles: changedNormalTriangles.length,
    changedNormalArea,
    unmatchedTriangles: unmatched.length,
    unmatchedArea: area,
  };
}
console.log(JSON.stringify(report, null, 2));
