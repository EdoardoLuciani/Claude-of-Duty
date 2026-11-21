#!/usr/bin/env bun
/** Validate the native hull with Three's loader, then publish the GLB unchanged. */
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { isMesh } from '../../../src/core/three-guards.ts';

const root = resolve(import.meta.dir, '../../..');
const argv = process.argv.slice(2);
assert(argv.length === 0 || argv.length === 2, 'usage: bun cook.ts [input.glb output.glb]');
const [input, output] = argv.length
  ? argv.map((file): string => resolve(file))
  : [
      resolve(root, '.cache/blender/fx/spent-hull/spent12g.glb'),
      resolve(root, 'public/models/fx/spent12g.glb'),
    ];
assert.notEqual(input, output, 'do not overwrite the native export');

const bytes = await Bun.file(input).arrayBuffer();
const { scene } = await new GLTFLoader().parseAsync(bytes, '');
const [mesh] = scene.children;
assert(scene.children.length === 1 && isMesh(mesh) && mesh.name === 'spent12g', 'one named hull');
assert(
  !Array.isArray(mesh.material) &&
    mesh.children.length === 0 &&
    mesh.position.lengthSq() === 0 &&
    mesh.quaternion.x === 0 &&
    mesh.quaternion.y === 0 &&
    mesh.quaternion.z === 0 &&
    mesh.quaternion.w === 1 &&
    mesh.scale.x === 1 &&
    mesh.scale.y === 1 &&
    mesh.scale.z === 1,
  'one material and identity transform; the casing pool consumes geometry alone'
);
const geometry = mesh.geometry;
const { position, normal, color, _shellpbr: pbr } = geometry.attributes;
const index = geometry.index;
assert.deepEqual(Object.keys(geometry.attributes).sort(), [
  '_shellpbr',
  'color',
  'normal',
  'position',
]);
assert(
  position.itemSize === 3 && normal.itemSize === 3 && color.itemSize === 4 && pbr.itemSize === 2
);
assert(
  color.normalized && pbr.array instanceof Float32Array,
  'linear color and float metal/rough pairs'
);
assert(
  index && index.count % 3 === 0 && index.count > 0 && index.count <= 1920,
  'indexed triangle budget'
);
assert(position.count <= 462 && bytes.byteLength <= 25_000, 'vertex and file size budgets');
assert(
  [normal, color, pbr].every((attr): boolean => attr.count === position.count),
  'one normal, color and PBR pair per exported vertex'
);
geometry.computeBoundingBox();
const bounds = geometry.boundingBox;
assert(bounds);
for (const [i, half] of [0.00495, 0.0225, 0.00495].entries()) {
  assert(Math.abs(bounds.min.getComponent(i) + half) < 1e-7, 'reference-basis minimum');
  assert(Math.abs(bounds.max.getComponent(i) - half) < 1e-7, 'reference-basis maximum');
}
let metal = 0;
for (let i = 0; i < pbr.count; i++) {
  const m = pbr.getX(i),
    r = pbr.getY(i);
  assert((m === 0 || m === 1) && r >= 0 && r <= 1, 'valid metal/rough values');
  metal += m;
}
assert(metal > 0 && metal < pbr.count, 'both brass and plastic');
for (let i = 0; i < index.count; i += 3) {
  const firstMetal: number = pbr.getX(index.getX(i));
  assert(
    (firstMetal === 0 || firstMetal === 1) &&
      firstMetal === pbr.getX(index.getX(i + 1)) &&
      firstMetal === pbr.getX(index.getX(i + 2)),
    'no mixed-metal triangles'
  );
}

// The pinned gltfpack drops _SHELLPBR even with -kv. Native triangles and vertex
// finishes are already within budget: keep the validated export byte-for-byte.
mkdirSync(dirname(output), { recursive: true });
const temp = `${output}.tmp-${process.pid}`;
try {
  await Bun.write(temp, bytes);
  renameSync(temp, output);
} finally {
  rmSync(temp, { force: true });
}
console.log(
  `Cooked ${input} -> ${output} (${position.count} vertices, ${index.count / 3} triangles, ${bytes.byteLength} bytes)`
);
