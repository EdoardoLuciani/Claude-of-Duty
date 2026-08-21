/**
 * Node smoke test for contact-minimap rules — no browser.
 *
 *   node tools/smoke-contact.mjs
 */
import assert from 'node:assert/strict';
import {
  FIRE_JITTER, RIM_SEEN, hudContact, fireJitter,
} from '../src/ai/contact.js';

function agent(partial = {}) {
  return {
    lastSeen: -Infinity, lastFired: -Infinity,
    lastSeenX: 0, lastSeenZ: 10, fireX: 1, fireZ: 11,
    ...partial,
  };
}

assert.equal(hudContact(10, agent()), null, 'never seen / never fired stays hidden');
assert.equal(hudContact(10, agent({ lastSeen: 7.9 })), null, 'LOS grace is 2 s');
assert.equal(hudContact(10, agent({ lastFired: 6.9 })), null, 'fire window is 3 s');

const live = hudContact(10, agent({ lastSeen: 10, lastSeenX: 4, lastSeenZ: -2 }));
assert.equal(live.kind, 'los');
assert.equal(live.x, 4);
assert.equal(live.z, -2);
assert.ok(Math.abs(live.fade - 1) < 1e-9, 'exact while visible');
assert.ok(live.seenAge < RIM_SEEN);

const fading = hudContact(11, agent({ lastSeen: 10, lastSeenX: 4, lastSeenZ: -2 }));
assert.ok(Math.abs(fading.fade - 0.5) < 1e-9, 'LOS fade is linear over 2 s');
assert.equal(hudContact(12, agent({ lastSeen: 10 })), null, 'gone after 2 s');

const shot = hudContact(10, agent({ lastFired: 10, fireX: 8.2, fireZ: 3.1 }));
assert.equal(shot.kind, 'fired');
assert.equal(shot.x, 8.2);
assert.equal(shot.z, 3.1);
assert.ok(Math.abs(shot.fade - 1) < 1e-9);

const held = hudContact(12.2, agent({ lastFired: 10, fireX: 1, fireZ: 1 }));
assert.ok(Math.abs(held.fade - 1) < 1e-9, 'solid until the last 0.8 s');
const fireFade = hudContact(12.6, agent({ lastFired: 10, fireX: 1, fireZ: 1 }));
assert.ok(Math.abs(fireFade.fade - 0.5) < 1e-9, 'fire fades across the last 0.8 s');
assert.equal(hudContact(13, agent({ lastFired: 10 })), null, 'gone after 3 s');

const both = hudContact(10, agent({
  lastSeen: 9.5, lastSeenX: 2, lastSeenZ: 3,
  lastFired: 10, fireX: 9, fireZ: 9,
}));
assert.equal(both.kind, 'los');
assert.equal(both.x, 2);
assert.equal(both.z, 3);

const j0 = fireJitter(7, 4.2);
assert.equal(j0.x, fireJitter(7, 4.2).x);
assert.ok(Math.abs(Math.hypot(j0.x, j0.z) - FIRE_JITTER) < 1e-9);
assert.notEqual(fireJitter(7, 4.2).x, fireJitter(8, 4.2).x);

const fireOnly = hudContact(10, agent({ lastFired: 9, fireX: 1.5, fireZ: 2.5 }));
assert.ok(fireOnly.seenAge > RIM_SEEN, 'fire-only contacts do not earn a rim');

console.log('  ok  contact minimap rules');
