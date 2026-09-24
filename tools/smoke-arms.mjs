import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Arm, HAND_POSES } from '../src/weapons/hands.js';
import { HAND_POSE_EASE } from '../src/weapons/hand-poses.js';

const manifest = JSON.parse(readFileSync(new URL('../assets/player/arms/manifest.json', import.meta.url)));
for (const [path, hash] of Object.entries(manifest.sha256)) {
  const actual = createHash('sha256').update(readFileSync(new URL('../'+path, import.meta.url))).digest('hex');
  assert.equal(actual, hash, `stale Blender arms: ${path}; rebuild with tools/blender/player_arms.py`);
}

// Load the actual committed skin/animations in Node. Strip only GPU texture
// references: no DOM/image decoder is required for deformation verification.
const bytes = readFileSync(new URL('../public/models/player/arms.glb', import.meta.url));
assert.equal(bytes.readUInt32LE(0), 0x46546c67);
const size = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + size).toString());
assert.equal(json.animations.length, Object.keys(HAND_POSES).length, 'every hand pose has a Blender action');
assert(json.materials.every(m => m.pbrMetallicRoughness.baseColorTexture && m.normalTexture && m.occlusionTexture), 'all surfaces have baked PBR + AO');
assert(json.materials.every(m => m.normalTexture.texCoord === 1), 'microdetail uses physical-density UVs');
const cloth = json.materials.find(m => m.name === 'Olive_ripstop');
const glove = json.materials.find(m => m.name === 'Charcoal_woven_glove');
assert.notEqual(json.textures[cloth.normalTexture.index].source,
  json.textures[glove.normalTexture.index].source, 'ripstop has its own reinforcement-grid normal map');
const bufferStart = 20 + size;
const binary = bytes.subarray(bufferStart + 8, bufferStart + 8 + bytes.readUInt32LE(bufferStart));
json.images = [];
json.textures = [];
json.materials = json.materials.map(m => ({name:m.name, pbrMetallicRoughness:{baseColorFactor:[.1,.1,.1,1]}}));
json.extensionsUsed = [];
json.extensionsRequired = [];
const body = Buffer.from(JSON.stringify(json));
const padded = Buffer.alloc(Math.ceil(body.length / 4) * 4, 0x20);
body.copy(padded);
const rebuilt = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length);
rebuilt.writeUInt32LE(0x46546c67, 0);
rebuilt.writeUInt32LE(2, 4);
rebuilt.writeUInt32LE(rebuilt.length, 8);
rebuilt.writeUInt32LE(padded.length, 12);
rebuilt.writeUInt32LE(0x4e4f534a, 16);
padded.copy(rebuilt, 20);
rebuilt.writeUInt32LE(binary.length, 20 + padded.length);
rebuilt.writeUInt32LE(0x004e4942, 24 + padded.length);
binary.copy(rebuilt, 28 + padded.length);
const gltf = await new GLTFLoader().parseAsync(rebuilt.buffer.slice(rebuilt.byteOffset, rebuilt.byteOffset + rebuilt.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const meshes = [];
gltf.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
assert.equal(meshes.length, 5, 'five material submissions per arm');
let vertices = 0;
for (const m of meshes) {
  const weights = m.geometry.getAttribute('skinWeight');
  vertices += weights.count;
  for (let i = 0; i < weights.count; i++) {
    const sum = weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i);
    assert(Math.abs(sum - 1) < 1e-5, `normalized skin weights ${m.name}:${i}`);
  }
}
const webMesh = meshes.find(m => m.name.startsWith('Charcoal_'));
const webIndex = webMesh.skeleton.bones.findIndex(b => b.name === 'thumb_web');
assert(webIndex >= 0, 'export includes the thumb saddle volume control');
let webVertices = 0;
for (let i = 0; i < webMesh.geometry.attributes.skinIndex.count; i++) {
  for (let j = 0; j < 4; j++) {
    if (webMesh.geometry.attributes.skinIndex.getComponent(i,j) === webIndex &&
        webMesh.geometry.attributes.skinWeight.getComponent(i,j) > .1) webVertices++;
  }
}
assert(webVertices > 40, 'the actual glove web is weighted to the saddle control');
assert(vertices < 50000, 'viewmodel vertex budget');
assert.equal(HAND_POSE_EASE[0], 0);
assert.equal(HAND_POSE_EASE.at(-1), 1);
assert(HAND_POSE_EASE.every((v,i) => Number.isFinite(v) && v >= 0 && v <= 1 && (i === 0 || v >= HAND_POSE_EASE[i-1])));

const p = new THREE.Vector3();
const target = new THREE.Vector3(.08,-.05,-.26);
const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,.4,-.3));
for (const side of [-1,1]) {
  const arm = new Arm(side, {scale: side < 0 ? .97 : 1});
  arm.attachAsset({meshes});
  assert.equal(arm.flexJoints.length, 9, 'volume-preserving finger/ thumb controls');
  assert(arm.skins.every(mesh => mesh.skeleton === arm.skeleton), 'one shared skeleton per arm');
  for (const name of Object.keys(HAND_POSES)) {
    arm.setPose(name, .1);
    for (let frame = 0; frame < 12; frame++) {
      arm.updatePose(1/60);
      arm.solve(target, orientation);
      arm.root.updateMatrixWorld(true);
      for (const joint of arm.flexJoints) assert(Math.abs(joint.bone.rotation.x - joint.source.rotation.x*.5) < 1e-7);
      const webRotation = arm.thumbRest.clone().slerp(arm.thumb.root.quaternion, .5);
      assert(webRotation.angleTo(arm.thumbWeb.quaternion) < 1e-6, `${name}: half-angle web rotation`);
      assert(arm.hand.position.distanceTo(target) < 1e-9, 'IK hand target preserved');
      for (const m of arm.skins) {
        m.skeleton.update();
        assert(m.skeleton.boneMatrices.every(Number.isFinite), `${name}: finite bones`);
        for (let i = 0; i < m.geometry.attributes.position.count; i += 17) {
          m.getVertexPosition(i,p);
          assert(Number.isFinite(p.length()) && p.length() < 1.2, `${name}: bounded deformation ${m.name}`);
        }
      }
    }
  }
  for (const name of ['open','pinch','radio','grenade']) {
    arm.setPose(name);
    const before = arm.fingers[0].joints.map(j => j.rotation.x);
    arm.setTrigger(1);
    assert.deepEqual(arm.fingers[0].joints.map(j => j.rotation.x), before, `${name}: trigger must not overwrite utility pose`);
  }
  arm.setPose('grip');
  arm.setTrigger(1);
  assert(arm.fingers[0].joints[0].rotation.x < -HAND_POSES.grip.fingers[0][0]);
  // Interrupted blends start from the currently displayed pose, not from the
  // previous pose endpoint (the source of snapping during reload cancellation).
  arm.setPose('open', .1);
  arm.updatePose(.035);
  const before = arm.fingers[2].joints[1].rotation.x;
  arm.setPose('pinch', .1);
  assert(Math.abs(arm.fingers[2].joints[1].rotation.x - before) < 1e-7);
  // A fixed pivot is not an IK preference: wrist motion must never move the
  // elbow or twist the upper arm. Exercise a full turn for both arm scales.
  const elbow = new THREE.Vector3(.1, -.15, -.3);
  arm.shoulder.copy(elbow).add(new THREE.Vector3(arm.l1, 0, 0));
  const wrist = new THREE.Vector3(), rotation = new THREE.Quaternion();
  let upper = null;
  for (let i = 0; i <= 120; i++) {
    const angle = i * Math.PI * 2 / 120;
    wrist.set(0, arm.l2 * Math.cos(angle), arm.l2 * Math.sin(angle)).add(elbow);
    rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
    arm.solve(wrist, rotation, elbow);
    upper ??= arm.upperPivot.quaternion.clone();
    assert(arm.forePivot.position.equals(elbow), 'fixed elbow must not follow the wrist');
    assert(arm.upperPivot.quaternion.equals(upper), 'upper arm must not rotate with the wrist');
    assert(Math.abs(arm.forePivot.scale.z - 1) < 1e-10, 'fixed-pivot poses must preserve forearm length');
    arm.root.updateMatrixWorld(true);
    arm.skeleton.update();
    assert(arm.skeleton.boneMatrices.every(Number.isFinite), 'finite bones throughout the fixed-elbow orbit');
  }
  arm.solve(target, orientation);
  assert(arm.forePivot.position.distanceTo(elbow) > .001, 'ordinary IK resumes when no fixed elbow is supplied');
  arm.dispose();
  assert.equal(arm.skins.length, 0);
}
console.log(`arms: ${vertices} exported vertices, ${meshes.length} materials, ${gltf.animations.length} Blender poses; both hands deform and preserve utility poses`);
