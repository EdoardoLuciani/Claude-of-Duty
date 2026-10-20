#!/usr/bin/env node
/** Visual bucket coalescing preserves authored instances and canonical collision inputs. */
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { Assembler } from '../../tools/worldgen/builder.js';

const material = new THREE.MeshStandardMaterial();
for (const spec of [
  { name: 'compact', span: 2, count: 25, expected: 1 },
  { name: 'cell-limit', span: 64, count: 28, expected: 1 },
  { name: 'wide', span: 80, count: 28, expected: 4 },
  { name: 'chain', chain: true, span: 0, count: 28, expected: 2 },
  { name: 'lod', span: 2, count: 28, maxDist: 80, expected: 4 },
  { name: 'unchunked', span: 80, count: 28, chunk: false, expected: 1 },
  { name: 'small', span: 2, count: 24, expected: 1 },
]) {
  const a = new Assembler({ materials: { get: () => material } });
  const root = new THREE.Group();
  const collision = new THREE.Scene();
  a.proto(spec.name, {
    geo: new THREE.BoxGeometry(0.2, 0.3, 0.4),
    key: 'steel',
    castShadow: false,
    receiveShadow: false,
    noPrepass: true,
    maxDist: spec.maxDist,
    chunk: spec.chunk,
  });
  const expected = [],
    buckets = new Map();
  for (let i = 0; i < spec.count; i++) {
    // Joining the middle/left cells must not then admit the right cell:
    // pairwise spans fit 64 m, but the accumulated span would be 66 m.
    const x = spec.chain ? [-1, -65, 1][i % 3] : ((i % 2 ? 1 : -1) * spec.span) / 2;
    const z = ((i % 4 < 2 ? 1 : -1) * spec.span) / 2;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, i * 0.01, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.1),
      new THREE.Vector3(1 + i * 0.01, 1, 0.8)
    );
    const masks = i % 3 ? [i / spec.count, 0.25, 0.75] : null;
    a.place(spec.name, matrix, masks);
    const record = [...new Float32Array(matrix.elements), ...new Float32Array(masks ?? [1, 1, 1])];
    expected.push(record);
    const key =
      spec.chunk === false || spec.count <= 24 ? 0 : Math.floor(x / 64) * 97 + Math.floor(z / 64);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  }
  a.add('concrete', new THREE.BoxGeometry(1, 1, 1));
  a.finalize(root, collision);
  const visual = root.children.filter((o) => o.isInstancedMesh);
  const canonical = collision.children.filter((o) => o.isInstancedMesh);
  const rows = (mesh) =>
    Array.from({ length: mesh.count }, (_, i) => [
      ...mesh.instanceMatrix.array.slice(i * 16, (i + 1) * 16),
      ...(mesh.instanceColor?.array.slice(i * 3, (i + 1) * 3) ?? [1, 1, 1]),
    ]);
  const sorted = (records) => records.map((r) => JSON.stringify(r)).sort();
  assert.equal(visual.length, spec.expected, spec.name);
  assert.deepEqual(
    sorted(visual.flatMap(rows)),
    sorted(expected),
    `${spec.name}: transforms/masks`
  );
  assert.deepEqual(
    canonical.map(rows),
    [...buckets.values()],
    `${spec.name}: original bucket order`
  );
  assert.equal(a.stats.instances, spec.count);
  assert.equal(a.stats.drawCalls, visual.length + 1);
  assert.equal(a.stats.instTris, spec.count * 12);
  assert.equal(
    a.meshes.length,
    root.children.length,
    'only visuals enter renderer stats/ownership'
  );
  for (const mesh of [...visual, ...canonical]) {
    assert.equal(mesh.geometry, visual[0].geometry, 'shared, unmodified prototype geometry');
    assert.equal(mesh.material, material);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
    assert.equal(mesh.userData.owNoPrepass, true);
    assert.equal(mesh.userData.palette, 'steel');
    assert.equal(mesh.userData.owLodDist ?? 0, spec.maxDist ?? 0);
    assert.ok(mesh.boundingSphere?.radius > 0);
  }
  if (spec.maxDist) {
    assert.deepEqual(
      visual.map((m) => m.boundingSphere),
      canonical.map((m) => m.boundingSphere)
    );
  }
  const staticVisual = root.children.find((o) => !o.isInstancedMesh);
  const staticCanonical = collision.children.find((o) => !o.isInstancedMesh);
  assert.equal(staticVisual.geometry, staticCanonical.geometry);
  assert.deepEqual(staticVisual.userData, staticCanonical.userData);
  let releases = 0;
  visual[0].geometry.addEventListener('dispose', () => releases++);
  a.dispose();
  assert.equal(releases, 1, 'assembler releases shared prototype once');
}
material.dispose();
console.log(
  'World instance buckets: bounded visual joins, immutable LOD and canonical collision inputs OK'
);
