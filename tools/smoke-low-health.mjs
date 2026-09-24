import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Health } from '../src/player/health.js';
import { AudioSystem } from '../src/audio/index.js';
import { damp } from '../src/ui/util.js';

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

// The visual lobes must stay aligned with the two recorded thumps at any BPM.
const wav = readFileSync(new URL('../src/audio/samples/heartbeat.wav', import.meta.url));
const rate = wav.readUInt32LE(24);
assert.equal(rate, 48000);
function peakIn(samples, start, end, hz) {
  let best = -1, time = 0;
  for (let i = Math.round(start * hz); i < Math.round(end * hz); i++) {
    if (samples[i] > best) { best = samples[i]; time = i / hz; }
  }
  return time;
}
const window = rate / 100;
const energy = [];
for (let i = 44; i + window * 2 <= wav.length; i += window * 2) {
  let sum = 0;
  for (let j = i; j < i + window * 2; j += 2) {
    const s = wav.readInt16LE(j) / 32768;
    sum += s * s;
  }
  energy.push(sum);
}
const audioPeaks = [peakIn(energy, 0.02, 0.2, 100), peakIn(energy, 0.2, 0.45, 100)];

function visualPeaks(health) {
  hp.reset(true);
  hp.value = health;
  hp.lastDamageTime = ctx.time.elapsed;
  const startBeats = beats;
  const pulses = [];
  let shown = 0;
  for (let i = 0; i < 480 && pulses.length < 106; i++) {
    ctx.time.elapsed += 1 / 240;
    hp.update(1 / 240);
    if (beats === startBeats) {
      assert.ok(hp.pulse < 0.004, 'visual pulse waits for the recorded beat');
      continue;
    }
    shown = damp(shown, Math.min(1, hp.pulse), 18, 1 / 240);
    pulses.push(shown);
  }
  assert.equal(pulses.length, 106, 'captured both visual lobes before the next beat');
  return [peakIn(pulses, 0.03, 0.18, 240), peakIn(pulses, 0.21, 0.44, 240)];
}
for (const health of [40, 1]) {
  const visual = visualPeaks(health);
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs(visual[i] - audioPeaks[i]) < 0.05,
      `${health} HP lobe ${i + 1} at ${visual[i]}s must follow recording at ${audioPeaks[i]}s`);
  }
}
audio.dispose();
console.log('low-health heartbeat smoke OK');
