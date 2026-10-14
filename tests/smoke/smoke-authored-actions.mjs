import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAuthoredActions, sampleAuthoredAction } from '../../src/weapons/authored-actions.ts';

const root = new THREE.Object3D();
const mixer = new THREE.AnimationMixer(root);
const clip = (name, start, end) =>
  new THREE.AnimationClip(name, 1, [
    new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [start, end]),
  ]);
const state = {
  mixer,
  actions: createAuthoredActions(mixer, [clip('Idle', 0, 1), clip('Fire', 10, 20)]),
  name: null,
};
for (const action of Object.values(state.actions)) {
  assert.equal(action.loop, THREE.LoopOnce);
  assert.equal(action.repetitions, 1);
  assert.equal(action.clampWhenFinished, true);
}
sampleAuthoredAction(state, 'Idle', 0.25);
assert.equal(state.name, 'Idle');
assert.equal(root.position.x, 0.25);
state.actions.Idle.paused = true;
sampleAuthoredAction(state, 'Idle', 0.5);
assert.equal(root.position.x, 0.5, 'same action can be sampled while paused');
assert.equal(state.actions.Idle.paused, false);
sampleAuthoredAction(state, 'Fire', 0.25);
assert.equal(root.position.x, 12.5, 'switch replaces rather than blends actions');
assert.equal(state.actions.Idle.isScheduled(), false);
sampleAuthoredAction(state, 'Fire', 5);
assert.equal(state.actions.Fire.time, 1, 'clamp to original clip duration');
assert.equal(root.position.x, 20);
sampleAuthoredAction(state, 'Fire', 0.1);
assert.equal(root.position.x, 11, 'sample backwards without resetting the same action');
sampleAuthoredAction(state, 'Idle', 0);
assert.equal(root.position.x, 0, 'interruption restores the idle channel');
assert.equal(state.actions.Fire.isScheduled(), false);
assert.equal(mixer.time, 0, 'sampling never advances mixer time');
mixer.stopAllAction();
mixer.uncacheRoot(root);
console.log('ok  smoke-authored-actions');
