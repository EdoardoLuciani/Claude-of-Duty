import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildClips, makeSampleResult } from '../../src/weapons/clips.js';
import { WEAPON_DEFS } from '../../src/weapons/defs.js';
import { makeM4Model, M4Animation, M4_URL } from '../../src/weapons/m4.js';
import { buildSmg } from '../../src/weapons/models/smg.js';
import { makeP320Model, P320Animation, P320_URL } from '../../src/weapons/p320.js';
import { buildLmg } from '../../src/weapons/models/lmg.js';
import { buildShotgun } from '../../src/weapons/models/shotgun.js';
import { buildSniper } from '../../src/weapons/models/sniper.js';

const builders = { smg: buildSmg, lmg: buildLmg, shotgun: buildShotgun, sniper: buildSniper };
const middleRotations = new Set();

for (const [id, build] of Object.entries(builders)) {
  const clips = buildClips(build().nodes, WEAPON_DEFS[id]);

  for (const clip of Object.values(clips)) {
    for (const channel of ['weapon', 'lhand', 'parts']) {
      const keys = clip[channel];
      if (!keys?.length) continue;
      for (let i = 1; i < keys.length; i++) {
        assert(keys[i].t >= keys[i - 1].t, `${id}/${clip.name}/${channel} is not ordered`);
      }
      if (keys.length > 1) {
        assert.equal(keys.at(-1).t, clip.duration, `${id}/${clip.name}/${channel} ends early`);
      }
    }
    assert(clip.events.every((event) => event.t >= 0 && event.t <= clip.duration));
  }

  const inspect = clips.inspect;
  assert.equal(inspect.duration, WEAPON_DEFS[id].inspectTime);
  const sample = makeSampleResult();
  inspect.sample(inspect.duration * 0.5, sample);
  assert([...sample.pos, ...sample.rot].every(Number.isFinite));
  middleRotations.add(sample.rot.map((n) => n.toFixed(3)).join(','));

  inspect.sample(inspect.duration * 0.6, sample);
  assert(sample.rot[1] > 1.5, `${id} inspect should reveal the opposite side`);

  inspect.sample(inspect.duration, sample);
  assert.deepEqual(sample.pos, [0, 0, 0]);
  assert.deepEqual(sample.rot, [0, 0, 0]);
}

assert.equal(middleRotations.size, 4, 'each remaining procedural weapon has a distinct inspect pose');
const bytes = readFileSync(new URL(P320_URL));
const loader = new GLTFLoader().register(() => ({ name: 'NODE_TEXTURE_STUB', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const model = makeP320Model(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''));
const pistol = new P320Animation(model);
const duration = pistol.clips().inspect.duration;
assert.equal(duration, WEAPON_DEFS.pistol.inspectTime);
pistol.update(0, 'inspect', 0, false);
const start = pistol.root.quaternion.clone(), slide = pistol.slide.position.clone();
let leftRoll = 0, rightRoll = 0, handClearance = 0;
for (let i = 0; i <= 120; i++) {
  pistol.update(0, 'inspect', duration * i / 120, false);
  assert(pistol.root.position.toArray().every(Number.isFinite));
  assert(pistol.root.quaternion.toArray().every(Number.isFinite));
  leftRoll = Math.max(leftRoll, pistol.root.rotation.z);
  rightRoll = Math.min(rightRoll, pistol.root.rotation.z);
  handClearance = Math.min(handClearance, pistol.hands.left.wrist.position.y);
  assert(pistol.slide.position.distanceTo(slide) < 1e-6, 'inspection must not cycle the slide');
}
assert(leftRoll > .45 && rightRoll < -.55, 'authored pistol rolls to present both sides');
assert(handClearance < -.17, 'authored support hand clears the weapon');
assert(start.angleTo(pistol.root.quaternion) < 1e-4, 'inspect returns to the starting pose');
pistol.dispose();

// M4 inspection is authored in the GLB, not a procedural rifle pose.
const rifleBytes = readFileSync(new URL(M4_URL));
const rifle = new M4Animation(makeM4Model(await loader.parseAsync(rifleBytes.buffer.slice(rifleBytes.byteOffset, rifleBytes.byteOffset + rifleBytes.byteLength), '')));
const clips = rifle.clips();
for (const action of Object.values(rifle.actions)) {
  const clip = action.getClip();
  for (const track of clip.tracks) {
    assert(track.times[0] >= 0 && Math.abs(track.times.at(-1) - clip.duration) < 1e-6, `${clip.name}/${track.name}: complete authored channel`);
    for (let i = 1; i < track.times.length; i++) assert(track.times[i] >= track.times[i - 1], `${clip.name}/${track.name}: ordered keys`);
  }
}
for (const clip of Object.values(clips)) {
  assert(clip.events.every(event => event.t >= 0 && event.t <= clip.duration));
  for (let i = 1; i < clip.events.length; i++) assert(clip.events[i].t >= clip.events[i - 1].t, 'M4 events remain ordered');
}
assert.equal(clips.inspect.duration, WEAPON_DEFS.rifle.inspectTime);
rifle.update(0, 'inspect', 0, false);
const rifleStart = rifle.root.quaternion.clone(), bolt = rifle.bolt.position.clone();
let leftYaw = 0, rightYaw = 0, rifleHandClearance = 0;
for (let i = 0; i <= 120; i++) {
  rifle.update(0, 'inspect', clips.inspect.duration * i / 120, false);
  assert(rifle.root.position.toArray().every(Number.isFinite));
  assert(rifle.root.quaternion.toArray().every(Number.isFinite));
  leftYaw = Math.min(leftYaw, rifle.root.rotation.y);
  rightYaw = Math.max(rightYaw, rifle.root.rotation.y);
  rifleHandClearance = Math.min(rifleHandClearance, rifle.hands.left.wrist.position.y);
  assert(rifle.bolt.position.distanceTo(bolt) < 1e-6, 'inspection must not cycle the M4 bolt');
}
assert(leftYaw < -.65 && rightYaw > .65, 'authored M4 presents both receiver sides');
assert(rifleHandClearance < -.17, 'authored M4 support hand clears the receiver');
assert(rifleStart.angleTo(rifle.root.quaternion) < 1e-4, 'M4 inspect returns to the starting pose');
rifle.dispose();

console.log('Inspect animation smoke checks passed');
