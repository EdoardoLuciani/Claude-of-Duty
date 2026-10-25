import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { TentRadio } from '../../src/audio/music.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';

// No standard Web Audio API means optional audio stays disabled, even if an
// obsolete prefixed constructor is present. Never build a second graph.
assert.equal(globalThis.AudioContext, undefined);
assert.equal(globalThis.OfflineAudioContext, undefined);
const warn = console.warn;
let prefixedStarts = 0;
globalThis.webkitAudioContext = globalThis.webkitOfflineAudioContext = class {
  constructor() {
    prefixedStarts++;
    throw Error('obsolete prefixed constructor');
  }
};
try {
  console.warn = () => {};
  const audio = new AudioSystem();
  assert.deepEqual(await Promise.all([audio.start(), audio.start()]), [false, false]);
  assert.equal(audio.failed, true);
  assert.equal(audio.running, false);
  assert.equal(audio.actx, null);
  assert.equal(audio._starting, null);
  assert.equal(await audio.start(), false);
  audio.dispose();
  const radio = new TentRadio({ sampleRate: 48000 }, {}, {});
  assert.equal(await radio.warm(), null);
  await radio.start();
  assert.equal(radio.playing, false);
  radio.dispose();
  assert.equal(prefixedStarts, 0, 'prefixed Web Audio constructors must not be used');
} finally {
  console.warn = warn;
  delete globalThis.webkitAudioContext;
  delete globalThis.webkitOfflineAudioContext;
}
// Isolated dialog key events need not reach window: native activation emits a
// click instead. It must share the same one-shot unlock and in-flight graph guard.
const gestures = new EventTarget();
globalThis.addEventListener = gestures.addEventListener.bind(gestures);
globalThis.removeEventListener = gestures.removeEventListener.bind(gestures);
try {
  const audio = new AudioSystem();
  const events = new EventBus();
  await audio.init({ events, rng: new Rng(520) });
  let finish;
  const loaded = new Promise((resolve) => (finish = resolve));
  let graphs = 0;
  audio._startGraph = async () => {
    graphs++;
    await loaded;
    audio.running = true;
    return true;
  };
  gestures.dispatchEvent(new Event('click'));
  const duplicate = audio.start();
  gestures.dispatchEvent(new Event('pointerdown'));
  assert.equal(graphs, 1, 'click/pointer/API calls cannot build duplicate graphs');
  assert.equal(audio._gestureHandler, null, 'click disarms every unlock listener');
  finish();
  assert.equal(await duplicate, true);
  let hearingResets = 0;
  audio.mixer = { resetHearing: () => hearingResets++ };
  audio.deafness = audio.stats.deafness = 0.8;
  events.emit('ui:pause', { paused: true });
  assert.equal(hearingResets, 0, 'pause must preserve hearing recovery semantics');
  events.emit('game:restart', { source: 'game-over' });
  assert.equal(hearingResets, 1, 'restart explicitly resets hearing without update hooks');
  assert.equal(audio.deafness, 0);
  assert.equal(audio.stats.deafness, 0);
  audio.mixer = null;
  events.emit('game:restart', { source: 'game-over' });
  assert.equal(hearingResets, 1, 'restart before a graph exists is safe');
  audio.dispose();
} finally {
  delete globalThis.addEventListener;
  delete globalThis.removeEventListener;
}
console.log('Audio: optional failure, click unlock, single graph and restart hearing reset passed');
