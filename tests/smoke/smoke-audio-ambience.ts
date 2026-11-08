import assert from 'node:assert/strict';

import { Ambience } from '../../src/audio/ambience.ts';
import { Rng } from '../../src/core/rng.ts';

// The scheduler needs no AudioContext/NoiseBank: starting ambience must not
// create a continuous noise source. Native mix tests also assert exact silence.
for (const seed of [1907, 3074, 7528]) {
  const ambience = new Ambience(new Rng(seed));
  const counts = { volley: 0, boom: 0, oneshot: 0, chatter: 0 };
  const api = {
    distantVolley: () => counts.volley++,
    distantBoom: () => counts.boom++,
    oneShot: () => counts.oneshot++,
    distantChatter: () => counts.chatter++,
  };
  ambience.update(120, api);
  assert(
    Object.values(counts).every((n) => n === 0),
    'inactive scheduler is silent'
  );
  ambience.start();
  const timers = { ...ambience._timers };
  for (const [name, [min, max]] of Object.entries({
    volley: [3, 11],
    boom: [14, 44],
    oneshot: [5, 17],
  }))
    assert(timers[name] >= min && timers[name] < max, `${name}: initial timing retained`);
  assert(!('chatter' in timers), 'no phantom tactical-voice timer');
  ambience.start();
  assert.deepEqual(ambience._timers, timers, 'start remains idempotent');
  for (let frame = 0; frame < 7200; frame++) ambience.update(1 / 60, api);
  assert(
    ['volley', 'boom', 'oneshot'].every((name) => counts[name] > 0),
    'all sparse event types still run'
  );
  const before = { ...counts };
  const stoppedTimers = { ...ambience._timers };
  ambience.dispose();
  ambience.dispose();
  ambience.update(120, api);
  assert.deepEqual(counts, before, 'disposed scheduler emits no events');
  assert.deepEqual(ambience._timers, stoppedTimers, 'disposed timers do not advance');
  ambience.start();
  ambience.update(120, api);
  assert(
    ['volley', 'boom', 'oneshot'].every((name) => counts[name] > before[name]),
    'sparse events resume after restarting'
  );
  assert.equal(counts.chatter, 0, 'ambient events never fabricate tactical callouts');
  ambience.dispose();
}
console.log('PASS: quiet ambience scheduler, sparse events, start/stop/restart');
