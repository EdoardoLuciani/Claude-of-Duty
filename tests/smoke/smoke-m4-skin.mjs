import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { createAuthoredActions, sampleAuthoredAction } from '../../src/weapons/authored-actions.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { createWeaponInspection } from '../../src/weapons/inspection.ts';
import { M4Animation, makeM4Model } from '../../src/weapons/m4.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/m4a1-block-ii/', import.meta.url);
// Optional immutable full-body-skin reference for acceptance review.
// Ordinary CI compares the native and cooked actual ordinary surfaces instead.
const referencePath = process.env.M4_BASELINE ?? new URL('m4a1-block-ii.glb', dir);
const reference = await parseGLB(readFileSync(referencePath));
const refRoot = reference.scene.getObjectByName('M4_RIG');
const sampler = { root: refRoot, mixer: new THREE.AnimationMixer(refRoot), name: null };
sampler.actions = createAuthoredActions(sampler.mixer, reference.animations);
const model = makeM4Model(
  await parseGLB(
    readFileSync(
      new URL(process.env.M4_BASELINE ? 'm4a1-block-ii.glb' : 'm4a1-block-ii.runtime.glb', dir)
    )
  )
);
const animation = new M4Animation(model);
// Match real vertices in invertible rest seats, never the hidden spare's origin.
for (const root of [refRoot, model.root]) {
  for (const name of [
    'magazine',
    'magazine_spare',
    'magazine_round',
    'magazine_spare_round',
    'spent_case',
  ])
    root.getObjectByName(name).scale.setScalar(1);
  root.updateMatrixWorld(true);
}
const vertex = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();
const worldNormal = (mesh, index) =>
  new THREE.Vector3()
    .fromBufferAttribute(mesh.geometry.attributes.normal, index)
    .applyNormalMatrix(normalMatrix.getNormalMatrix(mesh.matrixWorld));
const worldPosition = (mesh, index, target) =>
  mesh.getVertexPosition(index, target).applyMatrix4(mesh.matrixWorld);
const buckets = new Map();
const cell = (v) => [v.x, v.y, v.z].map((value) => Math.floor(value * 1e5));
refRoot.traverse((mesh) => {
  if (!mesh.isMesh) return;
  mesh.skeleton?.update();
  const uv = mesh.geometry.attributes.uv;
  for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
    const position = worldPosition(mesh, index, new THREE.Vector3());
    const key = cell(position).join(',');
    const record = {
      mesh,
      index,
      position,
      normal: worldNormal(mesh, index),
      uv: [uv.getX(index), uv.getY(index)],
    };
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
});
const matched = [];
const coverage = new Map();
const normalDeviations = [];
// d29573f8 full-skin export rounded these local-frame normals differently.
// Approved baseline-only bound: <=0.0172 degrees, no cooked-normal exception.
const localFrameNormalMeshes = new Set([
  'bolt_head_mesh',
  'bolt_mesh',
  'charging_handle_mesh',
  'dust_cover_mesh',
  'mag_release_mesh',
  'Front_sight_post',
]);
model.root.traverse((mesh) => {
  if (!mesh.isMesh) return;
  assert(!mesh.isSkinnedMesh, `${mesh.name}: ordinary geometry, no full-body skin`);
  assert.equal(mesh.geometry.attributes.skinIndex, undefined);
  assert.equal(mesh.geometry.attributes.skinWeight, undefined);
  const owner = [
    'Front_sight_post',
    'Front_sight_tip',
    'MaTech_aperture_stalk',
    'MaTech_open_aperture',
  ].includes(mesh.name)
    ? mesh.name
    : mesh.parent.name;
  mesh.skeleton?.update();
  const uv = mesh.geometry.attributes.uv;
  for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
    worldPosition(mesh, index, vertex);
    const [x, y, z] = cell(vertex);
    const normal = worldNormal(mesh, index);
    let best,
      distance = Infinity,
      normalDistance = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const candidate of buckets.get([x + dx, y + dy, z + dz].join(',')) ?? []) {
            if (!candidate.mesh.isSkinnedMesh && candidate.mesh.name !== mesh.name) continue;
            if (
              Math.abs(uv.getX(index) - candidate.uv[0]) > 1e-7 ||
              Math.abs(uv.getY(index) - candidate.uv[1]) > 1e-7
            )
              continue;
            const delta = vertex.distanceTo(candidate.position);
            const directionDelta = normal.distanceTo(candidate.normal);
            if (
              delta < 1e-7 &&
              (directionDelta < normalDistance ||
                (directionDelta === normalDistance && delta < distance))
            ) {
              best = candidate;
              distance = delta;
              normalDistance = directionDelta;
            }
          }
    assert(
      best && distance < 1e-7,
      `${mesh.name}/${index}: actual source surface preserved (${distance} m)`
    );
    const normalTolerance =
      process.env.M4_BASELINE && localFrameNormalMeshes.has(mesh.name) ? 0.0003001 : 0.000002;
    assert(
      normalDistance < normalTolerance,
      `${mesh.name}/${index}: source normal deviation ${normalDistance}`
    );
    if (normalDistance > 0.000002)
      normalDeviations.push({ mesh: mesh.name, index, normalDistance });
    const record = { mesh, index, reference: best, owner };
    matched.push(record);
    const owned = coverage.get(owner) ?? [];
    owned.push(record);
    coverage.set(owner, owned);
  }
});
const normalSummary = [];
for (const name of new Set(normalDeviations.map((entry) => entry.mesh))) {
  const mesh = model.root.getObjectByName(name);
  const affected = normalDeviations.filter((entry) => entry.mesh === name);
  const indices = new Set(affected.map((entry) => entry.index));
  let triangles = 0,
    area = 0;
  const triangle = new THREE.Triangle();
  for (let i = 0; i < mesh.geometry.index.count; i += 3) {
    const vertices = [0, 1, 2].map((offset) => mesh.geometry.index.getX(i + offset));
    if (!vertices.some((index) => indices.has(index))) continue;
    triangles++;
    triangle.set(...vertices.map((index) => worldPosition(mesh, index, new THREE.Vector3())));
    area += triangle.getArea();
  }
  normalSummary.push({
    name,
    vertices: affected.length,
    triangles,
    area,
    maximum: Math.max(...affected.map((entry) => entry.normalDistance)),
  });
}
console.log('M4_NORMAL_DIAGNOSTIC', JSON.stringify(normalSummary));
assert.equal(
  coverage.size,
  18,
  '13 ordinary assembly/control surfaces plus 5 ownership-sensitive surfaces'
);
const dense = [...coverage.values()].flatMap((records) =>
  records.filter((_, i) => i % Math.max(1, Math.floor(records.length / 64)) === 0)
);
const actual = new THREE.Vector3(),
  expected = new THREE.Vector3();
// The cook's existing .00015-radian local quaternion bound can move a muzzle
// tens of micrometres; full-skin-to-ordinary parity retains the original 2 µm gate.
let poses = 0,
  vertexChecks = 0,
  maximum = 0;
animation._sample('Fire', 0);
for (const clip of model.animations) {
  const times = new Set([0, clip.duration]);
  for (let frame = 0; frame <= Math.floor(clip.duration * 240); frame++) times.add(frame / 240);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
  for (const event of manifest.clips[clip.name].events)
    for (const delta of [-1e-6, 0, 1e-6])
      times.add(Math.max(0, Math.min(clip.duration, event.time + delta)));
  for (const time of times) {
    sampleAuthoredAction(sampler, clip.name, time);
    animation._sample(clip.name, time);
    refRoot.updateMatrixWorld(true);
    model.root.updateMatrixWorld(true);
    refRoot.traverse((node) => {
      if (node.isSkinnedMesh) node.skeleton.update();
    });
    // Dense fractional/event-adjacent controls plus every vertex every 0.1 s.
    const records = Math.abs(time * 10 - Math.round(time * 10)) < 1e-6 ? matched : dense;
    for (const record of records) {
      worldPosition(record.mesh, record.index, actual);
      worldPosition(record.reference.mesh, record.reference.index, expected);
      const distance = actual.distanceTo(expected);
      maximum = Math.max(maximum, distance);
      assert(
        distance < (process.env.M4_BASELINE ? 0.000002 : 0.0001),
        `${clip.name}/${time}/${record.owner}: actual vertex deviation ${distance} m`
      );
      vertexChecks++;
    }
    poses++;
  }
}
// Gameplay lockback must move actual bolt/head vertices and survive gestures.
animation.reset();
animation.update(0.1, '', 0, false, true);
const boltVertices = coverage.get('bolt');
const seated = boltVertices.map(({ mesh, index }) =>
  worldPosition(mesh, index, new THREE.Vector3())
);
const headVertices = coverage.get('bolt_head');
const seatedHead = headVertices.map(({ mesh, index }) =>
  worldPosition(mesh, index, new THREE.Vector3())
);
const headPivot = animation.boltHead.getWorldPosition(new THREE.Vector3());
animation.update(0.1, '', 0, true, false);
for (let i = 0; i < boltVertices.length; i++) {
  const { mesh, index } = boltVertices[i];
  assert(Math.abs(worldPosition(mesh, index, vertex).z - seated[i].z - 0.062) < 0.000002);
}
const unlock = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 8);
for (let i = 0; i < headVertices.length; i++) {
  const { mesh, index } = headVertices[i];
  expected.copy(seatedHead[i]).sub(headPivot).applyQuaternion(unlock).add(headPivot);
  expected.z += 0.062;
  assert(
    worldPosition(mesh, index, vertex).distanceTo(expected) < 0.000002,
    'empty override rotates actual nested head vertices and translates with carrier'
  );
}
// Gameplay cover override must move actual vertices, not only a helper.
const coverVertices = coverage.get('dust_cover');
animation.reset();
animation.update(0, '', 0, false, true);
const closed = coverVertices.map(({ mesh, index }) =>
  worldPosition(mesh, index, new THREE.Vector3())
);
animation.fire();
animation.update(0.02, '', 0, false, true);
assert(
  coverVertices.some(
    ({ mesh, index }, i) => worldPosition(mesh, index, vertex).distanceTo(closed[i]) > 0.001
  )
);
const open = animation.cover.quaternion.clone();
for (const clip of ['inspect', 'draw', 'holster', '']) {
  animation.update(0.3, clip, 0.2, true, false);
  assert(animation.cover.quaternion.angleTo(open) < 1e-7, 'direct cover override persists');
  assert(!animation.magazineRound.visible && animation.magazineRound.isObject3D);
}
// Inspection owns ordinary transforms and borrows immutable surfaces/materials.
const inspection = createWeaponInspection({ model, def: WEAPON_DEFS.rifle });
const receiver = inspection.scene.getObjectByName('receiver_mesh');
const gameplayReceiver = model.root.getObjectByName('receiver_mesh');
assert.notEqual(receiver, gameplayReceiver);
assert.equal(receiver.geometry, gameplayReceiver.geometry);
assert.equal(receiver.material, gameplayReceiver.material);
assert.equal(receiver.skeleton, undefined);
assert.equal(inspection.scene.getObjectByName('bolt').skeleton, undefined);
assert(inspection.scene.getObjectByName('bolt').position.distanceTo(animation.boltRest) < 0.000002);
assert(
  inspection.scene.getObjectByName('dust_cover').quaternion.angleTo(new THREE.Quaternion()) < 1e-7
);
assert(animation.cover.quaternion.angleTo(open) < 1e-7, 'inspection preserves live cover override');
assert(
  animation.bolt.position.z > animation.boltRest.z + 0.061,
  'inspection preserves live lockback'
);
const gameplayPosition = gameplayReceiver.position.clone();
receiver.position.x += 1;
assert(gameplayReceiver.position.equals(gameplayPosition), 'independent inspection transforms');
let geometryDisposed = false,
  materialDisposed = false;
receiver.geometry.addEventListener('dispose', () => {
  geometryDisposed = true;
});
receiver.material.addEventListener('dispose', () => {
  materialDisposed = true;
});
inspection.dispose();
assert(!geometryDisposed && !materialDisposed, 'inspection never disposes borrowed surfaces');
animation.dispose();
assert(!geometryDisposed && materialDisposed, 'adapter disposes owned material only');
assert.equal(model.materials.size, 0);
console.log(
  `M4 ordinary representation: ${matched.length} rest vertices, ${coverage.size} surface/control owners, ${poses} fractional poses, ${vertexChecks} actual moving vertex checks; maximum ${maximum} m; direct cover motion, independent rounds, clone ownership and material disposal passed (${process.env.M4_BASELINE ? 'immutable full-skin reference' : 'native reference'})`
);
