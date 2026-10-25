import assert from 'node:assert/strict';

import { ENERGY_MIX, EnergyPeakController } from '../../src/audio/energy.ts';
import { LookaheadPeakGain, PEAK_LIMITER } from '../../src/audio/peak.ts';

assert.equal(ENERGY_MIX.maxGain, 1);
assert.throws(() => new LookaheadPeakGain(48000, 0), RangeError);
for (const rate of [44100, 48000, 96000]) {
  const delay = Math.round((rate * ENERGY_MIX.lookaheadMs) / 1000);
  const length = rate * 3;
  const l = new Float32Array(length);
  const r = new Float32Array(length);
  let seed = 17;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const amplitude = i < 1000 ? 0.02 : i < rate ? 30 : i < rate * 1.5 ? 0.03 : 0;
    l[i] = amplitude * (seed / 2147483648 - 1);
    r[i] = -0.5 * l[i];
  }
  for (const i of [0, 127, 128, 255, delay, delay + 1, rate - 1]) l[i] = 1000;
  const peak = new LookaheadPeakGain(rate, delay);
  const gains = new Float64Array(length);
  let maximum = 0;
  // Independent slow maximum oracle verifies queue expiry, equal peaks and the
  // smoothing horizon; not a second copy of the monotonic-deque implementation.
  let held = 1;
  const history = new Float64Array(delay).fill(1);
  let sum = delay;
  const recovery = 1 - Math.exp(-1 / (rate * PEAK_LIMITER.releaseMs * 0.001));
  for (let i = 0; i < length; i++) {
    const gain = (gains[i] = peak.next(l[i], r[i]));
    assert(Number.isFinite(gain) && gain >= 0 && gain <= 1);
    if (i < 3000) {
      let hot = 0;
      for (let j = Math.max(0, i - delay); j <= i; j++)
        hot = Math.max(hot, Math.abs(l[j]), Math.abs(r[j]));
      held = Math.min(1, PEAK_LIMITER.ceiling / Math.max(hot, 1e-12), held + (1 - held) * recovery);
      sum += held - history[i % delay];
      history[i % delay] = held;
      assert(Math.abs(gain - sum / delay) < 2e-12, 'independent window/attack oracle');
    }
    if (i >= delay) {
      maximum = Math.max(maximum, Math.abs(l[i - delay] * gain), Math.abs(r[i - delay] * gain));
      assert(maximum <= PEAK_LIMITER.ceiling + 1e-8, 'gain alone contains peaks, no sample clamp');
    }
  }
  assert(maximum > 0.98, 'actual large peaks preserved up to the declared limit');
  assert(gains.at(-1) > 0.9999, 'gain releases toward unity during silence');

  const a = new Float32Array(length),
    b = new Float32Array(length);
  const controller = new EnergyPeakController(rate);
  controller.process(l, r, a, b);
  const reference = new EnergyPeakController(rate);
  const sampleL = new Float32Array(1),
    sampleR = new Float32Array(1);
  const rmsGains = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    reference.process(l.subarray(i, i + 1), r.subarray(i, i + 1), sampleL, sampleR);
    rmsGains[i] = reference.gain;
  }
  const c = new Float32Array(length),
    d = new Float32Array(length);
  const chunked = new EnergyPeakController(rate);
  for (let i = 0; i < length; i += 128)
    chunked.process(
      l.subarray(i, i + 128),
      r.subarray(i, i + 128),
      c.subarray(i, i + 128),
      d.subarray(i, i + 128)
    );
  assert.deepEqual(a, c, 'full controller block invariance');
  assert.deepEqual(b, d);
  for (let i = 0; i < length; i++) {
    assert(Number.isFinite(a[i]) && Math.abs(a[i]) <= PEAK_LIMITER.ceiling + 1e-7);
    assert(Math.abs(b[i]) <= PEAK_LIMITER.ceiling + 1e-7);
    if (i < delay)
      assert.equal(Math.abs(a[i]) + Math.abs(b[i]), 0, 'one shared lookahead, not two delays');
    const input = i >= delay ? l[i - delay] : 0;
    const other = i >= delay ? r[i - delay] : 0;
    assert(
      Math.abs(a[i] * other - b[i] * input) < 1e-4,
      'common gain preserves stereo including antiphase'
    );
    assert(
      Math.abs(a[i]) <= Math.abs(input * rmsGains[i]) + 1e-7,
      'peak envelope never boosts RMS output'
    );
    if (Math.abs(input) > 1e-6) {
      const rmsGain = rmsGains[i];
      assert(
        Math.abs(a[i] - input * Math.min(rmsGain, gains[i])) < 1e-7,
        'tighter envelope wins, not two multiplied reductions'
      );
    }
  }

  const isolated = new LookaheadPeakGain(rate, delay);
  const attack = new Float64Array(delay + 1);
  for (let i = 0; i <= delay; i++) attack[i] = isolated.next(i === 0 ? 10 : 0, 0);
  assert(attack[0] > 0.99, 'gain starts a gradual anticipatory attack, not an instantaneous clip');
  assert(Math.abs(attack[delay] - PEAK_LIMITER.ceiling / 10) < 1e-12);
  for (let i = 1; i < attack.length; i++)
    assert(Math.abs(attack[i] - attack[i - 1]) <= 1 / delay + 1e-12);
}
console.log(
  'Peak limiter: independent oracle, anticipatory attack, strict sample bound, shared lookahead, stereo, release, block invariance; no waveform clipping'
);
