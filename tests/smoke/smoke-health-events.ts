import assert from 'node:assert/strict';

import { PerspectiveCamera } from 'three';

import type { EngineEventMap } from '../../src/core/events.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Health } from '../../src/player/health.ts';

const snapshots: EngineEventMap['player:health'][] = [];
const ctx = {
  time: { elapsed: 0 },
  camera: new PerspectiveCamera(),
  events: new EventBus(),
};
ctx.events.on('player:health', (payload): void => {
  snapshots.push({ ...payload });
});
function latest(): EngineEventMap['player:health'] {
  const snapshot = snapshots.at(-1);
  assert.ok(snapshot);
  return snapshot;
}
const health = new Health(ctx, null);
health.damage(20, null);
assert.equal(snapshots.length, 1, 'damage publishes immediately');
assert.equal(latest().health, 80);
health.heal(10);
assert.equal(snapshots.length, 2, 'healing publishes immediately');
assert.equal(latest().health, 90);
health.reset();
assert.equal(snapshots.length, 3, 'reset publishes immediately');
assert.equal(latest().health, 100);
health.setDebugValue(28);
assert.equal(snapshots.length, 4, 'diagnostic overrides explicitly notify blood/health consumers');
assert.equal(latest().fraction, 0.28);
assert.equal(latest().changedLowState, true);
for (let i = 0; i < 120; i++) {
  ctx.time.elapsed += 1 / 60;
  health.update(1 / 60);
}
assert.equal(snapshots.length, 4, 'per-frame injury/heartbeat animation does not poll health');
health.value = 40; // Raw test setup deliberately bypasses the explicit notification API.
health.update(1);
assert.equal(snapshots.length, 4, 'there is no deferred dirty-value polling path');
health.setDebugValue(10000);
assert.equal(latest().health, 10000, 'diagnostic invulnerability retains uncapped health');
assert.equal(latest().fraction, 1);
console.log(
  'health events: damage/heal/reset/debug notifications are synchronous, with no change polling'
);
