import assert from 'node:assert/strict';

import * as ambienceModule from '../../src/audio/ambience.ts';
import {
  ENVIRONMENT_URLS,
  ENVIRONMENT_KINDS,
  environmentBank,
} from '../../src/audio/environment.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { Rng } from '../../src/core/rng.ts';
assert(!('ambientOneShot' in ambienceModule), 'replaced generators are removed');
assert.deepEqual(
  [...ambienceModule.ONE_SHOTS],
  ['dog', 'siren', 'creak', 'settle', 'birds', 'vehicle', 'heli']
);
const sources = [],
  actx = {
    currentTime: 0,
    createGain: () => ({ gain: { value: 0 }, connect() {} }),
    createBufferSource() {
      const s = {
        playbackRate: { value: 1 },
        connect() {},
        start(when) {
          this.when = when;
        },
      };
      sources.push(s);
      return s;
    },
  };
const bank = new WeaponSampleBank(actx),
  rng = new Rng(474);
for (const [key, urls] of Object.entries(ENVIRONMENT_URLS))
  bank.hitBuffers[key] = urls.map((_, index) => ({ key, index, duration: 2 }));
for (const kind of ENVIRONMENT_KINDS) {
  let last = -1;
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const voice = bank.environment(kind, rng, { when: 3 });
    const s = sources.at(-1);
    assert.equal(s.buffer.key, environmentBank(kind));
    assert.notEqual(s.buffer.index, last);
    assert.equal(s.playbackRate.value, 1);
    assert.equal(s.when, 3);
    assert.equal(voice.end, 5.02);
    last = s.buffer.index;
    seen.add(last);
  }
  assert.equal(seen.size, 2);
}
const audio = new AudioSystem();
Object.assign(audio, {
  running: true,
  actx,
  samples: bank,
  rng,
  field: { listenerPos: { x: 0, y: 1.6, z: 0 } },
});
const calls = [];
audio._playAt = (...a) => {
  calls.push(a);
  return true;
};
audio.bark = () => {
  throw Error('phantom tactical voice');
};
for (const which of ENVIRONMENT_KINDS) {
  rng.pick = () => which;
  audio._ambientOneShot();
  assert.equal(calls.at(-1)[4].which, which);
  assert.equal(calls.at(-1)[5], 'ambience');
}
assert.equal(typeof audio._distantChatter, 'undefined');
const empty = new WeaponSampleBank(actx);
assert.throws(() => empty.environment('dog', rng), /recordings are not loaded/);
assert.throws(() => bank.environment('shout', rng), /recordings are not loaded/);
console.log(
  'Recorded environment assets, variants, no synthesis fallback, sparse scheduler ownership and no phantom tactical voices'
);
