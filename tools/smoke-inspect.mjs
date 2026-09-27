import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildClips, makeSampleResult } from '../src/weapons/clips.js';
import { WEAPON_DEFS } from '../src/weapons/defs.js';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { buildSmg } from '../src/weapons/models/smg.js';
import { makeP320Model, P320Animation, P320_URL } from '../src/weapons/p320.js';
import { buildLmg } from '../src/weapons/models/lmg.js';
import { buildShotgun } from '../src/weapons/models/shotgun.js';
import { buildSniper } from '../src/weapons/models/sniper.js';

const builders = { rifle: buildRifle, smg: buildSmg, lmg: buildLmg, shotgun: buildShotgun, sniper: buildSniper };
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

assert.equal(middleRotations.size, 5, 'procedural inspect poses should be weapon-specific');
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

console.log('Inspect animation smoke checks passed');
