#!/usr/bin/env node
/** Small-clutter shadow policy survives authoring/export without changing physical inputs. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import * as THREE from 'three';

import { Rng } from '../../src/core/rng.ts';
import { Assembler } from '../../tools/worldgen/builder.js';
import { registerDressingProps } from '../../tools/worldgen/dressing.js';
import { buildCollision } from '../../tools/worldgen/pack.js';
import { registerProps } from '../../tools/worldgen/props.js';

const small = ['brick_a', 'brick_b', 'plank_a', 'plank_b', 'slab_shard', 'conduit_box', 'rock_a'];
const cover = [
  'sandbag_a',
  'sandbag_b',
  'sandbag_c',
  'jersey',
  'block_big',
  'block_small',
  'crate_a',
  'crate_b',
  'crate_c',
  'barrel_rust',
  'tyre',
  'tyre_small',
  'pallet',
];
const material = new THREE.MeshStandardMaterial();
const a = new Assembler({ materials: { get: () => material } });
const rng = new Rng(0x5eed1234);
registerProps(a, rng);
registerDressingProps(a, rng);
for (const id of [...small, ...cover]) {
  const p = a._protos.get(id);
  assert.ok(p, `${id}: authored prototype exists`);
  assert.equal(p.castShadow, !small.includes(id), `${id}: authored shadow policy`);
  assert.equal(p.receiveShadow, true, `${id}: still receives shadows`);
  assert.equal(p.noPrepass, false, `${id}: retains opaque prepass/AO`);
  a.place(id, new THREE.Matrix4(), [0.25, 0.5, 0.75]);
}
const visual = new THREE.Group(),
  canonical = new THREE.Scene();
a.finalize(visual, canonical);
for (const id of [...small, ...cover]) {
  const p = a._protos.get(id);
  const meshes = [visual, canonical].map((root) =>
    root.children.find((m) => m.name === `prop_${id}`)
  );
  for (const mesh of meshes) {
    assert.ok(mesh, `${id}: assembled mesh`);
    assert.equal(mesh.castShadow, p.castShadow);
    assert.equal(mesh.userData.castShadow, p.castShadow, 'exported runtime policy');
    assert.equal(mesh.geometry, p.geo, 'unmodified prototype geometry');
    assert.equal(mesh.receiveShadow, true);
    assert.equal(mesh.userData.owNoPrepass, undefined);
    assert.equal(mesh.userData.owLodDist ?? 0, p.maxDist);
    assert.deepEqual([...mesh.instanceColor.array], [0.25, 0.5, 0.75]);
  }
  assert.deepEqual(meshes[0].instanceMatrix.array, meshes[1].instanceMatrix.array);
}
// Collision is navigation's geometry input. Toggling shadow policy must not alter it.
const before = await buildCollision(canonical);
for (const mesh of canonical.children) {
  mesh.castShadow = true;
  mesh.userData.castShadow = true;
}
const after = await buildCollision(canonical);
const physical = (result) => {
  const rows = [];
  result.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    rows.push({
      name: mesh.name,
      data: mesh.userData,
      index: [...mesh.geometry.index.array],
      attributes: Object.fromEntries(
        Object.entries(mesh.geometry.attributes).map(([key, attr]) => [key, [...attr.array]])
      ),
      matrices: mesh.instanceMatrix ? [...mesh.instanceMatrix.array] : null,
    });
  });
  return rows;
};
assert.equal(before.collideTris, after.collideTris);
assert.deepEqual(
  physical(before),
  physical(after),
  'shadow policy cannot change collision/nav geometry'
);

const dir = new URL('../../public/models/world/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('level.json', dir)));
const glb = gunzipSync(readFileSync(new URL(manifest.assets.visual, dir)));
const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
for (const id of [...small, ...cover]) {
  const nodes = json.nodes.filter(
    (node) => node.name === `prop_${id}` || node.name?.startsWith(`prop_${id}_`)
  );
  assert.ok(nodes.length, `${id}: committed instance batches`);
  for (const node of nodes) {
    assert.equal(
      node.extras.castShadow,
      !small.includes(id),
      `${node.name}: committed caster policy`
    );
    assert.equal(node.extras.receiveShadow, true);
    assert.notEqual(node.extras.owNoPrepass, true);
  }
}
a.dispose();
material.dispose();
console.log(
  'World clutter shadows: authored/committed policy, critical cover, geometry, masks and physical inputs OK'
);
