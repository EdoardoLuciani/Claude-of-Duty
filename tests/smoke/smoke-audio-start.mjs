import assert from 'node:assert/strict';
import { AudioSystem } from '../../src/audio/index.ts';
import { TentRadio } from '../../src/audio/music.ts';

// No standard Web Audio API means optional audio stays disabled, even if an
// obsolete prefixed constructor is present. Never build a second graph.
assert.equal(globalThis.AudioContext, undefined);
assert.equal(globalThis.OfflineAudioContext, undefined);
const warn = console.warn;
let prefixedStarts = 0;
globalThis.webkitAudioContext = globalThis.webkitOfflineAudioContext = class {
  constructor() { prefixedStarts++; throw Error('obsolete prefixed constructor'); }
};
try {
  console.warn = () => {};
  const audio = new AudioSystem();
  assert.deepEqual(await Promise.all([audio.start(), audio.start()]), [false, false]);
  assert.equal(audio.failed, true); assert.equal(audio.running, false);
  assert.equal(audio.actx, null); assert.equal(audio._starting, null);
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
console.log('Missing standard Web Audio APIs disable optional audio/radio safely');
