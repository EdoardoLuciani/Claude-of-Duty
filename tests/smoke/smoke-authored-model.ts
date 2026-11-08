import assert from 'node:assert/strict';

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { applyAuthoredDuration, authoredModel } from '../../src/weapons/authored-model.ts';
import { fixture } from '../lib/fixture.ts';

// Real three clips; duration is inferred from the keys, as GLTFLoader does.
const track = (times: number[]): THREE.VectorKeyframeTrack =>
  new THREE.VectorKeyframeTrack(
    'bone.position',
    times,
    times.flatMap((t): number[] => [t, 0, 0])
  );
const clip = (name: string, ...tracks: THREE.KeyframeTrack[]): THREE.AnimationClip =>
  new THREE.AnimationClip(name, undefined, tracks);
// gltfpack 1.3 with -af 0: every constant track is one key at t=0.
const collapsed = (name: string): THREE.AnimationClip => clip(name, track([0]), track([0]));
const authored = { Idle: { duration: 2 }, Fire: { duration: 0.06315789473684211 } };
const apply = (c: THREE.AnimationClip): void => applyAuthoredDuration(c, authored, 'TEST_RIG');

const idle = collapsed('Idle');
assert.equal(idle.duration, 0, 'fixture reproduces the collapsed cook');
apply(idle);
assert.equal(idle.duration, 2, 'a collapsed Idle regains its authored hold');

const moving = clip('Idle', track([0]), track([0, 2]));
apply(moving);
assert.equal(moving.duration, 2, 'an Idle with motion keeps its own timing');

// Cooked key times are float32, so authored lengths round by ~1e-7.
const fire = clip('Fire', track([0, Math.fround(authored.Fire.duration)]));
apply(fire);
assert.equal(fire.duration, Math.fround(authored.Fire.duration));

for (const [bad, message] of [
  [clip('Fire', track([0, 0.07])), /Fire lasts 0\.07\d* s, authored 0\.0631/],
  [collapsed('Fire'), /Fire lasts 0 s/],
  [clip('Idle', track([0, 1])), /Idle lasts 1 s, authored 2 s/],
  [clip('Idle'), /Idle lasts 0 s/],
  [clip('Inspect', track([0, 1])), /no authored duration for Inspect/],
] as const)
  assert.throws((): void => apply(bad), message);

const nan = clip('Fire', track([0, 0.06]));
nan.duration = NaN;
assert.throws((): void => apply(nan), /Fire lasts NaN s/, 'NaN never passes the tolerance check');
for (const duration of [0, -1])
  assert.throws(
    (): void => applyAuthoredDuration(collapsed('Idle'), { Idle: { duration } }, 'TEST_RIG'),
    /no authored duration for Idle/
  );

// authoredModel normalizes every required clip before an adapter sees it.
const scene = new THREE.Group();
const rig = new THREE.Object3D();
rig.name = 'TEST_RIG';
scene.add(rig);
const gltf = fixture<GLTF>({
  scene,
  animations: [collapsed('Idle'), clip('Fire', track([0, Math.fround(authored.Fire.duration)]))],
});
const { animations } = authoredModel(gltf, 'TEST_RIG', ['Idle', 'Fire'], authored);
assert.deepEqual(
  animations.map((c): [string, number] => [c.name, c.duration]),
  [
    ['Idle', 2],
    ['Fire', Math.fround(authored.Fire.duration)],
  ]
);
assert.throws(
  (): unknown => authoredModel(gltf, 'TEST_RIG', ['Idle', 'Fire', 'Inspect'], authored),
  /missing Inspect clip/
);
console.log('authored clip durations: collapsed Idle restored, drift and lost motion rejected');
