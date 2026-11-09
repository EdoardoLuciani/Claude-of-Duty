import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import type { Mixer } from '../../src/audio/mixer.ts';
import { TentRadio } from '../../src/audio/music.ts';
import { Rng } from '../../src/core/rng.ts';
import { createAudioContext } from '../lib/audio-fixture.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';

// No standard Web Audio API means optional audio stays disabled, even if an
// obsolete prefixed constructor is present. Never build a second graph.
assert.equal(globalThis.AudioContext, undefined);
assert.equal(globalThis.OfflineAudioContext, undefined);
const warn = console.warn;
let prefixedStarts = 0;
const obsoleteContext = class {
  constructor() {
    prefixedStarts++;
    throw Error('obsolete prefixed constructor');
  }
};
for (const name of ['webkitAudioContext', 'webkitOfflineAudioContext'])
  Object.defineProperty(globalThis, name, { configurable: true, value: obsoleteContext });
try {
  console.warn = (): void => {};
  const audio = new AudioSystem();
  assert.deepEqual(await Promise.all([audio.start(), audio.start()]), [false, false]);
  assert.equal(audio.failed, true);
  assert.equal(audio.running, false);
  assert.equal(audio.actx, null);
  assert.equal(audio._starting, null);
  assert.equal(await audio.start(), false);
  audio.dispose();
  const radio = new TentRadio(
    createAudioContext(),
    fixture<Mixer>({}, complete.testMixer()),
    new Rng(1)
  );
  assert.equal(await radio.warm(), null);
  await radio.start();
  assert.equal(radio.playing, false);
  radio.dispose();
  assert.equal(prefixedStarts, 0, 'prefixed Web Audio constructors must not be used');
} finally {
  console.warn = warn;
  for (const name of ['webkitAudioContext', 'webkitOfflineAudioContext']) {
    // The prefixed constructors never belong to the standard DOM global type.
    deleteProperty(name);
  }
}
console.log('Missing standard Web Audio APIs disable optional audio/radio safely');

function deleteProperty(name: string): void {
  Reflect.deleteProperty(globalThis, name);
}
