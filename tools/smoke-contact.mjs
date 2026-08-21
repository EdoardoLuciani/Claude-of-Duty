/**
 * Node smoke test for contact-minimap rules — no browser.
 *
 *   node tools/smoke-contact.mjs
 */
import assert from 'node:assert/strict';
import {
  LOS_GRACE, FIRE_TTL, FIRE_RANGE, FIRE_JITTER, FIRE_FADE, RIM_SEEN,
  hudContact, fireJitter, collectHudActors,
} from '../src/ai/contact.js';

assert.equal(LOS_GRACE, 2);
assert.equal(FIRE_TTL, 3);
assert.equal(FIRE_RANGE, 45);
assert.equal(FIRE_JITTER, 1.5);
assert.equal(FIRE_FADE, 0.8);
assert.equal(RIM_SEEN, 2.5);

function agent(partial = {}) {
  return {
    alive: true,
    staged: false,
    silentDeath: false,
    team: 1,
    lastSeen: -Infinity,
    lastFired: -Infinity,
    lastSeenX: 0,
    lastSeenZ: 10,
    fireX: 1,
    fireZ: 11,
    ...partial,
  };
}

// ---- hidden unless LOS or a close shot -----------------------------------
assert.equal(hudContact(10, agent()), null, 'never seen / never fired stays hidden');
assert.equal(hudContact(10, agent({ lastSeen: 7.9 })), null, 'LOS grace is 2 s');
assert.equal(hudContact(10, agent({ lastFired: 6.9 })), null, 'fire window is 3 s');

// ---- LOS: exact while visible, fade over 2 s -----------------------------
const live = hudContact(10, agent({ lastSeen: 10, lastSeenX: 4, lastSeenZ: -2 }));
assert.ok(live);
assert.equal(live.kind, 'los');
assert.equal(live.x, 4);
assert.equal(live.z, -2);
assert.ok(Math.abs(live.fade - 1) < 1e-9, 'exact while visible');
assert.equal(live.lastSeen, 10);
assert.ok(live.seenAge < RIM_SEEN);

const fading = hudContact(11, agent({ lastSeen: 10, lastSeenX: 4, lastSeenZ: -2 }));
assert.ok(fading);
assert.equal(fading.kind, 'los');
assert.ok(Math.abs(fading.fade - 0.5) < 1e-9, 'LOS fade is linear over 2 s');

assert.equal(hudContact(12, agent({ lastSeen: 10 })), null, 'gone after 2 s');

// ---- Fired: 3 s, jittered coords, fade last 0.8 s ------------------------
const shot = hudContact(10, agent({ lastFired: 10, fireX: 8.2, fireZ: 3.1 }));
assert.ok(shot);
assert.equal(shot.kind, 'fired');
assert.equal(shot.x, 8.2);
assert.equal(shot.z, 3.1);
assert.ok(Math.abs(shot.fade - 1) < 1e-9);
assert.equal(shot.lastFired, 10);

const held = hudContact(12.2, agent({ lastFired: 10, fireX: 1, fireZ: 1 }));
assert.ok(held);
assert.ok(Math.abs(held.fade - 1) < 1e-9, 'solid until the last 0.8 s');

const fireFade = hudContact(12.6, agent({ lastFired: 10, fireX: 1, fireZ: 1 }));
assert.ok(fireFade);
assert.ok(Math.abs(fireFade.fade - 0.5) < 1e-9, 'fire fades across the last 0.8 s');

assert.equal(hudContact(13, agent({ lastFired: 10 })), null, 'gone after 3 s');

// LOS wins the marker even if a shot is also live
const both = hudContact(10, agent({
  lastSeen: 9.5, lastSeenX: 2, lastSeenZ: 3,
  lastFired: 10, fireX: 9, fireZ: 9,
}));
assert.equal(both.kind, 'los');
assert.equal(both.x, 2);
assert.equal(both.z, 3);

// ---- jitter is stable and 1.5 m ------------------------------------------
const j0 = fireJitter(7, 4.2);
const j1 = fireJitter(7, 4.2);
assert.equal(j0.x, j1.x);
assert.equal(j0.z, j1.z);
assert.ok(Math.abs(Math.hypot(j0.x, j0.z) - FIRE_JITTER) < 1e-9);
assert.notEqual(fireJitter(7, 4.2).x, fireJitter(8, 4.2).x);

// ---- collectHudActors filters + stamps hud* ------------------------------
const out = [];
const hidden = agent({ lastSeen: 0, lastFired: 0 });
const seen = agent({ lastSeen: 10, lastSeenX: 5, lastSeenZ: -1 });
const staged = agent({ lastSeen: 10, staged: true });
const dead = agent({ lastSeen: 10, alive: false });
const friendly = agent({ lastSeen: 10, team: 0 });
collectHudActors([hidden, seen, staged, dead, friendly], 10, out);
assert.equal(out.length, 1);
assert.equal(out[0], seen);
assert.equal(seen.hudX, 5);
assert.equal(seen.hudZ, -1);
assert.equal(seen.hudKind, 'los');
assert.ok(seen.hudFade > 0.99);
assert.ok(seen.hudSeenAge < RIM_SEEN);

const firedOnly = agent({ lastFired: 9, fireX: 1.5, fireZ: 2.5 });
collectHudActors([firedOnly], 10, out);
assert.equal(out.length, 1);
assert.equal(out[0].hudKind, 'fired');
assert.equal(out[0].lastFired, 9);
assert.ok(out[0].hudSeenAge > RIM_SEEN, 'fire-only contacts do not earn a rim');

console.log('  ok  contact minimap rules');
