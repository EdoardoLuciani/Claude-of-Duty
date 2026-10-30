import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { createAuthoredActions, sampleAuthoredAction } from '../../src/weapons/authored-actions.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { createWeaponInspection } from '../../src/weapons/inspection.ts';
import { M4Animation, makeM4Model } from '../../src/weapons/m4.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/m4a1-block-ii/', import.meta.url);
// Optional independently exported pre-skin reference for acceptance review.
// Ordinary CI compares the native and cooked actual skinned surfaces instead.
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
    const record = { mesh, index, position, uv: [uv.getX(index), uv.getY(index)] };
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
});
const matched = [];
const coverage = new Map();
model.root.traverse((mesh) => {
  if (!mesh.isMesh) return;
  mesh.skeleton?.update();
  const uv = mesh.geometry.attributes.uv;
  for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
    worldPosition(mesh, index, vertex);
    const [x, y, z] = cell(vertex);
    let best,
      distance = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const candidate of buckets.get([x + dx, y + dy, z + dz].join(',')) ?? []) {
            if (!mesh.isSkinnedMesh && candidate.mesh.name !== mesh.name) continue;
            if (
              Math.abs(uv.getX(index) - candidate.uv[0]) > 1e-7 ||
              Math.abs(uv.getY(index) - candidate.uv[1]) > 1e-7
            )
              continue;
            const delta = vertex.distanceTo(candidate.position);
            if (delta < distance) {
              best = candidate;
              distance = delta;
            }
          }
    assert(
      best && distance < 1e-7,
      `${mesh.name}/${index}: actual source surface preserved (${distance} m)`
    );
    const joint = mesh.isSkinnedMesh ? mesh.geometry.attributes.skinIndex.getX(index) : -1;
    if (mesh.isSkinnedMesh) {
      const weights = mesh.geometry.attributes.skinWeight;
      assert.equal(weights.getX(index), 1);
      assert.equal(weights.getY(index) + weights.getZ(index) + weights.getW(index), 0);
    }
    const owner = joint < 0 ? mesh.name : mesh.skeleton.bones[joint].name;
    const record = { mesh, index, reference: best, owner };
    matched.push(record);
    const owned = coverage.get(owner) ?? [];
    owned.push(record);
    coverage.set(owner, owned);
  }
});
assert.equal(coverage.size, 18, '13 weighted controls plus 5 rigid ownership-sensitive surfaces');
const dense = [...coverage.values()].flatMap((records) =>
  records.filter((_, i) => i % Math.max(1, Math.floor(records.length / 64)) === 0)
);
const actual = new THREE.Vector3(),
  expected = new THREE.Vector3();
// The cook's existing .00015-radian local quaternion bound can move a muzzle
// tens of micrometres; source-to-skin parity retains the original 2 µm gate.
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
    animation.skin.skeleton.update();
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
// Gameplay lockback must deform actual bolt/head vertices and survive gestures.
animation.reset();
animation.update(0.1, '', 0, false, true);
const boltVertices = coverage.get('bolt');
const seated = boltVertices.map(({ mesh, index }) =>
  worldPosition(mesh, index, new THREE.Vector3())
);
animation.update(0.1, '', 0, true, false);
for (let i = 0; i < boltVertices.length; i++) {
  const { mesh, index } = boltVertices[i];
  assert(Math.abs(worldPosition(mesh, index, vertex).z - seated[i].z - 0.062) < 0.000002);
}
// Gameplay cover override must deform its weighted vertices, not only a helper.
const coverVertices = coverage.get('dust_cover');
animation.reset();
animation.update(0, '', 0, false, true);
const closed = coverVertices.map(({ mesh, index }) =>
  worldPosition(mesh, index, new THREE.Vector3())
);
animation.fire();
animation.update(0.02, '', 0, false, true);
animation.skin.skeleton.update();
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
// SkeletonUtils clones must own bones/bone textures but borrow immutable surfaces.
const inspection = createWeaponInspection({ model, def: WEAPON_DEFS.rifle });
const inspectionScene = inspection.scene;
const skin = inspectionScene.getObjectByName('receiver_mesh');
assert.notEqual(skin.skeleton, animation.skin.skeleton);
assert.notEqual(skin.skeleton.bones[0], animation.skin.skeleton.bones[0]);
assert.equal(skin.geometry, animation.skin.geometry);
assert.equal(skin.material, animation.skin.material);
skin.skeleton.computeBoneTexture();
animation.skin.skeleton.computeBoneTexture();
assert.notEqual(skin.skeleton.boneTexture, animation.skin.skeleton.boneTexture);
let cloneDisposed = false,
  gameplayDisposed = false;
skin.skeleton.boneTexture.addEventListener('dispose', () => {
  cloneDisposed = true;
});
animation.skin.skeleton.boneTexture.addEventListener('dispose', () => {
  gameplayDisposed = true;
});
inspection.dispose();
assert(cloneDisposed && !gameplayDisposed);
animation.dispose();
assert(gameplayDisposed);
assert.equal(model.materials.size, 0);
console.log(
  `M4 mechanical skin: ${matched.length} rest vertices, ${coverage.size} surface/control owners, ${poses} fractional poses, ${vertexChecks} actual deformed vertex checks; maximum ${maximum} m; direct cover deformation, independent rounds, clone ownership and skeleton disposal passed (${process.env.M4_BASELINE ? 'pre-skin reference' : 'native reference'})`
);
