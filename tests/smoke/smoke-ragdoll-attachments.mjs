/** Actual soldier skeleton: branch separation must stay bounded throughout a fall. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RIG } from '../../src/ai/rig.ts';
import { Animator } from '../../src/ai/animator.ts';
import { Ragdoll, specFromSkeleton, humanoidSpec } from '../../src/physics/ragdoll.js';
import { StaticWorld } from '../../src/physics/bvh.js';
import { SURFACE } from '../../src/physics/surfaces.js';

const world = new StaticWorld();
const floor = new THREE.Mesh(new THREE.BoxGeometry(200, 0.2, 200));
floor.position.y = -0.1;
floor.updateMatrixWorld(true);
world.addMesh(floor, SURFACE.CONCRETE);
world.build();

for (const [clip, impulse] of [['idle', 0], ['idle', 5.5], ['idle', 30], ['run', 5.5], ['crouchIdle', 5.5]]) {
  const { skeleton, root, bones } = RIG.createSkeleton();
  const group = new THREE.Group();
  group.add(root);
  if (clip !== 'idle') {
    const animator = new Animator(RIG, bones);
    animator.footIk = false;
    animator.state.clip = clip;
    animator.state.speed = clip === 'run' ? 3 : 0;
    animator.state.crouch = clip === 'crouchIdle';
    animator.phase = 0.3;
    animator.update(1 / 60, 1);
  }
  group.position.set(2, 0.15, -3);
  group.rotation.y = 0.7;
  group.scale.setScalar(1.05);
  group.updateMatrixWorld(true);
  const { spec, boneMap } = specFromSkeleton(skeleton, {
    mass: 82, radiusRatio: 0.42, cone: 74, twist: 38,
  });
  const rd = new Ragdoll(world, { bones: spec, iterations: 8 });
  rd.adoptSkeleton(skeleton, boneMap);
  const rest = boneMap.map(b => b.position.length());
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), target = new THREE.Vector3();
  const attachments = [];
  for (let i = 0; i < spec.length; i++) {
    const p = spec[i].parent, a = rd.boneHead[i];
    if (p < 0 || a === rd.boneHead[p] || a === rd.boneTail[p]) continue;
    rd.getBoneTransform(p, pos, quat);
    const offset = new THREE.Vector3(rd.px[a], rd.py[a], rd.pz[a]).sub(pos).applyQuaternion(quat.invert());
    attachments.push({ i, offset });
  }
  assert.deepEqual(attachments.map(({ i }) => spec[i].name), ['ClavicleR', 'ClavicleL', 'UpLegR', 'UpLegL']);
  rd.applyImpulse(2, 1.5, -3, impulse, 0, 0, 0.85);
  let maxAttachment = 0, maxLength = 0, maxSkin = 0, lowest = Infinity;
  for (let step = 0; step < 900; step++) {
    rd.step(1 / 120);
    rd.writeToSkeleton();
    for (let i = 0; i < rd.boneCount; i++) {
      const a = rd.boneHead[i], c = rd.boneTail[i];
      const len = Math.hypot(rd.px[c] - rd.px[a], rd.py[c] - rd.py[a], rd.pz[c] - rd.pz[a]);
      assert.ok(Number.isFinite(len), 'all capsule positions remain finite');
      lowest = Math.min(lowest, rd.py[a], rd.py[c]);
      maxLength = Math.max(maxLength, Math.abs(len - rd.boneLen[i]));
      if (i > 0) maxSkin = Math.max(maxSkin, Math.abs(boneMap[i].position.length() - rest[i]));
    }
    for (const { i, offset } of attachments) {
      rd.getBoneTransform(rd.boneParent[i], pos, quat);
      target.copy(offset).applyQuaternion(quat).add(pos);
      const a = rd.boneHead[i];
      maxAttachment = Math.max(maxAttachment, Math.hypot(rd.px[a] - target.x, rd.py[a] - target.y, rd.pz[a] - target.z));
    }
  }
  console.log({ clip, impulse, maxAttachment, maxLength, maxSkin, lowest, sleeping: rd.sleeping });
  assert.ok(maxAttachment < 0.08, 'physical branch heads stay within 8 cm of their parent-frame anchors');
  assert.ok(maxLength < 0.08, 'capsules stay bounded during transient contacts');
  assert.ok(maxSkin < 1e-5, 'rendered skeleton never separates at joints');
  assert.ok(lowest > -0.12, 'attachment solving does not tunnel the corpse through the floor');
  const motion = rd.px.reduce((sum, x, i) => sum + Math.hypot(x - rd.qx[i], rd.py[i] - rd.qy[i], rd.pz[i] - rd.qz[i]), 0) / rd.particleCount;
  if (clip === 'idle' && impulse < 30) assert.ok(rd.sleeping || motion < 0.002, 'ordinary deaths settle');
  if (rd.sleeping) {
    const settled = boneMap.map(b => b.position.toArray());
    rd.step(1 / 120);
    rd.writeToSkeleton();
    assert.deepEqual(boneMap.map(b => b.position.toArray()), settled, 'sleep preserves the final skeleton pose');
    rd.applyImpulse(2, 0.1, -3, 5.5, 0, 0, 0.85);
    assert.equal(rd.sleeping, false, 'shooting a settled corpse wakes it');
    rd.step(1 / 120);
    rd.writeToSkeleton();
    for (let i = 1; i < spec.length; i++) assert.ok(Math.abs(boneMap[i].position.length() - rest[i]) < 1e-5);
  }
  // Cleanup scales the actor group even if the corpse has not fallen asleep.
  rd.wake();
  group.scale.setScalar(0.525);
  rd.writeToSkeleton();
  for (let i = 1; i < spec.length; i++) {
    boneMap[i].getWorldPosition(pos);
    boneMap[i].parent.getWorldPosition(target);
    assert.ok(Math.abs(pos.distanceTo(target) - rest[i] * 0.525) < 1e-5, 'active corpses shrink without stretching');
  }
  rd.dispose();
  skeleton.dispose();
}

// Default physics-demo humanoids need the same offset-branch connections.
const demo = new Ragdoll(world, { bones: humanoidSpec(), transform: new THREE.Matrix4().makeTranslation(0, 1.2, 0) });
assert.equal(demo.attachmentBones.length, 4);
const offsets = Array.from(demo.attachmentBones, i => {
  const a = demo.boneHead[i], p = demo.boneHead[demo.boneParent[i]];
  return Math.hypot(demo.px[a] - demo.px[p], demo.py[a] - demo.py[p], demo.pz[a] - demo.pz[p]);
});
for (let step = 0; step < 900; step++) {
  demo.step(1 / 120);
  for (let k = 0; k < demo.attachmentBones.length; k++) {
    const i = demo.attachmentBones[k], a = demo.boneHead[i], p = demo.boneHead[demo.boneParent[i]];
    const offset = Math.hypot(demo.px[a] - demo.px[p], demo.py[a] - demo.py[p], demo.pz[a] - demo.pz[p]);
    assert.ok(Math.abs(offset - offsets[k]) < 0.15, 'default humanoid branches stay attached');
  }
}
console.log('smoke-ragdoll-attachments: ok');
