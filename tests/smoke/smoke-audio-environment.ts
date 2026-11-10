import assert from 'node:assert/strict';

import * as ambienceModule from '../../src/audio/ambience.ts';
import {
  ENVIRONMENT_URLS,
  ENVIRONMENT_KINDS,
  environmentBank,
} from '../../src/audio/environment.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import type { SpatialField } from '../../src/audio/spatial.ts';
import type { AudioVoice } from '../../src/audio/types.ts';
import { Rng } from '../../src/core/rng.ts';
import { audioFixture } from '../lib/audio-banks.ts';
import { fixtureEntries, at, fixtureBuffer, FixtureAudioBuffer } from '../lib/audio-fixture.ts';
import { fixture } from '../lib/fixture.ts';

assert.deepEqual(
  [...ambienceModule.ONE_SHOTS],
  ['dog', 'siren', 'creak', 'settle', 'birds', 'vehicle', 'heli']
);
const { actx, sources } = audioFixture();
const bank = new WeaponSampleBank(actx),
  rng = new Rng(474);
for (const [key, urls] of fixtureEntries(ENVIRONMENT_URLS))
  bank.hitBuffers[key] = urls.map(
    (_, index): FixtureAudioBuffer => new FixtureAudioBuffer({ key, index, duration: 2 })
  );
for (const kind of ENVIRONMENT_KINDS) {
  const voice = bank.environment(kind, rng, { when: 3 });
  const source = at(sources, -1);
  assert.equal(fixtureBuffer(source.buffer).key, environmentBank(kind));
  assert.equal(source.playbackRate.value, 1);
  assert.equal(source.when, 3);
  assert.equal(voice.end, 5.02);
}
const audio = new AudioSystem();
audio.running = true;
audio.actx = actx;
audio.samples = bank;
audio.rng = rng;
audio.field = fixture<SpatialField>({ listenerPos: { x: 0, y: 1.6, z: 0 } });
const calls: Parameters<AudioSystem['_playAt']>[] = [];
audio._playAt = (...a): boolean => {
  calls.push(a);
  return true;
};
audio.bark = (): never => {
  throw Error('phantom tactical voice');
};
for (const which of ENVIRONMENT_KINDS) {
  rng.pick = <T>(values: readonly T[]): T => {
    const value = values.find((item): boolean => item === which);
    if (value === undefined) throw Error('environment fixture kind missing');
    return value;
  };
  audio._ambientOneShot();
  assert.equal(at(calls, -1)[4]?.which, which);
  assert.equal(at(calls, -1)[5], 'ambience');
}
assert.equal(typeof ('_distantChatter' in audio ? audio._distantChatter : undefined), 'undefined');
const empty = new WeaponSampleBank(actx);
assert.throws((): AudioVoice => empty.environment('dog', rng), /recordings are not loaded/);
assert.throws(
  (): unknown => Reflect.apply(bank.environment.bind(bank), bank, ['shout', rng]),
  /recordings are not loaded/
);
console.log(
  'Recorded environment assets, variants, no synthesis fallback, sparse scheduler ownership and no phantom tactical voices'
);
