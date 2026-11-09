import assert from 'node:assert/strict';

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { authoredModel, checkAuthoredDuration } from '../../src/weapons/authored-model.ts';
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
const authored = {
  Idle: { duration: 0 },
  Fire: { duration: 0.06315789473684211 },
  Inspect: { duration: 40.1 },
};
const check = (c: THREE.AnimationClip): void => checkAuthoredDuration(c, authored, 'TEST_RIG');

// Idle is a single pose: the cook's one key at t=0 is exactly its authored 0 s.
check(collapsed('Idle'));

// Cooked key times are float32, so authored lengths round by ~1e-7.
const fire = clip('Fire', track([0, Math.fround(authored.Fire.duration)]));
check(fire);
assert.equal(fire.duration, Math.fround(authored.Fire.duration));
// Float32 rounding grows with length: 40.1 s stores as 40.0999985 s, 1.5e-6 off.
const long = clip('Inspect', track([0, Math.fround(authored.Inspect.duration)]));
check(long);
assert.equal(long.duration, Math.fround(authored.Inspect.duration));

for (const [bad, message] of [
  [clip('Fire', track([0, 0.07])), /Fire lasts 0\.07\d* s, authored 0\.0631/],
  [collapsed('Fire'), /Fire lasts 0 s/],
  [clip('Idle', track([0]), track([0, 2])), /Idle lasts 2 s, authored 0 s/],
  [clip('Idle'), /Idle has no tracks/],
  [clip('Inspect', track([0, 40.11])), /Inspect lasts 40\.11\d* s, authored 40\.1 s/],
  [clip('Reload', track([0, 1])), /no authored duration for Reload/],
] as const)
  assert.throws((): void => check(bad), message);

const nan = clip('Fire', track([0, 0.06]));
nan.duration = NaN;
assert.throws((): void => check(nan), /Fire lasts NaN s/, 'NaN never passes the tolerance check');
for (const duration of [-1, NaN])
  assert.throws(
    (): void => checkAuthoredDuration(collapsed('Idle'), { Idle: { duration } }, 'TEST_RIG'),
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
    ['Idle', 0],
    ['Fire', Math.fround(authored.Fire.duration)],
  ]
);
assert.throws(
  (): unknown => authoredModel(gltf, 'TEST_RIG', ['Idle', 'Fire', 'Inspect'], authored),
  /missing Inspect clip/
);
console.log('authored clip durations: Idle pose accepted, drift and lost motion rejected');
