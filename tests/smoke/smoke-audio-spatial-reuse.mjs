import assert from 'node:assert/strict';

import { SpatialField } from '../../src/audio/spatial.ts';

// Scheduling/topology oracle only; native E2E covers rendered parameter values.
const ctx = { currentTime: 0 };
function param(value = 0) {
  return {
    value,
    events: [],
    setValueAtTime(value, time) {
      this.events.push({ type: 'value', value, time });
    },
    setTargetAtTime(value, time, constant) {
      this.events.push({ type: 'target', value, time, constant });
    },
    cancelScheduledValues(time) {
      this.events = this.events.filter((event) => event.time < time);
    },
  };
}
function node() {
  return {
    gain: param(1),
    frequency: param(20000),
    Q: param(),
    positionX: param(),
    positionY: param(),
    positionZ: param(),
    outputs: new Set(),
    connect(target) {
      this.outputs.add(target);
    },
    disconnect() {
      this.outputs.clear();
    },
  };
}
Object.assign(ctx, { createGain: node, createBiquadFilter: node, createPanner: node });
const field = new SpatialField(ctx, { bus: () => node(), reverbSend: node() }, null);
const owned = (em) => [
  em.panner.positionX,
  em.panner.positionY,
  em.panner.positionZ,
  em.airLP.frequency,
  em.occLP.frequency,
  em.occHS.gain,
  em.distGain.gain,
  em.sendGain.gain,
];
const oldArrival = 100 / 343;
for (let i = 0; i < 40; i++)
  field.acquire({ x: 100, y: 0, z: 0, when: oldArrival, endTime: 2, priority: 0.95, send: 0.3 });
const original = field.emitters[0];
ctx.currentTime = 0.1;
const replacement = field.acquire({
  x: 2,
  y: 0,
  z: 0,
  when: ctx.currentTime + 2 / 343,
  endTime: 3,
  priority: 1,
  send: 0,
});
assert.equal(replacement, original);
assert.equal(field.stats.stolen, 1);
assert.equal(field.stats.dropped, 0);
for (const parameter of owned(replacement)) {
  assert(!parameter.events.some((event) => event.time === oldArrival));
  assert(parameter.events.some((event) => event.type === 'value' && event.time === 0.1));
  parameter.setTargetAtTime(123, 0.1, 0.5);
  parameter.setValueAtTime(456, 0.9);
  parameter.value = 42; // Native E2E, not this scheduling mock, computes the actual current value.
}
ctx.currentTime = 0.2;
replacement.detach();
for (const parameter of owned(replacement)) {
  assert(!parameter.events.some((event) => event.time >= 0.9));
  assert.deepEqual(parameter.events.at(-1), { type: 'value', value: 42, time: 0.2 });
}
assert(replacement.free && !replacement._connected && !replacement._sendConnected);
field.dispose();
console.log(
  'Spatial emitter ownership: retire all eight future timelines and anchor running targets'
);
