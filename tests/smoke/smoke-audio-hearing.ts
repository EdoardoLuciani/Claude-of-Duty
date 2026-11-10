import assert from 'node:assert/strict';

import {
  createAudioContext,
  FixtureAudioParam,
  FixtureGainNode,
  FixtureBiquad,
  fixtureMixer,
} from '../lib/audio-fixture.ts';

// Firefox lacks cancelAndHoldAtTime. Use the same cancel-and-anchor path even
// when native hold exists, preserving the sampled value before cancellation.
for (const nativeHold of [false, true]) {
  const actx = createAudioContext(10);
  const mixer = fixtureMixer(actx);
  const dryNode = new FixtureGainNode(actx),
    wetNode = new FixtureGainNode(actx),
    levelNode = new FixtureGainNode(actx);
  const lp = new FixtureBiquad(actx),
    hs = new FixtureBiquad(actx);
  const params = [0.25, 0.75, 0.8, 2000, -6].map((v): FixtureAudioParam => {
    const param = new FixtureAudioParam(v);
    if (!nativeHold) Object.defineProperty(param, 'cancelAndHoldAtTime', { value: undefined });
    return param;
  });
  [dryNode.gain, wetNode.gain, levelNode.gain, lp.frequency, hs.gain] = params;
  mixer.muffleDry = dryNode;
  mixer.muffleWet = wetNode;
  mixer.muffleGain = levelNode;
  mixer.muffleLP = lp;
  mixer.muffleHS = hs;
  const [dry, wet, level, cutoff, shelf] = params;
  mixer._pendingConcussion = { level: 1, at: 11, attack: 0.02 };
  mixer._concussionAttackUntil = 12;
  mixer.deafness = 0.8;
  mixer._tin = null;
  mixer._startTinnitus = (): void => {};

  assert.doesNotThrow((): void => mixer.resetHearing(), 'restart works with either AudioParam API');
  assert.equal(mixer._pendingConcussion, null);
  assert.equal(mixer._concussionAttackUntil, 0);
  assert.equal(mixer.deafness, 0);
  for (const [index, value] of [0.25, 0.75, 0.8, 2000, -6].entries()) {
    assert.deepEqual(params[index].events.slice(0, 2), [
      ['cancel', 10],
      ['set', value, 10],
    ]);
  }
  assert.deepEqual(dry.events[2], ['ramp', 1, 10.03]);
  assert.deepEqual(wet.events[2], ['ramp', 0, 10.03]);
  assert.deepEqual(level.events[2], ['ramp', 1, 10.03]);
  assert.deepEqual(cutoff.events[2], ['target', 20000, 10, 0.25]);
  assert.deepEqual(shelf.events[2], ['target', 0, 10, 0.25]);

  actx.currentTime = 10.01;
  assert.doesNotThrow((): void => mixer.concuss(1), 'concussion can interrupt the reset ramp');
  assert.equal(mixer.deafness, 1);
  assert.doesNotThrow((): void => mixer.resetHearing(), 'repeated restart cancels concussion');
  assert.equal(mixer.deafness, 0);
}
console.log(
  'Hearing reset/retrigger preserves sampled values with and without native AudioParam hold'
);
