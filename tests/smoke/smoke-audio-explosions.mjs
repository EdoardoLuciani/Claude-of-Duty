import assert from 'node:assert/strict';

import {
  EXPLOSION_URLS,
  EXPLOSION_MIX,
  explosionBlend,
  explosionDistanceGain,
} from '../../src/audio/explosions.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { Rng } from '../../src/core/rng.ts';
import { audioFixture } from '../lib/audio-banks.mjs';

assert.equal(Object.keys(EXPLOSION_URLS).length, 6);
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
]) {
  const { from, to, mix } = explosionBlend(distance);
  assert.deepEqual([from, to, mix], expected);
}
function weights(distance) {
  const { from, to, mix } = explosionBlend(distance);
  const result = { close: 0, mid: 0, far: 0 };
  result[from] = 1 - mix;
  result[to] = mix;
  return result;
}
for (const edge of [20, 50, 65, 90, 180]) {
  const a = weights(edge - 1e-6),
    b = weights(edge + 1e-6);
  for (const key of Object.keys(a)) assert(Math.abs(a[key] - b[key]) < 1e-6);
}
for (let distance = 0; distance <= 400; distance += 0.25) {
  const w = Object.values(weights(distance));
  assert(w.every((v) => v >= 0 && v <= 1));
  assert(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-12);
}

for (const [kind, reference] of [
  ['grenade', 8],
  ['bomb', 16],
]) {
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
const gains = [];
actx.createGain = () => {
  const node = { gain: { value: 0 }, connect() {}, disconnect() {} };
  gains.push(node);
  return node;
};
const bank = new WeaponSampleBank(actx);
for (const [key, urls] of Object.entries(EXPLOSION_URLS))
  bank.hitBuffers[key] = urls.map((_, index) => ({ key, index, duration: 3 + index }));
const rng = new Rng(112);
for (const kind of ['grenade', 'bomb']) {
  for (const distance of [0, 42.5, 65, 135, 180, 330]) {
    const previous = new Map();
    const seen = new Map();
    for (let i = 0; i < 20; i++) {
      sources.length = 0;
      gains.length = 0;
      const voice = bank.explosion(kind, rng, { when: 4, distance, level: 0.7 });
      assert.equal(gains[0].gain.value, 0.7);
      assert.equal(voice.send, EXPLOSION_MIX.send);
      const expected = Object.entries(weights(distance)).filter(([, weight]) => weight > 0);
      assert.deepEqual(
        sources.map((s) => s.buffer.key),
        expected.map(([p]) => `${kind}-${p}`)
      );
      assert.equal(voice.end, 4 + Math.max(...sources.map((s) => s.buffer.duration)) + 0.02);
      let sum = 0;
      sources.forEach((source, index) => {
        const { key, index: take } = source.buffer;
        assert.equal(source.when, 4, 'both perspectives keep the same propagation time');
        assert.equal(source.playbackRate.value, 1, 'real takes, not pitch-shifted variants');
        assert.equal(gains[index + 1].gain.value, expected[index][1]);
        sum += gains[index + 1].gain.value;
        if (previous.has(key)) assert.notEqual(take, previous.get(key), 'no immediate repeat');
        previous.set(key, take);
        if (!seen.has(key)) seen.set(key, new Set());
        seen.get(key).add(take);
      });
      assert.equal(sum, 1, 'no crossfade level boost');
    }
    for (const takes of seen.values()) assert.equal(takes.size, 4);
  }
}
// Real dispatcher at close, the old 50 m discontinuity and background distance.
const audio = new AudioSystem();
Object.assign(audio, { samples: bank, actx, rng });
for (const distance of [0, 49.999, 50.001, 120, 330]) {
  sources.length = 0;
  audio._build('explosion', 5, distance, { explosionKind: 'bomb' });
  assert(sources.every((s) => s.buffer.key.startsWith('bomb-')));
}
sources.length = 0;
audio._build('explosion', 5, 0, {});
assert.equal(sources[0].buffer.key, 'grenade-close', 'legacy events have an explicit default');
let acquired;
Object.assign(audio, {
  running: true,
  field: {
    distanceTo: () => 70,
    acquire(options) {
      acquired = options;
      return {};
    },
    hold() {},
  },
});
for (const kind of ['grenade', 'bomb']) {
  assert(audio._playAt('explosion', 0, 0, -70, { explosionKind: kind }, 'weapons'));
  assert.equal(acquired.atten, explosionDistanceGain(70, kind));
  assert.equal(acquired.when, 2 + 70 / 343, 'propagation delay remains physical');
  assert.equal(acquired.send, EXPLOSION_MIX.send);
  assert.equal(acquired.occlusion, undefined, 'existing world occlusion remains enabled');
}
let played;
Object.assign(audio, {
  running: true,
  field: { distanceTo: () => 30 },
  mixer: { duck() {} },
  _playAt(...args) {
    played = args;
  },
});
audio._onExplosion({ kind: 'bomb', position: { x: 0, y: 0, z: -30 }, radius: 20 });
assert.equal(played[4].explosionKind, 'bomb');
assert.equal(played[4].send, undefined, 'recorded voice owns its restrained reverb send');
assert.equal(played[4].gain, EXPLOSION_MIX.gain);
assert.equal(played[5], 'weapons');

bank.dispose();
for (const kind of ['grenade', 'bomb'])
  for (const distance of [0, 42.5, 65, 135, 180, 330])
    assert.throws(() => bank.explosion(kind, rng, { distance }), /recordings are not loaded/);
console.log(
  'Recorded explosions: identities, all distances, continuous blends, no repeat/pitch/synthesis, full tails, routing and fail-closed lifecycle'
);
