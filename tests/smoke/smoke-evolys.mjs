// Actual committed Blender asset and its runtime animation contract, no GPU/DCC.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import manifest from '../../assets/weapons/fn-evolys-762/manifest.json' with { type: 'json' };
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { makeEvolysModel, EvolysAnimation, EVOLYS_URL } from '../../src/weapons/evolys.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';
const bytes = readFileSync(new URL(EVOLYS_URL));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const primitives = json.nodes
  .filter((n) => n.mesh !== undefined)
  .flatMap((n) => json.meshes[n.mesh].primitives);
const triangles = primitives.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
assert.equal(triangles, manifest.stats.triangles);
assert.equal(primitives.length, manifest.stats.primitives);
assert(
  triangles < 54000 &&
    primitives.length === 26 &&
    json.materials.length === 10 &&
    bytes.length <= 15 * 1024 * 1024
);
assert.equal(json.images.length, 3);
assert(
  json.buffers.every((b) => !b.uri) && json.images.every((i) => i.bufferView !== undefined),
  'self-contained GLB'
);
for (const image of json.images) {
  const view = json.bufferViews[image.bufferView];
  const offset = 20 + bytes.readUInt32LE(12) + 8 + view.byteOffset;
  assert.equal(bytes.readUInt32BE(offset + 16), 1024);
  assert.equal(bytes.readUInt32BE(offset + 20), 1024);
}
for (const mat of json.materials) {
  const p = mat.pbrMetallicRoughness;
  assert(
    p.baseColorFactor && p.baseColorFactor.slice(0, 3).some((c) => c < 0.8),
    `${mat.name}: authored colour, not uncoloured white`
  );
  assert(
    p.baseColorTexture && p.metallicRoughnessTexture && mat.normalTexture,
    `${mat.name}: original PBR detail`
  );
}
const beltNode = json.nodes.find((n) => n.name === 'belt_mesh');
assert(beltNode.skin !== undefined, 'belt uses one exported native skin');
assert.equal(
  json.meshes[beltNode.mesh].primitives.length,
  3,
  'brass/projectile/link batches, not per-round submissions'
);
assert.equal(json.skins[beltNode.skin].joints.length, 8);
assert(
  !json.nodes.some((n) => /bipod|spent_case|EVOLYS_arm/.test(n.name)),
  'no bipod, duplicate cases or duplicate exported arms'
);
for (const [label, candidate] of [
  ['native', bytes],
  [
    'runtime',
    readFileSync(
      new URL('../../assets/weapons/fn-evolys-762/fn-evolys-762.runtime.glb', import.meta.url)
    ),
  ],
]) {
  const document = JSON.parse(candidate.subarray(20, 20 + candidate.readUInt32LE(12)));
  assert.equal(document.animations.length, 8);
  assert.equal(
    document.materials.length,
    10,
    'distinct finishes and optical alpha remain separate'
  );
  assert.equal(
    document.nodes
      .filter((n) => n.mesh !== undefined)
      .flatMap((n) => document.meshes[n.mesh].primitives).length,
    26
  );
  assert(
    document.nodes.some((n) => n.name === 'static_surfaces'),
    'native source/export consolidation, not a runtime merge'
  );
  const gltf = await parseGLB(candidate);
  const model = makeEvolysModel(gltf),
    anim = new EvolysAnimation(model);
  for (const material of model.materials) {
    const source = document.materials.find((m) => m.name === material.name).pbrMetallicRoughness;
    const native = json.materials.find((m) => m.name === material.name).pbrMetallicRoughness;
    assert.deepEqual(
      source.baseColorFactor.map(Math.fround),
      native.baseColorFactor.map(Math.fround)
    );
    assert.equal(Math.fround(source.metallicFactor), Math.fround(native.metallicFactor));
    assert.equal(Math.fround(source.roughnessFactor), Math.fround(native.roughnessFactor));
    assert(material.isMeshPhysicalNodeMaterial, 'EVOLYS enters the native indirect-light hook');
    assert.deepEqual(material.color.toArray(), (source.baseColorFactor ?? [1, 1, 1]).slice(0, 3));
    assert.equal(material.metalness, source.metallicFactor ?? 1);
    assert.equal(material.roughness, source.roughnessFactor ?? 1);
    assert.equal(material.specularIntensity, 1, 'no reintroduced view-rig compensation');
    assert.equal(material.transmission, 0, 'no scene transmission pass');
    if (material.name.startsWith('10 |'))
      assert.equal(material.opacity, 0.13, 'retained RMR thin-alpha lens');
  }
  assert.equal(anim.constructor.name, 'EvolysAnimation');
  assert.equal(model.reactiveFire, true, 'preserve shared reactive recoil, no extra baked kick');
  assert.equal(Object.keys(anim.actions).length, 8);
  for (const [name, duration] of [
    ['reloadTac', WEAPON_DEFS.lmg.reloadTac],
    ['reloadEmpty', WEAPON_DEFS.lmg.reloadEmpty],
    ['inspect', WEAPON_DEFS.lmg.inspectTime],
    ['draw', WEAPON_DEFS.lmg.drawTime],
    ['holster', WEAPON_DEFS.lmg.holsterTime],
  ]) {
    assert.equal(anim.clips()[name].duration, duration);
  }
  for (const action of Object.values(anim.actions)) {
    const clip = action.getClip();
    assert.equal(clip.duration, Math.fround(manifest.clips[clip.name].duration));
    for (const track of clip.tracks) {
      assert(track.values.every(Number.isFinite));
      assert(
        Math.abs(track.times.at(-1) - clip.duration) < 1e-6 ||
          (label === 'runtime' && track.times.length === 1 && track.times[0] === 0),
        `${clip.name}: complete channel`
      );
      for (let i = 1; i < track.times.length; i++)
        assert(track.times[i] >= track.times[i - 1], `${clip.name}: ordered sampler`);
    }
  }
  const point = new THREE.Vector3(),
    start = new THREE.Vector3();
  anim.fire();
  anim.update(0, null, 0, false, true, 99);
  anim.bones[3].getWorldPosition(start);
  anim.update(0.06, null, 0, false, true, 99);
  anim.bones[3].getWorldPosition(point);
  assert(
    Math.abs(point.distanceTo(start) - manifest.belt.pitch) < 0.0002,
    'one cartridge pitch per fire cycle'
  );
  assert(point.x > start.x && point.y > start.y, 'feeds into the left receiver, not away');
  const indexed = point.clone();
  anim.update(1, null, 0, false, true, 99);
  anim.bones[3].getWorldPosition(point);
  const stopped = point.clone();
  anim.update(1, null, 0, false, true, 99);
  anim.bones[3].getWorldPosition(point);
  assert(point.distanceTo(stopped) < 1e-6, 'belt does not scroll while not firing');
  assert(indexed.distanceTo(start) > 0.01);
  anim.fire();
  anim.update(0, null, 0, false, true, 2);
  assert.equal(
    anim.bones.filter((b) => b.scale.x > 0.5).length,
    3,
    'two remaining + one departing round'
  );
  anim.update(1, null, 0, false, true, 2);
  assert.equal(anim.bones.filter((b) => b.scale.x > 0.5).length, 2, 'last rounds visibly run out');
  anim.fire();
  anim.update(0.04, null, 0, true, false, 0);
  assert.equal(anim.name, 'Last_Shot');
  assert(anim.belt.visible);
  anim.update(0.08, null, 0, true, false, 0);
  assert(!anim.belt.visible);
  for (const [clip, source] of [
    ['reloadTac', 'Reload_Tactical'],
    ['reloadEmpty', 'Reload_Empty'],
  ]) {
    const info = manifest.clips[source],
      insert = info.beltInsertTime;
    anim.update(0, clip, info.beltClearTime + 0.03, true, false, 0);
    assert(!anim.belt.visible && anim.cover.rotation.y < -0.5, 'open side cover and cleared belt');
    anim.update(0, clip, insert - 0.001, true, false, 0);
    assert(!anim.belt.visible);
    anim.update(0, clip, insert, false, true, 100);
    assert(anim.belt.visible);
    assert.equal(
      anim.bones.filter((b) => b.scale.x > 0.5).length,
      8,
      'restored at insertion, no sticky zero scales'
    );
    anim.update(0, clip, info.duration * 0.48, true, false, 0);
    assert(anim.spare.visible && !anim.pouch.visible);
    let meshes = 0;
    anim.spare.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        assert(
          Math.abs(Math.abs(o.matrixWorld.determinant()) - 1) < 1e-5,
          'spare geometry not permanently collapsed'
        );
      }
    });
    assert(meshes > 0);
    anim.reset();
    assert(!anim.spare.visible && anim.pouch.visible);
    assert(
      anim.cover.quaternion.angleTo(new THREE.Quaternion()) < 1e-6,
      'interruption closes side cover'
    );
  }
  anim.update(0, null, 0, false, true, 1);
  anim.reset();
  assert.equal(
    anim.bones.filter((b) => b.scale.x > 0.5).length,
    1,
    'switch/reset preserves remaining count'
  );
  // Verify rendered skin positions, not only the ammunition-control bone scales.
  anim.update(0, null, 0, false, true, 1);
  let skinCount = 0;
  anim.belt.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    skinCount++;
    mesh.skeleton.update();
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    const bounds = new Map();
    for (let i = 0; i < position.count; i++) {
      assert.equal(skinWeight.getX(i), 1, 'mechanical belt vertices keep one full influence');
      assert.equal(skinWeight.getY(i) + skinWeight.getZ(i) + skinWeight.getW(i), 0);
      const bone = mesh.skeleton.bones[skinIndex.getX(i)];
      assert(/^belt_[0-7]$/.test(bone.name));
      const box = bounds.get(bone) ?? new THREE.Box3();
      mesh.getVertexPosition(i, point);
      assert(point.toArray().every(Number.isFinite));
      box.expandByPoint(point);
      bounds.set(bone, box);
    }
    for (const [bone, box] of bounds) {
      const extent = box.getSize(new THREE.Vector3()).length();
      if (bone.name === 'belt_0') assert(extent > 0.003, 'live round/link surfaces remain visible');
      else assert(extent < 1e-7, 'spent round/link triangles really collapse, no ghost ammunition');
    }
  });
  assert.equal(skinCount, 3, 'one belt skin, three finish primitives');
  anim.update(0, null, 0, false, true, 101);
  assert.equal(
    anim.bones.filter((b) => b.scale.x > 0.5).length,
    8,
    'new-game/refill restores tail visibility'
  );
  for (const name of ['reloadTac', 'reloadEmpty', 'inspect', 'draw', 'holster']) {
    const clip = anim.clips()[name];
    for (let i = 0; i <= 120; i++) {
      anim.update(0, name, (clip.duration * i) / 120, false, true, 100);
      anim.handTarget('left', point, new THREE.Quaternion());
      assert(point.toArray().every(Number.isFinite));
      anim.handTarget('right', point, new THREE.Quaternion());
      assert(point.toArray().every(Number.isFinite));
    }
  }
  assert.equal(WEAPON_DEFS.lmg.rpm, 700);
  assert.equal(WEAPON_DEFS.lmg.magSize, 100);
  assert.equal(WEAPON_DEFS.lmg.damage, 48);
  anim.dispose();
  assert.equal(model.materials.size, 0);
  assert.equal(model.textures.size, 0);
  console.log(
    `EVOLYS ${label}: native ${triangles} triangles / ${primitives.length} primitive instances; PBR, eight clips, native belt pitch, ammo tail, feed insertion, interruption, spare transforms and cleanup passed`
  );
}

// Constant-key reduction is allowed only with the same authored pose/STEP
// behavior. Check the complete control hierarchy, sockets and hand contacts on
// a 240 Hz lattice plus both sides of every authored visibility transition.
const nativeAnimation = new EvolysAnimation(makeEvolysModel(await parseGLB(bytes)));
const packedAnimation = new EvolysAnimation(
  makeEvolysModel(
    await parseGLB(
      readFileSync(
        new URL('../../assets/weapons/fn-evolys-762/fn-evolys-762.runtime.glb', import.meta.url)
      )
    )
  )
);
const controlNames = json.nodes.filter((node) => node.mesh === undefined).map((node) => node.name);
const positionA = new THREE.Vector3(),
  positionB = new THREE.Vector3();
const rotationA = new THREE.Quaternion(),
  rotationB = new THREE.Quaternion();
const scaleA = new THREE.Vector3(),
  scaleB = new THREE.Vector3();
let maximumPosition = 0,
  maximumRotation = 0,
  maximumScale = 0,
  sampledPoses = 0;
for (const [name, action] of Object.entries(nativeAnimation.actions)) {
  const duration = action.getClip().duration;
  assert.equal(packedAnimation.actions[name].getClip().duration, duration);
  const times = new Set([0, duration]);
  for (let frame = 0; frame <= Math.ceil(duration * 240); frame++)
    times.add(Math.min(frame / 240, duration));
  for (const clip of Object.values(nativeAnimation.actions))
    for (const track of clip.getClip().tracks)
      if (track.name.endsWith('.scale'))
        for (const time of track.times)
          if (time <= duration) {
            times.add(time);
            times.add(Math.max(0, time - 1e-6));
            times.add(Math.min(duration, time + 1e-6));
          }
  for (const time of times) {
    for (const animation of [nativeAnimation, packedAnimation]) {
      animation._sample(name, time);
      animation.root.updateMatrixWorld(true);
    }
    sampledPoses++;
    assert.equal(packedAnimation.pouch.visible, nativeAnimation.pouch.visible);
    assert.equal(packedAnimation.spare.visible, nativeAnimation.spare.visible);
    for (const controlName of controlNames) {
      const nativeNode = nativeAnimation.root.getObjectByName(controlName);
      const packedNode = packedAnimation.root.getObjectByName(controlName);
      assert(nativeNode && packedNode, `${controlName}: named helpers survive cooking`);
      nativeNode.matrixWorld.decompose(positionA, rotationA, scaleA);
      packedNode.matrixWorld.decompose(positionB, rotationB, scaleB);
      maximumPosition = Math.max(maximumPosition, positionA.distanceTo(positionB));
      maximumRotation = Math.max(
        maximumRotation,
        rotationA.normalize().angleTo(rotationB.normalize())
      );
      maximumScale = Math.max(maximumScale, scaleA.distanceTo(scaleB));
    }
  }
}
// Measured 36.26 micrometres / 0.000147 rad / 0.000096 scale; narrow
// quantization bounds, not permission to move grips or retime visibility.
assert(maximumPosition < 0.00004, `contact/socket displacement ${maximumPosition} m`);
assert(maximumRotation < 0.00016, `normalized control rotation ${maximumRotation} rad`);
assert(maximumScale < 0.0001, `control scale deviation ${maximumScale}`);
nativeAnimation.dispose();
packedAnimation.dispose();
console.log(
  `EVOLYS cook parity: ${sampledPoses} poses, ${controlNames.length} controls; max position ${maximumPosition} m, rotation ${maximumRotation} rad, scale ${maximumScale}`
);
