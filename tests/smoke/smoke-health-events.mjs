import assert from 'node:assert/strict';

import { Health } from '../../src/player/health.ts';

const snapshots = [];
const ctx = {
  time: { elapsed: 0 },
  camera: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } },
  events: {
    emit: (type, payload) => {
      if (type === 'player:health') snapshots.push({ ...payload });
    },
  },
};
const health = new Health(ctx, null);
health.damage(20, null);
assert.equal(snapshots.length, 1, 'damage publishes immediately');
assert.equal(snapshots.at(-1).health, 80);
health.heal(10);
assert.equal(snapshots.length, 2, 'healing publishes immediately');
assert.equal(snapshots.at(-1).health, 90);
health.reset();
assert.equal(snapshots.length, 3, 'reset publishes immediately');
assert.equal(snapshots.at(-1).health, 100);
health.setDebugValue(28);
assert.equal(snapshots.length, 4, 'diagnostic overrides explicitly notify blood/health consumers');
assert.equal(snapshots.at(-1).fraction, 0.28);
assert.equal(snapshots.at(-1).changedLowState, true);
for (let i = 0; i < 120; i++) {
  ctx.time.elapsed += 1 / 60;
  health.update(1 / 60);
}
assert.equal(snapshots.length, 4, 'per-frame injury/heartbeat animation does not poll health');
health.value = 40; // Raw test setup deliberately bypasses the explicit notification API.
health.update(1);
assert.equal(snapshots.length, 4, 'there is no deferred dirty-value polling path');
health.setDebugValue(10000);
assert.equal(snapshots.at(-1).health, 10000, 'diagnostic invulnerability retains uncapped health');
assert.equal(snapshots.at(-1).fraction, 1);
for (const snapshot of snapshots)
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ['changedLowState', 'dead', 'effect', 'fraction', 'health', 'low', 'suppression'],
    'health notifications retain their state data without redundant forced metadata'
  );
console.log(
  'health events: damage/heal/reset/debug notifications are synchronous, with no change polling'
);
