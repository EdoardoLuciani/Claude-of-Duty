import assert from 'node:assert/strict';

import { Mixer } from '../../src/audio/mixer.ts';

function parameter(value, nativeHold) {
  const events = [];
  const param = {
    value,
    events,
    cancelScheduledValues(time) {
      events.push(['cancel', time]);
      this.value = -1; // Cancelling must not discard the sampled pre-cancel value.
    },
    setValueAtTime(value, time) {
      events.push(['set', value, time]);
      this.value = value;
    },
    linearRampToValueAtTime(value, time) {
      events.push(['ramp', value, time]);
    },
    setTargetAtTime(value, time, constant) {
      events.push(['target', value, time, constant]);
    },
  };
  if (nativeHold) {
    param.cancelAndHoldAtTime = (time) => events.push(['hold', time]);
  }
  return param;
}

// Firefox has AudioParam.cancelScheduledValues but no cancelAndHoldAtTime.
// Exercise the real restart/concussion paths with both API surfaces.
for (const nativeHold of [false, true]) {
  const params = [0.25, 0.75, 0.8, 2000, -6].map((v) => parameter(v, nativeHold));
  const [dry, wet, level, cutoff, shelf] = params;
  const mixer = Object.assign(Object.create(Mixer.prototype), {
    actx: { currentTime: 10 },
    muffleDry: { gain: dry },
    muffleWet: { gain: wet },
    muffleGain: { gain: level },
    muffleLP: { frequency: cutoff },
    muffleHS: { gain: shelf },
    _pendingConcussion: { level: 1, at: 11, attack: 0.02 },
    _concussionAttackUntil: 12,
    deafness: 0.8,
    _tin: null,
    _startTinnitus() {},
  });

  assert.doesNotThrow(() => mixer.resetHearing(), 'restart works with either AudioParam API');
  assert.equal(mixer._pendingConcussion, null);
  assert.equal(mixer._concussionAttackUntil, 0);
  assert.equal(mixer.deafness, 0);
  for (const [index, value] of [0.25, 0.75, 0.8, 2000, -6].entries()) {
    assert.deepEqual(params[index].events.slice(0, 2), [
      [nativeHold ? 'hold' : 'cancel', 10],
      ['set', value, 10],
    ]);
  }
  assert.deepEqual(dry.events[2], ['ramp', 1, 10.03]);
  assert.deepEqual(wet.events[2], ['ramp', 0, 10.03]);
  assert.deepEqual(level.events[2], ['ramp', 1, 10.03]);
  assert.deepEqual(cutoff.events[2], ['target', 20000, 10, 0.25]);
  assert.deepEqual(shelf.events[2], ['target', 0, 10, 0.25]);

  mixer.actx.currentTime = 10.01;
  assert.doesNotThrow(() => mixer.concuss(1), 'concussion can interrupt the reset ramp');
  assert.equal(mixer.deafness, 1);
  assert.doesNotThrow(() => mixer.resetHearing(), 'repeated restart cancels concussion');
  assert.equal(mixer.deafness, 0);
}
console.log(
  'Hearing reset/retrigger preserves sampled values with and without native AudioParam hold'
);
