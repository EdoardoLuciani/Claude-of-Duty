import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { TentRadio, type TentRadioMixer } from '../../src/audio/music.ts';
import { Rng } from '../../src/core/rng.ts';
import {
  FixtureAudioBuffer,
  FixtureAudioNode,
  FixtureAudioParam,
  createAudioContext,
} from '../lib/audio-fixture.ts';
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
  await audio.dispose();
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
// Exercise real graph construction with deferred native boundaries, not a replacement start().
const fetch = globalThis.fetch;
const info = console.info;
const descriptors = new Map(
  ['AudioContext', 'AudioWorkletNode', 'OfflineAudioContext'].map(
    (name): [string, PropertyDescriptor | undefined] => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]
  )
);
try {
  console.info = (): void => {};
  globalThis.fetch = Object.assign(
    async (): Promise<Response> => new Response(new ArrayBuffer(1)),
    { preconnect: fetch.preconnect }
  );
  Object.defineProperty(globalThis, 'AudioWorkletNode', {
    configurable: true,
    value: class extends FixtureAudioNode {
      onprocessorerror = null;
      port = { postMessage(): void {}, close(): void {} };
    },
  });
  for (const boundary of ['worklet', 'decode', 'resume', 'online']) {
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const actx = createAudioContext();
    let contexts = 0;
    let closes = 0;
    const pause = async (stage: string): Promise<void> => {
      if (boundary !== stage) return;
      entered.resolve();
      await released.promise;
    };
    actx.state = 'suspended';
    Object.defineProperty(actx, 'audioWorklet', {
      value: fixture<AudioWorklet>({ addModule: (): Promise<void> => pause('worklet') }),
    });
    actx.createBuffer = (): AudioBuffer => new FixtureAudioBuffer();
    actx.decodeAudioData = async (): Promise<AudioBuffer> => {
      await pause('decode');
      return new FixtureAudioBuffer();
    };
    actx.createConvolver = (): ConvolverNode =>
      Object.assign(new FixtureAudioNode(actx), { buffer: null, normalize: false });
    actx.createPanner = (): PannerNode =>
      fixture<PannerNode>(
        Object.assign(new FixtureAudioNode(actx), {
          positionX: new FixtureAudioParam(),
          positionY: new FixtureAudioParam(),
          positionZ: new FixtureAudioParam(),
        })
      );
    actx.resume = async (): Promise<void> => {
      await pause('resume');
      if (actx.state !== 'closed') actx.state = 'running';
    };
    actx.close = (): Promise<void> => {
      closes++;
      actx.state = 'closed';
      return closed.promise;
    };
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: class {
        constructor() {
          contexts++;
          return actx;
        }
      },
    });
    const audio = new AudioSystem();
    audio.rng = new Rng(1);
    audio.ctx = fixture<typeof audio.ctx>({});
    const starts = Promise.all([audio.start(), audio.start()]);
    if (boundary !== 'online') await entered.promise;
    else assert.deepEqual(await starts, [true, true]);
    let disposed = false;
    const disposal = audio.dispose().then((): void => {
      disposed = true;
    });
    assert.equal(await audio.start(), false, 'disposed owner cannot start again');
    await Promise.resolve();
    assert.equal(disposed, false, 'dispose waits for context closure');
    closed.resolve();
    await new Promise<void>((resolve): void => {
      setImmediate(resolve);
    });
    if (boundary !== 'online') {
      assert.equal(disposed, false, 'dispose waits for pending startup');
      released.resolve();
      assert.deepEqual(await starts, [false, false], boundary);
    }
    await disposal;
    assert.equal(contexts, 1, 'concurrent starts share a single graph');
    assert.equal(closes, 1, 'one owner closes its context exactly once');
    assert.equal(audio.running, false);
    assert.equal(audio.stats.started, false);
    assert.equal(audio.actx, null);
    assert.equal(audio.samples, null);
    assert.equal(audio.mixer, null);
    assert.equal(audio.field, null);
    assert.equal(audio.tentRadio, null);
    assert.equal(audio._starting, null);
    await audio.dispose();
  }

  // A delayed offline render must obey the latest shop request and permanent disposal.
  for (const action of ['stop', 'dispose', 'restart', 'concurrent']) {
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
    const first = radio.start();
    if (action === 'dispose') radio.dispose();
    else if (action !== 'concurrent') radio.stop();
    const second =
      action === 'restart' || action === 'concurrent' ? radio.start() : Promise.resolve();
    rendered.resolve(new FixtureAudioBuffer());
    await Promise.all([first, second]);
    const playing = action === 'restart' || action === 'concurrent';
    assert.equal(actx.sources.length, playing ? 1 : 0, action + ' creates only current loop');
    assert.equal(radio.playing, playing);
    if (action === 'dispose') {
      assert.equal(radio._buf, null, 'disposed warmup never publishes its completed buffer');
      assert.equal(await radio.warm(), null);
    }
    if (action === 'stop') {
      await radio.start();
      assert.equal(actx.sources.length, 1, 'ordinary stop allows a later start');
    }
    radio.dispose();
    assert.equal(radio._buf, null);
    assert.equal(await radio.warm(), null);
    await radio.start();
    assert.equal(radio.playing, false);
    assert.equal(radio._buf, null, 'late warm completion cannot republish a buffer');
  }
} finally {
  globalThis.fetch = fetch;
  console.info = info;
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else deleteProperty(name);
  }
}
console.log(
  'Audio startup drains native work across disposal; radio warmup obeys current playback lifetime'
);

function deleteProperty(name: string): void {
  Reflect.deleteProperty(globalThis, name);
}
