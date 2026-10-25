import assert from 'node:assert/strict';

import { Box3, Scene, Vector3 } from 'three';

import { AircraftVoice, AIRCRAFT_MIX, AIRCRAFT_URLS } from '../../src/audio/aircraft.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { RadioSystem, CARPET } from '../../src/radio/index.ts';
import { measureLoop } from '../lib/aircraft-loop.mjs';

// Known signals ensure the offline detector rejects a chirp/pump, not merely metadata.
const fixtureRate = 12000;
const chirp = Buffer.alloc(Math.round(0.9 * fixtureRate) * 4);
let phase = 0;
for (let i = 0; i < chirp.length / 4; i++) {
  chirp.writeFloatLE(Math.sin(phase) * 0.1, i * 4);
  phase += (2 * Math.PI * (220 - (40 * i) / (chirp.length / 4))) / fixtureRate;
}
assert(measureLoop(chirp, 200).pitchSpanCents > 200, 'detector rejects repeated pitch sweep');
const pumping = Buffer.alloc(Math.round(3.2 * fixtureRate) * 4);
for (let i = 0; i < pumping.length / 4; i++) {
  const t = i / fixtureRate;
  pumping.writeFloatLE(
    0.1 * (1 + 0.4 * Math.cos((2 * Math.PI * t) / 3.2)) * Math.sin(2 * Math.PI * 200 * t),
    i * 4
  );
}
assert(measureLoop(pumping, 200).rmsSpanDb > 6, 'detector rejects broad envelope pumping');

const parameter = () => ({
  value: 0,
  events: [],
  setValueAtTime(v, t) {
    this.events.push(['set', v, t]);
  },
  linearRampToValueAtTime(v, t) {
    this.events.push(['ramp', v, t]);
  },
  cancelScheduledValues(t) {
    this.events.push(['cancel', t]);
  },
});
const sources = [];
const actx = {
  state: 'running',
  currentTime: 10,
  sampleRate: 48000,
  createGain: () => ({
    gain: parameter(),
    connect() {},
    disconnect() {
      this.disconnected = true;
    },
  }),
  createBufferSource() {
    const source = {
      connect() {},
      disconnect() {
        this.disconnected = true;
      },
      start(t) {
        this.starts = [t];
      },
      stop(t) {
        (this.stops ??= []).push(t);
      },
    };
    sources.push(source);
    return source;
  },
  close() {
    this.state = 'closed';
    return Promise.resolve();
  },
};
const emitters = [],
  acquisitions = [];
const field = {
  deny: false,
  listenerPos: { x: 0, y: 1.6, z: 0 },
  distanceTo(x, y, z) {
    return Math.hypot(x, y - 1.6, z);
  },
  acquire(options) {
    acquisitions.push(options);
    if (this.deny) return null;
    const em = {
      attached: null,
      tracked: options.tracked,
      pos: { x: options.x, y: options.y, z: options.z },
      moveTo(x, y, z, smooth) {
        Object.assign(this.pos, { x, y, z });
        this.smooth = smooth;
      },
      detach() {
        this.detached = true;
        this.attached = null;
        this.tracked = false;
      },
    };
    emitters.push(em);
    return em;
  },
  hold(em, node, end) {
    em.attached = node;
    em.endTime = end;
  },
  dispose() {
    for (const em of emitters) em.detach();
  },
};
const bank = new WeaponSampleBank(actx);
bank.aircraftBuffers = AIRCRAFT_URLS.map((_, index) => ({ index, duration: 3.2 }));
const rng = new Rng(474);
let previous = -1;
for (let i = 0; i < 10; i++) {
  const buffer = bank.nextAircraft(rng);
  assert.notEqual(buffer.index, previous);
  previous = buffer.index;
}
const audio = new AudioSystem();
Object.assign(audio, {
  running: true,
  actx,
  field,
  samples: bank,
  rng,
  mixer: { dispose() {}, setBusVolume() {} },
  ctx: { events: new EventBus(), peek: () => null },
});
assert.equal(audio.startAircraft({ x: NaN, y: 55, z: 0 }), null);
actx.state = 'suspended';
assert.equal(audio.startAircraft({ x: 0, y: 55, z: 0 }), null);
actx.state = 'running';
assert.equal(acquisitions.length, 0);
field.deny = true;
assert.equal(audio.startAircraft({ x: 0, y: 55, z: 0 }), null);
field.deny = false;
assert.equal(sources.length, 0, 'pool denial does not build an orphan source');
const voice = audio.startAircraft({ x: -100, y: 55, z: 0 });
assert(voice instanceof AircraftVoice);
assert.equal(audio._aircraft.size, 1);
assert.equal(voice.source.loop, true);
assert.equal(voice.source.loopEnd, 3.2);
assert.equal(voice.source.starts.length, 1);
assert(voice.startTime > actx.currentTime, 'first arrival retains propagation delay');
assert.equal(acquisitions.at(-1).bus, 'ambience');
assert.equal(acquisitions.at(-1).tracked, true);
assert.equal(acquisitions.at(-1).gain, AIRCRAFT_MIX.gain);
voice.move({ x: 30, y: 55, z: 10 });
assert.deepEqual(voice.emitter.pos, { x: 30, y: 55, z: 10 });
assert.equal(voice.emitter.smooth, AIRCRAFT_MIX.positionSmooth);
const beforePause = voice.node.gain.events.length;
voice.move({ x: 30, y: 55, z: 10 }, true);
assert(voice.paused);
assert.deepEqual(
  voice.node.gain.events.slice(beforePause),
  [
    ['cancel', actx.currentTime],
    ['set', 0, actx.currentTime],
    ['ramp', 0, actx.currentTime + AIRCRAFT_MIX.pauseFade],
  ],
  'pause schedules a new fade to silence'
);
const beforeResume = voice.node.gain.events.length;
voice.setPaused(true);
assert.equal(voice.node.gain.events.length, beforeResume, 'repeated pause does not reschedule');
voice.move({ x: 30, y: 55, z: 10 }, false);
assert(!voice.paused);
assert.deepEqual(
  voice.node.gain.events.slice(beforeResume),
  [
    ['cancel', actx.currentTime],
    ['set', 0, actx.currentTime],
    ['set', 0, voice.startTime],
    ['ramp', 1, voice.startTime + AIRCRAFT_MIX.pauseFade],
  ],
  'early resume schedules a new attack no earlier than source arrival'
);
const afterResume = voice.node.gain.events.length;
voice.setPaused(false);
assert.equal(voice.node.gain.events.length, afterResume, 'repeated resume does not reschedule');
actx.currentTime = voice.startTime + 1;
voice.node.gain.value = 1; // Stub the settled native gain after arrival.
voice.setPaused(true);
assert.deepEqual(voice.node.gain.events.slice(afterResume), [
  ['cancel', actx.currentTime],
  ['set', 1, actx.currentTime],
  ['ramp', 0, actx.currentTime + AIRCRAFT_MIX.pauseFade],
]);
const lateResume = voice.node.gain.events.length;
voice.node.gain.value = 0;
voice.setPaused(false);
assert.deepEqual(
  voice.node.gain.events.slice(lateResume),
  [
    ['cancel', actx.currentTime],
    ['set', 0, actx.currentTime],
    ['ramp', 1, actx.currentTime + AIRCRAFT_MIX.pauseFade],
  ],
  'resume after arrival fades from current time'
);
assert.equal(voice.source.starts.length, 1, 'pause/resume never restarts the source');
voice.stop();
voice.stop();
assert.equal(voice.source.stops.length, 1, 'idempotent fade stop');
assert.equal(voice.emitter.tracked, false);
assert.equal(voice.emitter.endTime, actx.currentTime + AIRCRAFT_MIX.fadeOut + 0.02);
voice.source.onended();
assert(
  voice.ended && voice.source.disconnected && voice.node.disconnected && voice.emitter.detached
);
voice.dispose();
assert.equal(voice.source.stops.length, 1);

const reused = audio.startAircraft({ x: 0, y: 55, z: 0 });
reused.stop();
const replacement = {};
reused.emitter.attached = replacement;
reused.source.onended();
assert.equal(reused.emitter.attached, replacement, 'late end cannot detach reused emitter');
const tail = audio.startAircraft({ x: 0, y: 55, z: 0 });
tail.stop();
tail.dispose();
assert(tail.ended, 'immediate disposal also handles an in-flight fade');
audio._wireEvents(audio.ctx);
const paused = audio.startAircraft({ x: 0, y: 55, z: 0 });
audio.ctx.events.emit('ui:pause', { paused: true });
assert(paused.paused);
paused.move({ x: 0, y: 55, z: 0 }, false);
audio.ctx.events.emit('market:open', {});
assert(paused.paused);
audio.ctx.events.emit('engine:error', {});
assert(paused.ended);
assert.equal(audio._aircraft.size, 0);
const restarted = audio.startAircraft({ x: 0, y: 55, z: 0 });
audio.ctx.events.emit('game:restart', {});
assert(restarted.stopping);
audio.dispose();
assert(restarted.ended);
assert.equal(audio._aircraft.size, 0);

const events = new EventBus(),
  handles = [],
  positions = [],
  calls = [];
const soundtrack = {
  ready: false,
  startAircraft(pos) {
    calls.push({ x: pos.x, y: pos.y, z: pos.z });
    if (!this.ready) return null;
    const handle = {
      ended: false,
      stops: 0,
      move(p, pause) {
        positions.push({ x: p.x, y: p.y, z: p.z, pause });
      },
      stop() {
        this.stops++;
      },
    };
    handles.push(handle);
    return handle;
  },
  play() {
    throw Error('bomber must not use any helicopter one-shot');
  },
};
const world = {
  bounds: new Box3(new Vector3(-45, 0, -45), new Vector3(45, 20, 45)),
  spawn: () => ({ yaw: 0 }),
};
const radio = new RadioSystem();
await radio.init({
  scene: new Scene(),
  events,
  get: () => world,
  peek: (id) => (id === 'audio' ? soundtrack : id === 'physics' ? { groundHeight: () => 0 } : null),
});
assert.equal(radio.callStrike(), true);
assert.equal(radio.callStrike(), false);
const initial = radio.active[0].plane.position.clone();
radio.update(0.1);
assert.equal(handles.length, 0, 'loading audio does not block plane simulation');
soundtrack.ready = true;
radio.update(0.1);
assert.equal(handles.length, 1);
assert.deepEqual(
  calls.at(-1),
  {
    x: radio.active[0].plane.position.x,
    y: radio.active[0].plane.position.y,
    z: radio.active[0].plane.position.z,
  },
  'late attachment starts at current pose, not original spawn'
);
assert.notEqual(positions.at(-1).z, initial.z, 'late start attaches at current pose');
const travel = radio.active[0].travel;
radio.update(0);
assert.equal(radio.active[0].travel, travel);
assert.equal(positions.at(-1).pause, true);
radio.update(0.1);
assert.equal(positions.at(-1).pause, false);
for (let i = 0; i < 200 && radio.active.length; i++) radio.update(0.1);
assert.equal(radio.active.length, 0);
assert.equal(handles.length, 1, 'no mid-flight loop restart');
assert.equal(handles[0].stops, 1, 'natural exit stops engine');
assert.equal(positions.at(-1).y, CARPET.altitude);
radio.callStrike();
events.emit('game:restart', {});
assert.equal(radio.active.length, 0);
assert.equal(handles.at(-1).stops, 1);
radio._physics.groundHeight = () => -1000;
radio.callStrike();
const late = handles.at(-1);
for (let i = 0; i < 160 && !late.stops; i++) radio.update(0.1);
assert.equal(late.stops, 1);
assert.equal(radio.active.length, 1, 'late bombs can outlive the audible pass');
assert(radio.active[0].bombs.length > 0);
const starts = calls.length;
for (let i = 0; i < 10; i++) radio.update(0.1);
assert.equal(calls.length, starts, 'off-map plane must not reacquire a loop');
radio.clearStrike();
radio.callStrike();
radio.dispose();
assert.equal(handles.at(-1).stops, 1);

console.log(
  'Required propeller loops, tracked source motion/fades/pause/disposal and bomber ownership/lifecycle'
);
