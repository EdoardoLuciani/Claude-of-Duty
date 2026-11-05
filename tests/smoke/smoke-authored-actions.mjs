import assert from 'node:assert/strict';

import * as THREE from 'three';

import {
  createAuthoredActions,
  disposeAuthoredMixer,
  sampleAuthoredAction,
  sampleAuthoredFire,
} from '../../src/weapons/authored-actions.ts';
import {
  applyAuthoredHands,
  authoredHandTarget,
  discoverAuthoredHands,
} from '../../src/weapons/authored-hands.ts';
import { createAuthoredRig } from '../../src/weapons/authored-rig.ts';

// Gesture precedence, interrupted firing, last-shot choice and clock boundaries.
const samples = [];
const state = { idleTime: 0, fireTime: 0, _sample: (...args) => samples.push(args) };
const clips = { Fire: { duration: 0.1 }, Idle: { duration: 2 } };
const sample = (dt, name, time, empty = false) =>
  sampleAuthoredFire(state, clips, dt, name, time, empty);
assert.equal(sample(0.025, 'reloadEmpty', 0.6, true), 'Reload_Empty');
assert.deepEqual(samples.pop(), ['Reload_Empty', 0.6]);
assert.equal(sample(0.025, null, 0, true), undefined);
assert.deepEqual(samples.pop(), ['Last_Shot', 0.05]);
sample(0.05, null, 0);
assert.deepEqual(samples.pop(), ['Idle', 0.1], 'fire duration is an exclusive boundary');
state.fireTime = 0;
sample(0.02, null, 0);
assert.deepEqual(samples.pop(), ['Fire', 0.02]);
state.fireTime = Infinity;
state.idleTime = 2.25;
sample(0, 'unknown', 0);
assert.deepEqual(samples.pop(), ['Idle', 0.25]);
assert.equal(sample(0, 'draw', 0.3), 'Draw');
assert.equal(sample(0, 'holster', 0.4), 'Holster');

// Sampling clamps native time, switches actions and never advances mixer time.
const root = new THREE.Object3D();
const mixer = new THREE.AnimationMixer(root);
const animations = ['Idle', 'Fire'].map(
  (name) =>
    new THREE.AnimationClip(name, 1, [
      new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 2]),
    ])
);
const native = { root, mixer, actions: createAuthoredActions(mixer, animations), name: null };
for (const action of Object.values(native.actions)) {
  assert.equal(action.loop, THREE.LoopOnce);
  assert.equal(action.clampWhenFinished, true);
}
sampleAuthoredAction(native, 'Fire', 2);
assert.equal(root.position.x, 2);
assert.equal(native.actions.Fire.time, 1);
assert.equal(mixer.time, 0);
sampleAuthoredAction(native, 'Idle', 0.25);
assert.equal(root.position.x, 0.5);
assert.equal(native.actions.Fire.isRunning(), false);
disposeAuthoredMixer(native);
assert.equal(mixer.stats.actions.inUse, 0);
assert.equal(mixer.stats.actions.total, 0);

// Shared receiver methods retain side-specific authored wrists and every joint.
const nodes = new Map();
const hands = discoverAuthoredHands((name) => {
  const node = new THREE.Object3D();
  node.rotation.set(0.1, nodes.size * 0.01, 0.2);
  nodes.set(name, node);
  return node;
});
root.rotation.set(0.2, 0.3, 0.4);
root.updateMatrix();
const rig = { root, hands, handTarget: authoredHandTarget, applyHands: applyAuthoredHands };
for (const side of ['left', 'right']) {
  hands[side].wrist.position.set(side === 'left' ? -1 : 1, 2, 3);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  rig.handTarget(side, position, quaternion);
  assert(position.equals(hands[side].wrist.position.clone().applyMatrix4(root.matrix)));
  assert(quaternion.equals(root.quaternion.clone().multiply(hands[side].wrist.quaternion)));
}
const arm = () => ({
  ...discoverAuthoredHands(() => new THREE.Object3D()).left,
  thumb: { root: new THREE.Object3D(), joints: [new THREE.Object3D(), new THREE.Object3D()] },
  updates: 0,
  updateFlex() {
    this.updates++;
  },
});
const left = arm(),
  right = arm();
rig.applyHands(left, right);
for (const [target, source] of [
  [left, hands.left],
  [right, hands.right],
]) {
  assert.equal(target.updates, 1);
  for (let i = 0; i < 4; i++) {
    assert(target.fingers[i].root.quaternion.equals(source.fingers[i].root.quaternion));
    for (let j = 0; j < 3; j++)
      assert(target.fingers[i].joints[j].quaternion.equals(source.fingers[i].joints[j].quaternion));
  }
  assert(target.thumb.root.quaternion.equals(source.thumb[0].quaternion));
  for (let j = 0; j < 2; j++)
    assert(target.thumb.joints[j].quaternion.equals(source.thumb[j + 1].quaternion));
}
// A composed rig owns one mixer, independent hand state and only its supplied finishes.
for (const [name, node] of nodes) {
  node.name = name;
  root.add(node);
}
const material = new THREE.MeshPhysicalMaterial();
const texture = new THREE.Texture();
let disposed = 0;
material.addEventListener('dispose', () => disposed++);
texture.addEventListener('dispose', () => disposed++);
const model = { root, animations, materials: new Set([material]), textures: new Set([texture]) };
const first = createAuthoredRig(model);
const second = createAuthoredRig({
  ...model,
  root: root.clone(),
  materials: new Set(),
  textures: new Set(),
});
assert.notEqual(first.mixer, second.mixer);
assert.notEqual(first.poseQ, second.poseQ);
first.reset();
first.fire();
assert.equal(first.fireTime, 0);
assert.equal(second.fireTime, Infinity);
first.reset();
assert.equal(first.fireTime, Infinity);
assert.equal(first.name, 'Idle');
first.dispose();
second.dispose();
assert.equal(disposed, 2);
assert.equal(model.materials.size, 0);
assert.equal(model.textures.size, 0);
console.log('ok  smoke-authored-actions');
