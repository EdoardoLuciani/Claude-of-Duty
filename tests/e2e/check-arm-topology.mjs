#!/usr/bin/env node
/** Compare actual old/new skinned surfaces in both hands and every authored pose.
 * node tests/e2e/check-arm-topology.mjs --control=/absolute/arms.glb --out=/tmp/topology.json
 * Sampled, bidirectional point-to-triangle distance; not exhaustive collision proof.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import * as THREE from 'three';

import { BANDAGE_POSES } from '../../src/weapons/bandage-path.ts';
import { Arm, HAND_POSES } from '../../src/weapons/hands.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('='))
);
assert(args.control && args.out, '--control and --out are required');
async function load(path) {
  const gltf = await parseGLB(readFileSync(path));
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse((object) => {
    if (object.isSkinnedMesh) meshes.push(object);
  });
  assert.equal(meshes.length, 5);
  return { meshes };
}
const control = await load(args.control);
const candidate = await load(new URL('../../public/models/player/arms.glb', import.meta.url));
const cell = 0.008;
const scratch = new THREE.Vector3();
function surface(mesh) {
  const positions = [];
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
    positions.push(mesh.getVertexPosition(i, new THREE.Vector3()));
  const triangles = [],
    grid = new Map();
  const index = mesh.geometry.index;
  for (let i = 0; i < index.count; i += 3) {
    const triangle = new THREE.Triangle(...[0, 1, 2].map((j) => positions[index.getX(i + j)]));
    triangles.push(triangle);
    const bounds = new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]);
    for (let x = Math.floor(bounds.min.x / cell); x <= Math.floor(bounds.max.x / cell); x++)
      for (let y = Math.floor(bounds.min.y / cell); y <= Math.floor(bounds.max.y / cell); y++)
        for (let z = Math.floor(bounds.min.z / cell); z <= Math.floor(bounds.max.z / cell); z++) {
          const key = `${x},${y},${z}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(triangles.length - 1);
        }
  }
  return { positions, triangles, grid };
}
function distances(from, to) {
  const distances = [];
  for (let i = 0; i < from.positions.length; i += 11) {
    const p = from.positions[i];
    const x = Math.floor(p.x / cell),
      y = Math.floor(p.y / cell),
      z = Math.floor(p.z / cell);
    let nearest = Infinity;
    const seen = new Set();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const index of to.grid.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
            if (seen.has(index)) continue;
            seen.add(index);
            to.triangles[index].closestPointToPoint(p, scratch);
            nearest = Math.min(nearest, p.distanceTo(scratch));
          }
    assert(Number.isFinite(nearest), 'every old/new surface sample must have a nearby candidate');
    distances.push(nearest);
  }
  return distances;
}
const report = [];
for (const side of [-1, 1]) {
  const old = new Arm(side),
    next = new Arm(side);
  try {
    old.attachAsset(control);
    next.attachAsset(candidate);
    Object.assign(old.poses, BANDAGE_POSES);
    Object.assign(next.poses, BANDAGE_POSES);
    for (const pose of Object.keys({ ...HAND_POSES, ...BANDAGE_POSES })) {
      for (const arm of [old, next]) {
        arm.setPose(pose);
        arm.solve(
          new THREE.Vector3(0.08, -0.05, -0.26),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, -0.3))
        );
        arm.root.updateMatrixWorld(true);
        arm.skeleton.update();
      }
      for (const mesh of old.skins) {
        const replacement = next.skins.find((m) => m.name === mesh.name);
        assert(replacement);
        const before = surface(mesh),
          after = surface(replacement);
        const values = [...distances(before, after), ...distances(after, before)].sort(
          (a, b) => a - b
        );
        const max = values.at(-1),
          p95 = values[Math.floor(values.length * 0.95)];
        report.push({
          side,
          pose,
          surface: mesh.name,
          samples: values.length,
          p95Metres: p95,
          maxMetres: max,
        });
      }
    }
  } finally {
    old.dispose();
    next.dispose();
  }
}
writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
for (const sample of report) {
  const limit = sample.surface.includes('Charcoal_') ? 0.001 : 0.002;
  assert(
    sample.maxMetres <= limit,
    `${sample.side} ${sample.pose} ${sample.surface}: ${(sample.maxMetres * 1000).toFixed(3)} mm > ${limit * 1000} mm`
  );
}
console.log(
  `Actual skinned topology: ${report.length} bidirectional pose/surface comparisons; max ${(Math.max(...report.map((s) => s.maxMetres)) * 1000).toFixed(4)} mm; glove <=1 mm and panels <=2 mm`
);
