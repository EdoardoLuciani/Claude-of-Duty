import assert from 'node:assert/strict';
import { buildClips, makeSampleResult } from './clips.js';
import { WEAPON_DEFS } from './defs.js';
import { buildRifle } from './models/rifle.js';
import { buildSmg } from './models/smg.js';
import { buildPistol } from './models/pistol.js';
import { buildLmg } from './models/lmg.js';

const builders = { rifle: buildRifle, smg: buildSmg, pistol: buildPistol, lmg: buildLmg };
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

  inspect.sample(inspect.duration, sample);
  assert.deepEqual(sample.pos, [0, 0, 0]);
  assert.deepEqual(sample.rot, [0, 0, 0]);
}

assert.equal(middleRotations.size, 4, 'inspect poses should be weapon-specific');
const pistol = buildClips(buildPistol().nodes, WEAPON_DEFS.pistol).inspect;
const pistolSample = makeSampleResult();
pistol.sample(pistol.duration * 0.5, pistolSample);
assert(pistolSample.lhand.pos[1] < -0.2, 'pistol support hand should clear the weapon');
assert.equal(pistolSample.parts.slide, 0, 'inspection must not alter weapon state');

console.log('Inspect animation smoke checks passed');
