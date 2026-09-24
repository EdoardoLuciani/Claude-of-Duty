import assert from 'node:assert/strict';
import { Health } from '../src/player/health.js';
import { AudioSystem } from '../src/audio/index.js';

const listeners = new Map();
let beats = 0;
const ctx = {
  time: { elapsed: 0 },
  camera: { rotation: { y: 0 }, position: { x: 0, y: 0, z: 0 } },
  events: {
    on(type, fn) { listeners.set(type, fn); return () => listeners.delete(type); },
    emit(type, payload) {
      if (type === 'player:heartbeat') beats++;
      listeners.get(type)?.(payload);
    },
  },
};
const hp = new Health(ctx, null);
const audio = new AudioSystem();
const sounds = [];
audio.running = true;
audio._playDry = (kind, opts, bus, send) => sounds.push({ kind, level: opts.level, bus, send });
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
assert.equal(sounds.length, beats, 'each player beat plays exactly one heartbeat sound');
assert.ok(sounds.every(s => s.kind === 'heartbeat' && s.bus === 'ui' && s.send === 0),
  'heartbeat bypasses world ducking and reverb');

hp.value = 40;
hp.lastDamageTime = ctx.time.elapsed;
step(2);
assert.ok(hp.effect > 0.3, 'the 40 HP treatment is unmistakable even two seconds after a hit');
assert.ok(sounds.at(-1).level > 0.6, 'the 40 HP heartbeat is not attenuated to silence');
step(5);
assert.ok(hp.effect > 0.25, 'injury still reads after the fresh wound settles');

const before = sounds.length;
hp.heal(60);
step(2);
assert.equal(sounds.length, before, 'bandaging back to full health stops the beat');
assert.ok(hp.effect < 0.004 && hp.pulse === 0, 'the visual pulse also stops');
audio.dispose();
console.log('low-health heartbeat smoke OK');
