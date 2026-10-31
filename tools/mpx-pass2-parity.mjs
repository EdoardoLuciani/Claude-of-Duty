// Independent native oriented-surface and normal audit across MPX representations.
// node tools/mpx-pass2-parity.mjs <reference-mpx.glb> [report.json] [candidate.glb]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import * as THREE from 'three';

import { inspectGLB, parseGLB } from './lib/glb-fixture.mjs';

assert.ok(process.argv[2], 'provide an independent MPX native GLB');
const bytes = [
  process.argv[2],
  process.argv[4] ?? new URL('../assets/weapons/sig-mpx/mpx.glb', import.meta.url),
].map((path) => readFileSync(path));
const fixtures = await Promise.all(bytes.map(parseGLB));
const [baseline, candidate] = bytes.map(inspectGLB);
let exactNamedControls = 0,
  exactOriginalChannels = 0;
for (const node of baseline.json.nodes) {
  if (node.mesh !== undefined || /^(MECH_|FRAME_|MPX_mechanics$)/.test(node.name)) continue;
  const replacement = candidate.json.nodes.find((other) => other.name === node.name);
  assert.ok(replacement, node.name);
  for (const key of ['translation', 'rotation', 'scale', 'matrix', 'extras'])
    assert.deepEqual(replacement[key], node[key], `${node.name}/${key}`);
  exactNamedControls++;
}
for (const clip of baseline.json.animations) {
  const replacement = candidate.json.animations.find((other) => other.name === clip.name);
  assert.ok(replacement, clip.name);
  for (const channel of clip.channels) {
    const name = baseline.json.nodes[channel.target.node].name;
    if (/^(MECH_|FRAME_)/.test(name)) continue;
    const other = replacement.channels.find(
      (entry) =>
        candidate.json.nodes[entry.target.node].name === name &&
        entry.target.path === channel.target.path
    );
    assert.ok(other, `${clip.name}/${name}/${channel.target.path}`);
    const a = clip.samplers[channel.sampler],
      b = replacement.samplers[other.sampler];
    assert.equal(a.interpolation, b.interpolation);
    for (const key of ['input', 'output'])
      assert.deepEqual(
        baseline.accessor(a[key]),
        candidate.accessor(b[key]),
        `${clip.name}/${name}/${key}`
      );
    exactOriginalChannels++;
  }
}
function owner(mesh, index) {
  if (mesh.isSkinnedMesh)
    return mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getX(index)].name.replace(
      /^(MECH|FRAME)_/,
      ''
    );
  const name = mesh.parent.name.endsWith('_mesh') ? mesh.parent.name : mesh.name;
  if (name.startsWith('receiver')) return 'receiver';
  if (name.startsWith('lens_cap_front')) return 'lens_cap_front';
  if (name.startsWith('lens_cap_rear')) return 'lens_cap_rear';
  return name.replace(/_mesh$/, '');
}
const matrix = new THREE.Matrix4();
function corner(mesh, index) {
  const { uv, uv1, color, normal } = mesh.geometry.attributes;
  const p = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  const n = new THREE.Vector3().fromBufferAttribute(normal, index);
  if (mesh.isSkinnedMesh) {
    const joint = mesh.geometry.attributes.skinIndex.getX(index);
    matrix
      .multiplyMatrices(mesh.skeleton.bones[joint].matrixWorld, mesh.skeleton.boneInverses[joint])
      .multiply(mesh.bindMatrix);
  } else matrix.copy(mesh.matrixWorld);
  n.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
  const values = [uv.getX(index), uv.getY(index), uv1.getX(index), uv1.getY(index)];
  const colors = [color.getX(index), color.getY(index), color.getZ(index), color.getW(index)];
  return { mesh, index, p, n, values, colors, owner: owner(mesh, index) };
}
function records(fixture) {
  fixture.scene.updateMatrixWorld(true);
  const result = [];
  fixture.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const indices = mesh.geometry.index;
    for (let i = 0; i < indices.count; i += 3)
      result.push([0, 1, 2].map((offset) => corner(mesh, indices.getX(i + offset))));
  });
  return result;
}
const triangles = fixtures.map(records);
assert.equal(triangles[0].length, triangles[1].length, 'unchanged triangle instances');
const key = (row) =>
  JSON.stringify([
    row.owner,
    ...row.colors.map((x) => Math.round(x * 65535)),
    ...[...row.p.toArray(), ...row.values].map((x) => Math.round(x * 1e4 + 0.12345)),
  ]);
const target = new Map();
for (const triangle of triangles[1]) {
  const id = triangle.map(key).join('|');
  const bucket = target.get(id) ?? [];
  bucket.push(triangle);
  target.set(id, bucket);
}
const report = {
  exactNamedControls,
  exactOriginalChannels,
  triangles: triangles[0].length,
  matchedOrientedTriangles: 0,
  maxPosition: 0,
  maxUV: 0,
  maxRestNormalVectorError: 0,
  maxAnimatedNormalVectorError: 0,
  animatedSamples: 0,
  allSurfaceAnimatedSamples: 0,
  maxAnimatedPosition: 0,
  affectedOwners: {},
  normalErrorBuckets: { over001: 0, over01: 0, over1: 0 },
  affectedStrictZeroAreaTriangles: 0,
  affectedNonzeroAreaTriangles: 0,
  affectedNonzeroAreaMin: null,
  affectedNonzeroAreaMax: 0,
};
const samples = new Map();
const surfacePairs = new Map();
for (const triangle of triangles[0]) {
  let match;
  for (let rotation = 0; rotation < 3 && !match; rotation++) {
    const ordered = triangle.slice(rotation).concat(triangle.slice(0, rotation));
    const bucket = target.get(ordered.map(key).join('|')) ?? [];
    const found = bucket.findIndex((candidate) =>
      candidate.every(
        (c, i) =>
          c.p.distanceTo(ordered[i].p) < 1e-6 &&
          c.values.every((x, j) => Math.abs(x - ordered[i].values[j]) <= 1.2e-7)
      )
    );
    if (found >= 0) match = [ordered, bucket.splice(found, 1)[0]];
  }
  assert.ok(match, 'oriented triangle/UV/finish/owner must match independently');
  const [before, after] = match;
  report.matchedOrientedTriangles++;
  let affected = false;
  for (let i = 0; i < 3; i++) {
    report.maxPosition = Math.max(report.maxPosition, before[i].p.distanceTo(after[i].p));
    report.maxUV = Math.max(
      report.maxUV,
      ...before[i].values.map((x, j) => Math.abs(x - after[i].values[j]))
    );
    surfacePairs.set(
      `${before[i].mesh.uuid}/${before[i].index}/${after[i].mesh.uuid}/${after[i].index}`,
      {
        before: before[i],
        after: after[i],
      }
    );
    const error = before[i].n.distanceTo(after[i].n);
    report.maxRestNormalVectorError = Math.max(report.maxRestNormalVectorError, error);
    for (const [name, limit] of [
      ['over001', 0.001],
      ['over01', 0.01],
      ['over1', 1],
    ])
      if (error > limit) report.normalErrorBuckets[name]++;
    if (error > 0.001) {
      affected = true;
      const name = before[i].owner;
      const stats = report.affectedOwners[name] ?? { corners: 0, maxVectorError: 0 };
      stats.corners++;
      stats.maxVectorError = Math.max(stats.maxVectorError, error);
      report.affectedOwners[name] = stats;
    }
    const set = samples.get(before[i].owner) ?? [];
    if (set.length < 12 || error > (set[0]?.error ?? 0)) {
      set.push({ before: before[i], after: after[i], error });
      set.sort((a, b) => b.error - a.error);
      set.length = Math.min(12, set.length);
      samples.set(before[i].owner, set);
    }
  }
  if (affected) {
    const area =
      before[1].p.clone().sub(before[0].p).cross(before[2].p.clone().sub(before[0].p)).length() / 2;
    if (area === 0) report.affectedStrictZeroAreaTriangles++;
    else {
      report.affectedNonzeroAreaTriangles++;
      report.affectedNonzeroAreaMin = Math.min(report.affectedNonzeroAreaMin ?? Infinity, area);
      report.affectedNonzeroAreaMax = Math.max(report.affectedNonzeroAreaMax, area);
    }
  }
}
const mixers = fixtures.map((fixture) => new THREE.AnimationMixer(fixture.scene));
for (let clip = 0; clip < fixtures[0].animations.length; clip++) {
  const source = fixtures[0].animations[clip];
  const actions = fixtures.map((fixture, i) =>
    mixers[i].clipAction(fixture.animations.find((a) => a.name === source.name))
  );
  for (const action of actions) {
    action.reset().play();
    action.paused = true;
  }
  for (let frame = 0; frame <= Math.ceil(source.duration * 120); frame++) {
    for (let i = 0; i < actions.length; i++) {
      actions[i].time = Math.min(source.duration, frame / 120);
      mixers[i].update(0);
      fixtures[i].scene.updateMatrixWorld(true);
    }
    const allSurfaces =
      frame === Math.ceil(source.duration * 120) ||
      frame % Math.max(1, Math.floor((source.duration * 120) / 20)) === 0;
    for (const pair of allSurfaces ? surfacePairs.values() : [...samples.values()].flat()) {
      const a = corner(pair.before.mesh, pair.before.index),
        b = corner(pair.after.mesh, pair.after.index);
      // Hidden magazines have singular transforms; their normal has no rendered
      // meaning. Mechanical surfaces are always scale-one throughout the clips.
      if (
        Math.abs(a.mesh.matrixWorld.determinant()) < 0.5 ||
        Math.abs(b.mesh.matrixWorld.determinant()) < 0.5
      )
        continue;
      report.maxAnimatedPosition = Math.max(report.maxAnimatedPosition, a.p.distanceTo(b.p));
      if (allSurfaces) report.allSurfaceAnimatedSamples++;
      report.maxAnimatedNormalVectorError = Math.max(
        report.maxAnimatedNormalVectorError,
        a.n.distanceTo(b.n)
      );
      report.animatedSamples++;
    }
  }
  for (const action of actions) action.stop();
}
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.ok(
  report.maxRestNormalVectorError < 0.001 &&
    report.maxAnimatedNormalVectorError < 0.001 &&
    report.maxAnimatedPosition < 1e-6,
  'independent reference positions and normal directions must survive representation changes'
);
