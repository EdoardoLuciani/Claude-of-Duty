import assert from 'node:assert/strict';

import { EnergyPeakController, ENERGY_MIX } from '../../src/audio/energy.ts';

for (const rate of [44100, 48000, 96000]) {
  const length = rate * 3;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const amplitude = t < 0.3 ? 0.02 : t < 1.3 ? 3 : t < 2.8 ? 0.02 : 0;
    left[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / rate);
    right[i] = -left[i] * 0.5;
  }
  const outL = new Float32Array(length);
  const outR = new Float32Array(length);
  const core = new EnergyPeakController(rate);
  core.process(left, right, outL, outR);

  const chunkL = new Float32Array(length);
  const chunkR = new Float32Array(length);
  const chunked = new EnergyPeakController(rate);
  for (let i = 0; i < length; i += 128)
    chunked.process(
      left.subarray(i, i + 128),
      right.subarray(i, i + 128),
      chunkL.subarray(i, i + 128),
      chunkR.subarray(i, i + 128)
    );
  assert.deepEqual(outL, chunkL, 'not dependent on block/frame partition');
  assert.deepEqual(outR, chunkR);
  const delay = Math.round((rate * ENERGY_MIX.lookaheadMs) / 1000);
  let hotPower = 0;
  for (let i = 0; i < length; i++) {
    assert(Number.isFinite(outL[i]) && Number.isFinite(outR[i]));
    assert.equal(
      Math.abs(outR[i] + outL[i] * 0.5),
      0,
      'one linked gain preserves antiphase stereo'
    );
    if (i < delay)
      assert.equal(Math.abs(outL[i]), 0, 'declared lookahead, not a shifted source event');
    if (i > delay && Math.abs(left[i - delay]) > 1e-4) {
      const gain = outL[i] / left[i - delay];
      assert(gain >= 0 && gain <= ENERGY_MIX.maxGain + 1e-6, 'downward-only, never quiet AGC');
      if (i < rate * 0.2 || (i > rate * 2.5 && i < rate * 2.7))
        assert(Math.abs(gain - ENERGY_MIX.maxGain) < 0.01, 'normal gain returns smoothly');
    }
    if (i >= rate * 0.8 && i < rate * 1.1) hotPower += outL[i] ** 2;
    if (i > rate * 2.9)
      assert.equal(Math.abs(outL[i]), 0, 'silence stays silent after delay flush');
  }
  assert(Math.abs(Math.sqrt(hotPower / (rate * 0.3)) - ENERGY_MIX.targetRms) < 0.003);
  assert(Math.abs(core.gain - ENERGY_MIX.maxGain) < 0.003);

  const mono = new EnergyPeakController(rate);
  const impulse = new Float32Array(2048);
  impulse[0] = 0.25;
  const a = new Float32Array(2048);
  const b = new Float32Array(2048);
  mono.process(impulse, undefined, a, b);
  assert.deepEqual(a, b, 'mono input upmix does not change detector balance');
  assert(Math.abs(a[delay] - 0.25 * ENERGY_MIX.maxGain) < 1e-7);
  assert.equal(a.filter((value) => value !== 0).length, 1, 'no extra transient or tail');
}
console.log(
  'Energy mix: actual stereo power, target RMS, downward-only gain, lookahead, release and block invariance'
);
