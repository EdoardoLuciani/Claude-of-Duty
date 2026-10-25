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
import { audioFixture } from '../lib/audio-banks.mjs';
assert(!('ambientOneShot' in ambienceModule), 'replaced generators are removed');
assert.deepEqual(
  [...ambienceModule.ONE_SHOTS],
  ['dog', 'siren', 'creak', 'settle', 'birds', 'vehicle', 'heli']
);
const { actx, sources } = audioFixture();
const bank = new WeaponSampleBank(actx),
  rng = new Rng(474);
for (const [key, urls] of Object.entries(ENVIRONMENT_URLS))
  bank.hitBuffers[key] = urls.map((_, index) => ({ key, index, duration: 2 }));
for (const kind of ENVIRONMENT_KINDS) {
  const voice = bank.environment(kind, rng, { when: 3 });
  const source = sources.at(-1);
  assert.equal(source.buffer.key, environmentBank(kind));
  assert.equal(source.playbackRate.value, 1);
  assert.equal(source.when, 3);
  assert.equal(voice.end, 5.02);
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
