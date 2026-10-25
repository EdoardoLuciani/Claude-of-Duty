import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { Mixer } from '../../src/audio/mixer.ts';
import { SpatialField } from '../../src/audio/spatial.ts';
import { Rng } from '../../src/core/rng.ts';

const nodes = [];
function param(value = 0) {
  return {
    value,
    setTargetAtTime(v) {
      this.value = v;
    },
    setValueAtTime(v) {
      this.value = v;
    },
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
    linearRampToValueAtTime(v) {
      this.value = v;
    },
  };
}
function node(type) {
  const n = {
    type,
    gain: param(),
    frequency: param(),
    Q: param(),
    threshold: param(),
    knee: param(),
    ratio: param(),
    attack: param(),
    release: param(),
    positionX: param(),
    positionY: param(),
    positionZ: param(),
    outputs: new Set(),
    connect(target) {
      this.outputs.add(target);
      return target;
    },
    disconnect() {
      this.outputs.clear();
    },
  };
  nodes.push(n);
  return n;
}
const actx = {
  state: 'running',
  sampleRate: 48000,
  currentTime: 3,
  destination: node('destination'),
  createGain: () => node('gain'),
  createBiquadFilter: () => node('filter'),
  createDynamicsCompressor: () => node('compressor'),
  createWaveShaper: () => node('shaper'),
  createPanner: () => node('panner'),
};
globalThis.AudioWorkletNode = class {
  constructor(context, name, options) {
    assert.equal(context, actx);
    assert.equal(name, 'cod-energy-mix');
    assert.equal(options.numberOfOutputs, 1);
    assert.deepEqual(options.outputChannelCount, [2]);
    return Object.assign(node('energy'), { port: { postMessage() {}, close() {} } });
  }
};
const mixer = new Mixer(actx, new Rng(1907));
assert.equal(nodes.length - 1, 28, '22 existing nodes plus six category-controlled wet inputs');
assert.equal(mixer.buses.weapons.comp, null, 'no weapon-bus compressor');
assert.equal(
  nodes.filter((n) => n.type === 'compressor').length,
  3,
  'other categories retain dynamics'
);
assert.equal('masterComp' in mixer, false, 'no reintroduced master compressor');
for (const [from, to] of [
  [mixer.masterSum, mixer.energyMix],
  [mixer.energyMix, mixer.masterGain],
  [mixer.masterGain, actx.destination],
])
  assert.deepEqual([...from.outputs], [to]);
assert.equal('preGain' in mixer, false, 'energy controller replaces fixed attenuation');
assert.equal(mixer.masterGain.gain.value, 1);
assert.equal('softClip' in mixer || 'sampleCeiling' in mixer, false, 'no hidden clipping stages');
for (const bus of Object.values(mixer.buses)) {
  assert.equal('trim' in bus || 'duck' in bus, false, 'no serial category gain stack');
  assert.equal(bus.level.gain.value, bus.baseTrim);
  assert.equal(bus.send.gain.value, bus.baseTrim, 'wet shares the same logical reference');
  assert.deepEqual([...bus.send.outputs], [mixer.reverbSend], 'convolution remains shared');
  assert.equal(bus.input, bus.comp ?? bus.level);
  if (bus.comp)
    assert.deepEqual(
      [...bus.comp.outputs],
      [bus.level],
      'category level follows retained compressor'
    );
}
assert.equal(mixer.bus('weapons').gain.value, 1, 'single weapon level defaults to unity');
assert(mixer.buses.ui.input.outputs.has(mixer.masterSum), 'UI bypasses concussion');
assert(mixer.buses.music.input.outputs.has(mixer.masterSum), 'music bypasses concussion');
assert(mixer.buses.weapons.input.outputs.has(mixer.worldSum));

assert.equal(mixer.muffleLP.frequency.value, 20000, 'muted concussion branch keeps its tuning');
assert.equal(mixer.muffleDry.gain.value, 1);
assert.equal(mixer.muffleWet.gain.value, 0);
assert(mixer.worldSum.outputs.has(mixer.muffleDry));
assert(mixer.muffleDry.outputs.has(mixer.muffleGain));
assert(mixer.muffleHS.outputs.has(mixer.muffleWet));
assert(mixer.muffleWet.outputs.has(mixer.muffleGain));
assert.equal(mixer.muffleHS.gain.value, 0);
assert.equal(mixer.muffleGain.gain.value, 1);
// Native tests separately verify waveform identity and time-varying output.
const tinnitus = mixer._startTinnitus;
mixer._startTinnitus = () => {};
mixer.concuss(1, 0, 0.02);
assert.equal(mixer.muffleLP.frequency.value, 1500);
assert.equal(mixer.muffleHS.gain.value, -8);
assert.equal(mixer.muffleGain.gain.value, 0.7);
for (let i = 0; i < 500; i++) {
  actx.currentTime += 0.02;
  mixer.update(0.02);
}
assert.equal(mixer.deafness, 0);
assert.equal(mixer.muffleDry.gain.value, 1);
assert.equal(mixer.muffleWet.gain.value, 0);
assert.equal(mixer.muffleLP.frequency.value, 20000);
assert.equal(mixer.muffleHS.gain.value, 0);
assert.equal(mixer.muffleGain.gain.value, 1);
mixer._startTinnitus = tinnitus;

// User volume and sidechain share a gain but retain independent state. In
// particular, a recovering duck must never turn a muted category back on.
mixer.setBusVolume('ambience', 0.5);
mixer.duck(0.6, 0.1);
const ambience = mixer.buses.ambience;
assert(Math.abs(ambience.level.gain.value - 0.06 * 0.5 * 0.4) < 1e-12);
mixer.setBusVolume('ambience', 0);
for (let i = 0; i < 100; i++) mixer.update(0.02);
assert.equal(ambience.level.gain.value, 0, 'mute survives duck recovery');
assert.equal(ambience.send.gain.value, 0, 'new wet feeds cannot bypass mute/duck recovery');
mixer.setBusVolume('ambience', 1);
assert.equal(ambience.level.gain.value, 0.06);
assert.equal(ambience.send.gain.value, 0.06);
mixer.setBusVolume('weapons', 0);
mixer.duck(0.8);
assert.equal(mixer.bus('weapons').gain.value, 0);
mixer.setBusVolume('weapons', 1);
assert.equal(mixer.bus('weapons').gain.value, 1);
mixer.setMasterVolume(0);
assert.equal(mixer.masterGain.gain.value, 0);
mixer.setMasterVolume(1);
assert.equal(mixer.masterGain.gain.value, 1);

// A unity routing gain can disappear only if the original voice output becomes
// the bookkeeping handle: retiring/stealing that slot must still cut its sound.
const audio = new AudioSystem();
Object.assign(audio, { running: true, actx, mixer });
audio._dry = [{ node: null, send: null, end: 0 }];
let voice = { node: node('voice'), end: 8, send: 0 };
audio._build = () => voice;
let count = nodes.length;
assert(audio._playDry('shot', { gain: 1 }, 'weapons', 0));
assert.equal(nodes.length, count, 'no extra unity gain/send for dry authored shot');
assert.equal(audio._dry[0].node, voice.node);
assert(voice.node.outputs.has(mixer.bus('weapons')));
const old = voice.node;
voice = { node: node('voice'), end: 9, send: 0 };
assert(audio._playDry('shot', { gain: 1 }, 'weapons', 0));
assert.equal(old.outputs.size, 0, 'steal disconnects the reused output, no orphaned sound');
assert.equal(audio._dry[0].node, voice.node);
voice = { node: node('voice'), end: 10, send: 0.2 };
count = nodes.length;
assert(audio._playDry('cloth', { gain: 0.5 }, 'foley', 0.3));
assert.equal(nodes.length, count + 2, 'non-unity routing and nonzero send still supported');
assert.equal(audio._dry[0].node.gain.value, 0.5);
assert.equal(audio._dry[0].send.gain.value, 0.06);
assert(voice.node.outputs.has(audio._dry[0].node));
assert(
  audio._dry[0].send.outputs.has(mixer.sendBus('foley')),
  'dry-voice wet feed honors its category'
);
// Dry positional reports must not connect an environmental branch, including
// when a previously wet emitter is returned to the pool and reused.
const field = new SpatialField(actx, mixer, null);
const opts = { x: 20, y: 0, z: 0, when: 3, dist: 20, bus: 'weapons', endTime: 6 };
const emitter = field.acquire({ ...opts, send: 0.2 });
assert.equal(emitter._sendConnected, mixer.sendBus('weapons'));
emitter.detach();
assert.equal(field.acquire({ ...opts, send: 0 }), emitter);
assert.equal(emitter._sendConnected, false, 'reused dry emitter has no reverb connection');
field.dispose();

// Shared output safety must not hide a huge explosion-specific pre-gain.
let blast;
Object.assign(audio, {
  field: { distanceTo: () => 3 },
  mixer: { duck() {}, concuss() {} },
  _playAt(kind, x, y, z, options) {
    blast = { kind, options };
  },
});
audio._onExplosion({ position: { x: 3, y: 0, z: 0 }, radius: 6 });
assert.equal(blast.kind, 'explosion');
assert.equal(blast.options.gain, 0.8, 'balanced blast, no 6.5x boost into the safety stage');
assert.equal(blast.options.send, 0.62, 'other sounds retain their environmental response');
mixer.dispose();
assert.equal(mixer.masterGain.outputs.size, 0);
assert.equal(mixer.muffleDry.outputs.size, 0);
assert.equal(mixer.muffleWet.outputs.size, 0);
assert.equal(mixer.energyMix.outputs.size, 0);
delete globalThis.AudioWorkletNode;
console.log(
  'Simple audio pipeline: one category gain, dry authored voices, shared peak safety and safe teardown'
);
