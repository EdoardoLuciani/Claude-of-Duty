import assert from 'node:assert/strict';

import { Vector3 } from 'three';

import {
  EXPLOSION_URLS,
  EXPLOSION_MIX,
  explosionBlend,
  explosionDistanceGain,
} from '../../src/audio/explosions.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import type { SpatialField } from '../../src/audio/spatial.ts';
import type { AudioVoice } from '../../src/audio/types.ts';
import { Rng } from '../../src/core/rng.ts';
import { audioFixture } from '../lib/audio-banks.ts';
import {
  fixtureEntries,
  fixtureMixer,
  fixtureKeys,
  fixtureBuffer,
  FixtureAudioBuffer,
} from '../lib/audio-fixture.ts';
import { fixture } from '../lib/fixture.ts';

assert(
  Math.abs(20 * Math.log10(EXPLOSION_MIX.gain / 0.8) - 3) < 1e-12,
  'owner-requested +3 dB explosion gain'
);
assert.equal(fixtureKeys(EXPLOSION_URLS).length, 6);
for (const urls of Object.values(EXPLOSION_URLS)) assert.equal(urls.length, 4);
for (const [distance, expected] of [
  [0, ['close', 'mid', 0]],
  [20, ['close', 'mid', 0]],
  [42.5, ['close', 'mid', 0.5]],
  [65, ['close', 'mid', 1]],
  [90, ['close', 'mid', 1]],
  [135, ['mid', 'far', 0.5]],
  [180, ['mid', 'far', 1]],
  [330, ['mid', 'far', 1]],
] as const) {
  const { from, to, mix } = explosionBlend(distance);
  assert.deepEqual([from, to, mix], expected);
}
function weights(distance: number): Record<'close' | 'mid' | 'far', number> {
  const { from, to, mix } = explosionBlend(distance);
  const result = { close: 0, mid: 0, far: 0 };
  result[from] = 1 - mix;
  result[to] = mix;
  return result;
}
for (const edge of [20, 50, 65, 90, 180]) {
  const a = weights(edge - 1e-6),
    b = weights(edge + 1e-6);
  for (const key of fixtureKeys(a)) assert(Math.abs(a[key] - b[key]) < 1e-6);
}
for (let distance = 0; distance <= 400; distance += 0.25) {
  const w = Object.values(weights(distance));
  assert(w.every((v): boolean => v >= 0 && v <= 1));
  assert(Math.abs(w.reduce((a, b): number => a + b, 0) - 1) < 1e-12);
}

for (const [kind, reference] of [
  ['grenade', 8],
  ['bomb', 16],
] as const) {
  let previous = 1;
  for (let distance = 0; distance <= 400; distance += 0.25) {
    const gain = explosionDistanceGain(distance, kind);
    assert.equal(gain, reference / Math.max(reference, distance));
    assert(gain > 0 && gain <= previous && gain <= 1);
    previous = gain;
  }
  assert.equal(explosionDistanceGain(reference, kind), 1);
  assert.equal(explosionDistanceGain(reference * 2, kind), 0.5);
}

const { actx, sources } = audioFixture(2);
const gains = actx.gains;
const bank = new WeaponSampleBank(actx);
for (const [key, urls] of fixtureEntries(EXPLOSION_URLS))
  bank.hitBuffers[key] = urls.map(
    (_, index): FixtureAudioBuffer => new FixtureAudioBuffer({ key, index, duration: 3 + index })
  );
const rng = new Rng(112);
for (const kind of ['grenade', 'bomb'] as const) {
  for (const distance of [0, 42.5, 65, 135, 180, 330]) {
    const previous = new Map<string, number>();
    const seen = new Map<string, Set<number>>();
    for (let i = 0; i < 20; i++) {
      sources.length = 0;
      gains.length = 0;
      const voice = bank.explosion(kind, rng, { when: 4, distance, level: 0.7 });
      assert.equal(gains[0].gain.value, 0.7);
      assert.equal(voice.send, EXPLOSION_MIX.send);
      const expected = fixtureEntries(weights(distance)).filter(
        ([, weight]): boolean => weight > 0
      );
      assert.deepEqual(
        sources.map((s): string => fixtureBuffer(s.buffer).key),
        expected.map(([p]): string => `${kind}-${p}`)
      );
      assert.equal(
        voice.end,
        4 + Math.max(...sources.map((s): number => fixtureBuffer(s.buffer).duration)) + 0.02
      );
      let sum = 0;
      sources.forEach((source, index): void => {
        const { key, index: take } = fixtureBuffer(source.buffer);
        assert.equal(source.when, 4, 'both perspectives keep the same propagation time');
        assert.equal(source.playbackRate.value, 1, 'real takes, not pitch-shifted variants');
        assert.equal(gains[index + 1].gain.value, expected[index][1]);
        sum += gains[index + 1].gain.value;
        if (previous.has(key)) assert.notEqual(take, previous.get(key), 'no immediate repeat');
        previous.set(key, take);
        if (!seen.has(key)) seen.set(key, new Set());
        const takes = seen.get(key);
        assert(takes);
        takes.add(take);
      });
      assert.equal(sum, 1, 'no crossfade level boost');
    }
    for (const takes of seen.values()) assert.equal(takes.size, 4);
  }
}
// Real dispatcher at close, the old 50 m discontinuity and background distance.
const audio = new AudioSystem();
audio.samples = bank;
audio.actx = actx;
audio.rng = rng;
for (const distance of [0, 49.999, 50.001, 120, 330]) {
  sources.length = 0;
  audio._build('explosion', 5, distance, { explosionKind: 'bomb' });
  assert(sources.every((s): boolean => fixtureBuffer(s.buffer).key.startsWith('bomb-')));
}
sources.length = 0;
audio._build('explosion', 5, 0, {});
assert.equal(
  fixtureBuffer(sources[0].buffer).key,
  'grenade-close',
  'legacy events have an explicit default'
);
let acquired: Parameters<SpatialField['acquire']>[0] | undefined;
audio.running = true;
audio.field = fixture<SpatialField>({
  distanceTo: (): number => 70,
  acquire(options): ReturnType<SpatialField['acquire']> {
    acquired = options;
    return fixture<NonNullable<ReturnType<SpatialField['acquire']>>>({});
  },
  hold(): void {},
});
for (const kind of ['grenade', 'bomb'] as const) {
  assert(audio._playAt('explosion', 0, 0, -70, { explosionKind: kind }, 'weapons'));
  assert(acquired);
  assert.equal(acquired.atten, explosionDistanceGain(70, kind));
  assert.equal(acquired.when, 2 + 70 / 343, 'propagation delay remains physical');
  assert.equal(acquired.send, EXPLOSION_MIX.send);
  assert.equal(acquired.occlusion, undefined, 'existing world occlusion remains enabled');
}
let played: Parameters<AudioSystem['_playAt']> | undefined;
audio.running = true;
audio.field = fixture<SpatialField>({ distanceTo: (): number => 30 });
audio.mixer = fixtureMixer(actx);
audio._playAt = (...args): boolean => {
  played = args;
  return true;
};
for (const kind of ['grenade', 'bomb'] as const) {
  audio._onExplosion({
    kind,
    position: new Vector3(0, 0, -30),
    radius: kind === 'bomb' ? 20 : 10,
    damage: 0,
  });
  assert(played);
  assert.equal(played[4]?.explosionKind, kind);
  assert.equal(played[4]?.send, undefined, 'recorded voice owns its restrained reverb send');
  assert.equal(played[4]?.gain, EXPLOSION_MIX.gain, 'both ordnance identities receive the boost');
  assert.equal(played[5], 'weapons');
}

bank.dispose();
for (const kind of ['grenade', 'bomb'] as const)
  for (const distance of [0, 42.5, 65, 135, 180, 330])
    assert.throws(
      (): AudioVoice => bank.explosion(kind, rng, { distance }),
      /recordings are not loaded/
    );
console.log(
  'Recorded explosions: identities, all distances, continuous blends, no repeat/pitch/synthesis, full tails, routing and fail-closed lifecycle'
);
