import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { TentRadio, type TentRadioMixer } from '../../src/audio/music.ts';
import { Rng } from '../../src/core/rng.ts';
import { FixtureAudioBuffer, FixtureAudioNode, createAudioContext } from '../lib/audio-fixture.ts';

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
  const mixer: TentRadioMixer = {
    bus(): never {
      throw Error('unavailable radio must not access the mixer');
    },
  };
  const radio = new TentRadio(createAudioContext(), mixer, new Rng(1));
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
// Shop close/disposal can precede the first offline render's completion.
try {
  for (const action of ['stop', 'dispose'] as const) {
    const rendered = Promise.withResolvers<AudioBuffer>();
    const offline = createAudioContext();
    offline.createBuffer = (): AudioBuffer => new FixtureAudioBuffer();
    offline.createWaveShaper = (): WaveShaperNode =>
      Object.assign(new FixtureAudioNode(offline), { curve: null, oversample: 'none' as const });
    Object.defineProperty(globalThis, 'OfflineAudioContext', {
      configurable: true,
      value: class {
        constructor() {
          return Object.assign(offline, {
            startRendering: (): Promise<AudioBuffer> => rendered.promise,
          });
        }
      },
    });
    const actx = createAudioContext();
    const radio = new TentRadio(actx, { bus: (): AudioNode => actx.createGain() }, new Rng(1));
    const starting = radio.start();
    radio[action]();
    rendered.resolve(new FixtureAudioBuffer());
    await starting;
    assert.equal(actx.sources.length, 0, action + ' cancels the pending loop');
    assert.equal(radio.playing, false);
    if (action === 'stop') {
      await radio.start();
      assert.equal(actx.sources.length, 1, 'ordinary stop allows a later start');
      assert.equal(radio.playing, true);
      radio.dispose();
    }
  }
} finally {
  deleteProperty('OfflineAudioContext');
}
console.log('Audio API fallback and deferred shop-radio cancellation/restart passed');

function deleteProperty(name: string): void {
  Reflect.deleteProperty(globalThis, name);
}
