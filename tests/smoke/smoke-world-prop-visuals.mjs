#!/usr/bin/env node
/** Render-only tyre derivatives must never enter canonical collision/support inputs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { Rng } from '../../src/core/rng.ts';
import { Assembler } from '../../tools/worldgen/builder.js';
import { buildCollision } from '../../tools/worldgen/pack.js';
import { registerProps } from '../../tools/worldgen/props.js';

function fingerprint(geometry) {
  const hash = createHash('sha256');
  for (const name of Object.keys(geometry.attributes).sort()) {
    const attribute = geometry.getAttribute(name);
    hash.update(`${name}:${attribute.itemSize}:${attribute.normalized}`);
    hash.update(
      Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength)
    );
  }
  hash.update(
    Buffer.from(
      geometry.index.array.buffer,
      geometry.index.array.byteOffset,
      geometry.index.array.byteLength
    )
  );
  return hash.digest('hex');
}

const material = new THREE.MeshStandardMaterial();
const assembler = new Assembler({ materials: { get: () => material } });
registerProps(assembler, new Rng(0x5eed1234));
const expectedCanonical = new Map();
const sourceGeometries = [];
for (const id of ['tyre', 'tyre_small']) {
  const prototype = assembler._protos.get(id);
  const canonical = prototype.geo;
  const visual = prototype.visualGeo;
  assert.notEqual(visual, canonical);
  assert.equal(canonical.index.count / 3, 2380);
  assert.equal(
    visual.index.count / 3,
    952,
    '60% fewer triangles without changing the section profile'
  );
  assert.deepEqual(Object.keys(visual.attributes), Object.keys(canonical.attributes));
  for (const name of Object.keys(canonical.attributes)) {
    assert.equal(visual.attributes[name].itemSize, canonical.attributes[name].itemSize);
    assert.equal(visual.attributes[name].normalized, canonical.attributes[name].normalized);
    assert.ok(Array.from(visual.attributes[name].array).every(Number.isFinite), name);
  }
  const r = id === 'tyre' ? 0.33 : 0.26;
  const positions = visual.getAttribute('position');
  let minRadius = Infinity,
    maxRadius = 0;
  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(positions.getX(i), positions.getZ(i));
    minRadius = Math.min(minRadius, radius);
    maxRadius = Math.max(maxRadius, radius);
  }
  assert.ok(Math.abs(minRadius - r * 0.5) < 1e-6, 'open bead/hole radius retained');
  assert.ok(maxRadius >= r * 0.99 && maxRadius < r * 1.03, 'crown silhouette retained');
  const welded = mergeVertices(canonical);
  expectedCanonical.set(id, fingerprint(welded));
  welded.dispose();
  for (const geometry of [canonical, visual]) {
    let releases = 0;
    geometry.addEventListener('dispose', () => releases++);
    sourceGeometries.push(() => assert.equal(releases, 1, 'source owned/released exactly once'));
  }
  for (let i = 0; i < 28; i++) {
    assembler.put(
      id,
      i % 2 ? 0.5 : -0.5,
      i * 0.01,
      i % 4 < 2 ? 0.5 : -0.5,
      i * 0.1,
      1,
      [0.5, 0.75, 1]
    );
  }
}
const visualRoot = new THREE.Group();
const canonicalRoot = new THREE.Scene();
assembler.finalize(visualRoot, canonicalRoot);
const records = (root, name) =>
  root.children
    .filter((mesh) => mesh.name === name)
    .flatMap((mesh) =>
      Array.from({ length: mesh.count }, (_, i) =>
        JSON.stringify([
          ...mesh.instanceMatrix.array.slice(i * 16, (i + 1) * 16),
          ...mesh.instanceColor.array.slice(i * 3, (i + 1) * 3),
        ])
      )
    )
    .sort();
for (const id of ['tyre', 'tyre_small']) {
  const name = `prop_${id}`;
  const visual = visualRoot.children.filter((mesh) => mesh.name === name);
  const canonical = canonicalRoot.children.filter((mesh) => mesh.name === name);
  assert.equal(visual.length, 1, 'existing compact visual bucket, no extra draw batches');
  assert.equal(canonical.length, 4, 'canonical collision bucket order retained');
  assert.deepEqual(
    records(visualRoot, name),
    records(canonicalRoot, name),
    'identical instances/masks'
  );
  assert.notEqual(visual[0].geometry, canonical[0].geometry);
  for (const mesh of [...visual, ...canonical]) {
    assert.equal(mesh.material, material);
    assert.deepEqual(mesh.userData, visual[0].userData);
    assert.equal(mesh.castShadow, visual[0].castShadow);
    assert.equal(mesh.receiveShadow, visual[0].receiveShadow);
    assert.ok(mesh.boundingSphere.radius > 0);
  }
  assert.equal(
    fingerprint(canonical[0].geometry),
    expectedCanonical.get(id),
    'canonical attributes/topology unchanged'
  );
}
// Replacing render meshes must have no effect on actual cooked collision buffers.
const first = await buildCollision(canonicalRoot);
for (const mesh of visualRoot.children) mesh.geometry = new THREE.BoxGeometry();
const second = await buildCollision(canonicalRoot);
assert.equal(first.collideTris, second.collideTris);
assert.deepEqual(
  first.scene.children[0].children.map((mesh) => fingerprint(mesh.geometry)),
  second.scene.children[0].children.map((mesh) => fingerprint(mesh.geometry))
);
const owned = new Set(
  [...assembler._protos.values()].flatMap((p) => [p.geo, p.visualGeo]).filter(Boolean)
);
const releaseChecks = [];
for (const geometry of owned) {
  const before = fingerprint(geometry);
  let releases = 0;
  geometry.addEventListener('dispose', () => releases++);
  releaseChecks.push(() => {
    assert.equal(releases, 1, 'assembler owns both canonical and derivative outputs');
    assert.equal(fingerprint(geometry), before, 'disposal never mutates exported/borrowed buffers');
  });
}
for (const mesh of visualRoot.children) mesh.geometry.dispose();
assembler.dispose();
for (const check of [...sourceGeometries, ...releaseChecks]) check();
// Alias and unused cases must not double-dispose the transferred geometry.
for (const used of [false, true]) {
  const a = new Assembler({ materials: { get: () => material } });
  const geometry = new THREE.BoxGeometry();
  let releases = 0;
  geometry.addEventListener('dispose', () => releases++);
  a.proto('alias', { geo: geometry, visualGeo: geometry, key: 'steel' });
  if (used) a.put('alias', 0, 0, 0);
  a.finalize(new THREE.Group());
  a.dispose();
  assert.equal(releases, 1);
}
material.dispose();
console.log(
  'World prop visuals: 60% tyre triangle reduction; canonical collision, instances, masks and ownership preserved'
);
