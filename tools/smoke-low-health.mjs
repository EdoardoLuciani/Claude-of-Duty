import assert from 'node:assert/strict';
import { Health } from '../src/player/health.js';
import { AudioSystem } from '../src/audio/index.js';

const listeners = new Map();
const ctx = {
  time: { elapsed: 0 },
  camera: { rotation: { y: 0 }, position: { x: 0, y: 0, z: 0 } },
  events: {
    on(type, fn) { listeners.set(type, fn); return () => listeners.delete(type); },
    emit(type, payload) { listeners.get(type)?.(payload); },
  },
};
const hp = new Health(ctx, null);
const audio = new AudioSystem();
const sounds = [];
audio.running = true;
audio._playDry = (kind, opts) => sounds.push({ kind, level: opts.level });
audio._wireEvents(ctx);

function step(seconds) {
  for (let i = 0; i < seconds * 60; i++) {
    ctx.time.elapsed += 1 / 60;
    hp.update(1 / 60);
  }
}

hp.value = 50;
step(2);
assert.equal(sounds.length, 0, '50 HP is still healthy');

hp.value = 49;
hp.lastDamageTime = ctx.time.elapsed;
step(2);
assert.ok(sounds.length > 0, 'a beat is audible below 50 HP');
assert.ok(sounds.every(s => s.kind === 'heartbeat'), 'each beat plays only one heartbeat sound');
assert.ok(hp.pulse > 0 || hp.effect > 0, 'the HUD receives the same player-driven beat');

const before = sounds.length;
hp.heal(51);
step(2);
assert.equal(sounds.length, before, 'bandaging back to full health stops the beat');
assert.ok(hp.effect < 0.004 && hp.pulse === 0, 'the visual pulse also stops');
audio.dispose();
console.log('low-health heartbeat smoke OK');
