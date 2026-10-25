import assert from 'node:assert/strict';

import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { Rng } from '../../src/core/rng.ts';

const sources = [];
const context = {
  currentTime: 0,
  createGain: () => ({ gain: { value: 1 }, connect() {} }),
  createBufferSource() {
    const source = {
      playbackRate: { value: 1 },
      connect() {},
      start(when) {
        this.when = when;
      },
    };
    sources.push(source);
    return source;
  },
};
const cases = [
  ['reload', 'reloadBuffers', ['ar-out'], (bank, rng) => bank.reload('rifle', 'magout', rng)],
  ['reaction', 'hitBuffers', ['reaction-0-hurt'], (bank, rng) => bank.reaction('hurt', 0, rng)],
  ['environment', 'hitBuffers', ['environment-dog'], (bank, rng) => bank.environment('dog', rng)],
  [
    'radio',
    'hitBuffers',
    ['radio-click', 'radio-static'],
    (bank, rng) => bank.radio('radio_open', rng),
  ],
  ['hit', 'hitBuffers', ['flesh'], (bank, rng) => bank.hit('flesh', rng)],
];
for (const count of [1, 2, 3, 4]) {
  for (const [name, field, keys, play] of cases) {
    const bank = new WeaponSampleBank(context);
    const previous = new Map();
    const seen = new Map(keys.map((key) => [key, new Set()]));
    let draws = 0;
    const seeded = new Rng(473);
    const rng = {
      u32: () => {
        draws++;
        return seeded.u32();
      },
      range: (min, max) => (min + max) / 2,
    };
    for (const key of keys)
      bank[field][key] = Array.from({ length: count }, (_, index) => ({
        key,
        index,
        duration: 0.5,
      }));
    for (let i = 0; i < 20; i++) {
      const before = sources.length;
      play(bank, rng);
      const added = sources.slice(before);
      assert.equal(added.length, keys.length, `${name}: retain voice layers`);
      for (const source of added) {
        assert(source.when >= context.currentTime && source.when <= context.currentTime + 0.02);
        assert(source.playbackRate.value >= 0.98 && source.playbackRate.value <= 1.02);
      }
      for (const source of added) {
        assert(source.buffer, `${name}: single-take banks never select NaN`);
        const { key, index } = source.buffer;
        if (count > 1 && previous.has(key))
          assert.notEqual(index, previous.get(key), `${name}: no immediate repeat`);
        previous.set(key, index);
        seen.get(key).add(index);
      }
      assert.equal(draws, (i + 1) * keys.length, `${name}: exactly one selection draw per layer`);
    }
    for (const values of seen.values())
      assert.equal(values.size, count, `${name}: every take is reachable`);
    bank.dispose();
    assert.throws(
      () => play(bank, rng),
      /recordings are not loaded/,
      `${name}: missing required banks still fail closed`
    );
  }
}
console.log(
  'sample selection: shared no-repeat policy, single-take safety, RNG draw counts and required-bank failures'
);
