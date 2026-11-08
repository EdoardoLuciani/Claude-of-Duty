import assert from 'node:assert/strict';

import { WeaponSampleBank } from '../../src/audio/samples.ts';
import type { AudioVoice } from '../../src/audio/types.ts';
import { Rng } from '../../src/core/rng.ts';
import { audioFixture } from '../lib/audio-banks.ts';
import { FixtureAudioBuffer, at } from '../lib/audio-fixture.ts';

const { actx, sources } = audioFixture(10);
const bank = new WeaponSampleBank(actx);
const rng = new Rng(123);
const oracle = new Rng(123);
const state = (random: Rng): number[] => [random.s0, random.s1, random.s2, random.s3];
type RecordingCase = {
  play: (options: { when?: number }) => AudioVoice;
  level: () => number;
  send: number;
  delay: number;
} & (
  | { key: 'ar-out'; reload: true }
  | { key: 'reaction-1-hurt' | 'environment-heli' | 'whizz' | 'dry-ar'; reload?: false }
);
const cases: RecordingCase[] = [
  {
    key: 'ar-out',
    reload: true,
    play: (options): AudioVoice => bank.reload('rifle', 'magout', rng, options),
    level: (): number => oracle.range(0.97, 1.03),
    send: 0.12,
    delay: 0,
  },
  {
    key: 'reaction-1-hurt',
    play: (options): AudioVoice => bank.reaction('hurt', 3, rng, { ...options, level: 0.6 }),
    level: (): number => 0.6,
    send: 0.45,
    delay: 0,
  },
  {
    key: 'environment-heli',
    play: (options): AudioVoice => bank.environment('heli', rng, { ...options, level: 0.6 }),
    level: (): number => 2.4,
    send: 0.65,
    delay: 0,
  },
  {
    key: 'whizz',
    play: (options): AudioVoice =>
      bank.combat('whizz', rng, { ...options, level: 0.6, delay: 0.3, send: 0.2 }),
    level: (): number => 0.6,
    send: 0.2,
    delay: 0.3,
  },
  {
    key: 'dry-ar',
    play: (options): AudioVoice => bank.combat('dry-ar', rng, { ...options, delay: -1 }),
    level: (): number => 1,
    send: 0,
    delay: 0,
  },
];
for (const test of cases) {
  const buffers = [0.4, 0.8, 1.2].map(
    (duration, index): FixtureAudioBuffer =>
      new FixtureAudioBuffer({ duration, index, key: test.key })
  );
  if (test.reload) bank.reloadBuffers[test.key] = buffers;
  else bank.hitBuffers[test.key] = buffers;
  let previous = -1;
  for (const options of [{}, { when: 0 }, { when: 2 }, {}, { when: 4 }]) {
    const draw = oracle.u32();
    const index =
      previous < 0 ? draw % buffers.length : (previous + 1 + (draw % 2)) % buffers.length;
    const level = test.level();
    const voice = test.play(options);
    const source = at(sources, -1);
    assert.equal(source.buffer, buffers[index], test.key + ' take and RNG order');
    assert.notEqual(index, previous, test.key + ' never immediately repeats');
    assert.equal(source.playbackRate.value, 1, 'authored timing remains natural');
    assert.equal(source.when, (options.when ?? 10) + test.delay);
    assert.equal(source.output, voice.node, 'one source feeds exactly the returned top gain');
    assert.equal(voice.node.gain.value, level, test.key + ' exact gain, no envelope added');
    assert.equal(voice.send, test.send);
    assert.equal(voice.end, source.when + buffers[index].duration + 0.02, 'full tail retained');
    assert.equal(source.stopped, undefined, 'one-shots retain their existing natural lifetime');
    assert.equal(source.disconnected, undefined);
    assert.deepEqual(state(rng), state(oracle), test.key + ' consumes only its original RNG draws');
    previous = index;
  }
}
const before = state(rng);
const count = sources.length;
assert.throws((): AudioVoice => bank.reload('unknown', 'magout', rng), /no recorded reload cue/);
assert.throws((): AudioVoice => bank.reaction('death', 0, rng), /recordings are not loaded/);
assert.throws((): AudioVoice => bank.environment('dog', rng), /recordings are not loaded/);
assert.throws(
  (): AudioVoice => bank.combat('grenade-throw', rng),
  /combat recordings are not loaded/
);
assert.deepEqual(state(rng), before, 'missing cues reject before RNG consumption');
assert.equal(sources.length, count, 'missing cues never create or schedule a source');
console.log(
  'Shared natural-rate playback preserves exact takes, RNG, gain, scheduling, sends and tails'
);
