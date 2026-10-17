// Committed native asset: budgets, dimensions, event parity and hand tracks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import manifest from '../../assets/weapons/ax338/manifest.json' with { type: 'json' };
import { makeAX338Model, AX338Animation, AX338_URL } from '../../src/weapons/ax338.ts';
import { buildClips } from '../../src/weapons/clips.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { Arm } from '../../src/weapons/hands.ts';
const bytes = readFileSync(new URL(AX338_URL));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const primitives = json.nodes
  .filter((n) => n.mesh !== undefined)
  .flatMap((n) => json.meshes[n.mesh].primitives);
const triangles = primitives.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
assert.equal(triangles, manifest.stats.triangles);
assert.equal(primitives.length, manifest.stats.primitives);
assert.equal(bytes.length, manifest.stats.bytes);
assert(
  triangles < 150000 &&
    primitives.length <= 48 &&
    json.materials.length <= 18 &&
    bytes.length <= 15 * 1024 * 1024
);
assert.equal(json.images.length, 3);
assert(
  json.buffers.every((b) => !b.uri) && json.images.every((i) => i.bufferView !== undefined),
  'self-contained runtime asset'
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
    p.baseColorTexture && p.metallicRoughnessTexture && mat.normalTexture,
    `${mat.name}: PBR detail`
  );
  assert([0, 1].includes(p.metallicFactor ?? 1), `${mat.name}: dielectric/metal separation`);
}
assert(
  !json.nodes.some((n) => /bipod|spent_case|AX338_arm/.test(n.name)),
  'no duplicate arms/cases or omitted accessories'
);
const loader = new GLTFLoader().register(() => ({
  name: 'SMOKE_TEXTURE',
  loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const gltf = await loader.parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  ''
);
// Freeze the approved rifle and hand channels. Only the three holding fingers
// and an empty-reload wrist hold (preventing early drift) may change.
gltf.scene.updateMatrixWorld(true);
const rifleHash = createHash('sha256'),
  protectedTracks = createHash('sha256');
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  rifleHash.update(o.name);
  rifleHash.update(o.material.name);
  rifleHash.update(JSON.stringify(o.matrixWorld.toArray()));
  for (const key of ['position', 'uv'])
    rifleHash.update(Buffer.from(o.geometry.attributes[key].array.buffer));
});
assert.equal(
  rifleHash.digest('hex'),
  'f5b16ba0fc55dc91e4c44c367c341454fa47b3b8117d9846ce6ccf715da16ba9',
  'approved rifle mesh positions/UVs/transforms unchanged'
);
for (const clip of gltf.animations) {
  protectedTracks.update(clip.name);
  protectedTracks.update(String(clip.duration));
  for (const track of clip.tracks) {
    if (
      /^R_finger_[123]_(root|[012])\./.test(track.name) ||
      (clip.name === 'Reload_Empty' && /^hand_R\.(position|quaternion)$/.test(track.name))
    )
      continue;
    protectedTracks.update(track.name);
    protectedTracks.update(String(track.getInterpolation()));
    protectedTracks.update(Buffer.from(track.times.buffer));
    protectedTracks.update(Buffer.from(track.values.buffer));
  }
}
assert.equal(
  protectedTracks.digest('hex'),
  '0e3a1287a648d96e6727a497ce8017ac901ef0855fe47e0d2a4ed9287e09c92b',
  'approved index/thumb, left hand and weapon clips unchanged'
);
// User-approved optic must not be incidentally rebuilt by furniture fixes.
const opticHash = createHash('sha256');
gltf.scene.getObjectByName('optic').traverse((o) => {
  if (!o.isMesh) return;
  opticHash.update(o.material.name);
  for (const key of ['position', 'normal', 'uv'])
    opticHash.update(Buffer.from(o.geometry.attributes[key].array.buffer));
  opticHash.update(Buffer.from(o.geometry.index.array.buffer));
});
assert.equal(
  opticHash.digest('hex'),
  'c7d56f9a55b53d63f38eb4e73fe3a892dea13022ef2c78ae97bd7dc4741213c3',
  'approved PM II geometry/normals/UVs/indices unchanged'
);
const model = makeAX338Model(gltf),
  anim = new AX338Animation(model),
  def = WEAPON_DEFS.sniper;
assert(
  [...model.materials].every((m) => m.isMeshPhysicalNodeMaterial),
  'authored weapons must use native PBR node materials'
);
assert.equal(model.nodes.opticGlass.kind, 'scope');
assert.equal(model.reactiveFire, true);
assert.equal(Object.keys(anim.actions).length, 9);
// Event timing is independent of geometry; neutral charge input keeps the
// shared gameplay timeline oracle without a retired procedural model.
const legacy = buildClips({ ...model.nodes, chargeRest: { pos: [0, 0, 0] } }, def);
for (const [name, clip] of Object.entries(anim.clips())) {
  assert.equal(clip.duration, legacy[name].duration, `${name}: original gameplay timing`);
  assert.deepEqual(clip.events, legacy[name].events, `${name}: exact existing event names/times`);
}
for (const action of Object.values(anim.actions)) {
  const clip = action.getClip();
  for (const track of clip.tracks) {
    assert(track.values.every(Number.isFinite));
    assert(Math.abs(track.times.at(-1) - clip.duration) < 1e-6, `${clip.name}: complete channel`);
    for (let i = 1; i < track.times.length; i++) assert(track.times[i] >= track.times[i - 1]);
  }
}
const rest = anim.bolt.position.clone(),
  restQ = anim.bolt.quaternion.clone();
anim.fire();
anim.update(0.04, null, 0, false);
assert(
  anim.bolt.position.distanceTo(rest) < 1e-6 && anim.bolt.quaternion.angleTo(restQ) < 1e-6,
  'manual bolt stays locked on discharge'
);
anim.update(0, 'cycle', 0.032, false);
assert(
  model.root.getObjectByName('trigger').quaternion.angleTo(new THREE.Quaternion()) > 0.1,
  'cycle includes the discharge trigger beat, not just bolt motion'
);
anim.update(0, 'cycle', 0.22 * def.boltTime, false);
assert(Math.abs(anim.bolt.position.z - rest.z - 0.1) < 0.00001, '100 mm authored rear stroke');
assert(
  Math.abs(anim.bolt.quaternion.angleTo(restQ) - Math.PI / 3) < 0.00001,
  '60-degree bolt lift'
);
const p = new THREE.Vector3(),
  q = new THREE.Quaternion();
const armL = new Arm(-1, { scale: 0.97 }),
  armR = new Arm(1);
anim.update(0, 'reloadEmpty', 0.62 * 3.6, false);
anim.handTarget('right', p, q);
assert(
  p.distanceTo(new THREE.Vector3(...model.nodes.gripR.pos).applyMatrix4(model.root.matrix)) <
    0.000001,
  'empty-reload wrist stays seated until holding-finger unwrap'
);
let maximumContactGap = 0;
for (const [name, first, last] of [
  ['cycle', 16, 99],
  ['reloadEmpty', Math.ceil(0.05 * 3.6 * 120), Math.floor(0.13 * 3.6 * 120)],
  ['reloadEmpty', Math.ceil(0.83 * 3.6 * 120), Math.floor(0.925 * 3.6 * 120)],
])
  for (let frame = first; frame <= last; frame++) {
    const t = frame / 120;
    anim.update(0, name, t, false);
    anim.handTarget('right', armR.hand.position, armR.hand.quaternion);
    anim.applyHands(armL, armR);
    armR.root.updateMatrixWorld(true);
    for (const [joint, pad, target] of [
      [armR.fingers[0].joints[2], [0, -0.006, -0.013], [0.069, 0.049, 0.057]],
      [armR.thumb.joints[1], [0, 0, -0.026], [0.055, 0.06, 0.056]],
    ]) {
      const contact = new THREE.Vector3(...pad).applyMatrix4(joint.matrixWorld);
      const expected = new THREE.Vector3(...target)
        .sub(rest)
        .applyQuaternion(anim.bolt.quaternion)
        .add(anim.bolt.position)
        .applyMatrix4(model.root.matrix);
      maximumContactGap = Math.max(maximumContactGap, contact.distanceTo(expected));
      assert(
        contact.distanceTo(expected) < 0.003,
        `${name}/${t}: fingertip loses bolt-knob contact`
      );
    }
  }
for (const name of Object.keys(anim.clips())) {
  const d = anim.clips()[name].duration;
  for (let i = 0; i <= 120; i++) {
    anim.update(0, name, (d * i) / 120, false);
    for (const side of ['left', 'right']) {
      anim.handTarget(side, p, q);
      assert(p.toArray().every(Number.isFinite) && q.toArray().every(Number.isFinite));
      assert(Math.abs(q.length() - 1) < 0.00001);
    }
  }
}
for (const name of ['reloadTac', 'reloadEmpty']) {
  anim.update(0, name, anim.clips()[name].duration * 0.48, true);
  assert(anim.spare.visible && !anim.magazine.visible);
  let meshes = 0;
  anim.spare.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      assert(
        Math.abs(Math.abs(o.matrixWorld.determinant()) - 1) < 1e-5,
        'spare descendants not collapsed'
      );
    }
  });
  assert(meshes > 0);
  anim.reset();
  assert(!anim.spare.visible && anim.magazine.visible);
  assert(
    anim.bolt.position.distanceTo(rest) < 1e-6 && anim.bolt.quaternion.angleTo(restQ) < 1e-6,
    'reset clears bolt action'
  );
}
anim.update(0, null, 0, true, false);
assert(
  !anim.magazineRound.visible && !anim.spareRound.visible,
  'empty ammunition is not resurrected'
);
anim.update(0, null, 0, false, true);
assert(anim.magazineRound.visible, 'refill restores visible rounds');
assert.equal(def.damage, 145);
assert.equal(def.magSize, 10);
assert.equal(def.boltTime, 1.1);
assert.equal(def.muzzleVelocity, 880);
assert.equal(def.adsFovScale, 0.25);
assert.equal(model.magSize.len, 0.1125);
assert(manifest.contactGeometry.magazine.some((b) => b.part === 'Magazine steel body'));
assert.equal(model.shell.caseLen, 0.0697);
assert.equal(model.shell.rimR, 0.0074);
assert(Math.abs(model.nodes.muzzle[2] - manifest.dimensions.muzzle) < 1e-6);
anim.dispose();
assert.equal(model.materials.size, 0);
assert.equal(model.textures.size, 0);
console.log(
  `AX338: ${triangles} triangles / ${primitives.length} primitives; native manual bolt, nine clips, PBR, event parity, ${maximumContactGap.toFixed(6)} m maximum bolt contact gap, spare/round visibility and reset passed`
);
