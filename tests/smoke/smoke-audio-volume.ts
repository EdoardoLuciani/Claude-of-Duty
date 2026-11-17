import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { defaultVolumes, loadVolumes, volumeGain } from '../../src/audio/settings.ts';
import { createAudioContext, FixtureGainNode, fixtureMixer } from '../lib/audio-fixture.ts';
import { deleteGlobal } from '../lib/ui-fixture.ts';

const KEY = 'ow:audio-volume:v1';
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const saved = new Map<string, string>();
function useStorage(storage: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get(): Pick<Storage, 'getItem' | 'setItem'> {
      if (!storage) throw new Error('blocked storage');
      return storage;
    },
  });
}
const memory = {
  getItem: (key: string): string | null => saved.get(key) ?? null,
  setItem: (key: string, value: string): void => void saved.set(key, value),
};
function events(node: AudioNode): Array<Array<string | number>> {
  assert(node instanceof FixtureGainNode);
  return node.gain.events;
}
function lastTarget(node: AudioNode): number | string | undefined {
  return events(node)
    .filter((event): boolean => event[0] === 'target')
    .at(-1)?.[1];
}

try {
  // Stale, malformed or blocked storage restores defaults per entry, never throws.
  useStorage(memory);
  for (const raw of ['not json', 'null', '[]', '"loud"', '42']) {
    saved.set(KEY, raw);
    assert.deepEqual(loadVolumes(), defaultVolumes(), raw);
  }
  saved.set(
    KEY,
    JSON.stringify({ master: 140, weapons: -5, foley: 33.6, voice: '50', ui: null, old: 9 })
  );
  assert.deepEqual(loadVolumes(), { ...defaultVolumes(), master: 100, weapons: 0, foley: 34 });
  useStorage(null);
  assert.deepEqual(loadVolumes(), defaultVolumes());

  assert.equal(volumeGain(100), 1, 'the default is the authored mix');
  assert.equal(volumeGain(0), 0, 'zero is a mute');
  assert(Math.abs(20 * Math.log10(volumeGain(50)) + 10) < 1e-9, 'half is -10 dB');

  // Settings persist, apply immediately and are restored by the next boot's graph.
  useStorage(memory);
  saved.clear();
  const actx = createAudioContext(5);
  const audio = new AudioSystem();
  audio.mixer = fixtureMixer(actx);
  audio.setVolume('foley', 40);
  audio.setVolume('master', 0);
  assert.equal(lastTarget(audio.mixer.buses.foley.level), 0.6 * volumeGain(40));
  assert.equal(lastTarget(audio.mixer.masterGain), 0);
  assert.deepEqual(loadVolumes(), { ...defaultVolumes(), foley: 40, master: 0 });
  audio.resetVolumes();
  assert.deepEqual(loadVolumes(), defaultVolumes());
  assert.equal(lastTarget(audio.mixer.buses.foley.level), 0.6);
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else deleteGlobal('localStorage');
}

// Categories are independent: dry and wet follow the player, the shop dip and
// ducking compose with it, and a muted source neither leaks nor pumps others.
const actx = createAudioContext(5);
const mixer = fixtureMixer(actx, undefined, { busVolumes: { ambience: 0.5, explosions: 0 } });
const ambience = mixer.buses.ambience;
assert.equal(ambience.level.gain.value, ambience.baseTrim * 0.5, 'restored before play');
assert.equal(mixer.buses.explosions.send.gain.value, 0, 'reverb send is muted too');
assert.equal(mixer.tinnitusOut.gain.value, 0, 'ear ringing follows Explosions');

mixer.setShopMix(true);
assert.equal(lastTarget(ambience.level), ambience.baseTrim * 0.5 * ambience.shopTrim);
mixer.setShopMix(false);
assert.equal(lastTarget(ambience.send), ambience.baseTrim * 0.5, 'shop restores user volume');

mixer.duck(0.85, 0.35, 'explosions');
assert.equal(ambience.duckAmount, 0, 'a muted category does not duck others');
mixer.duck(0.5, 0.1, 'weapons');
assert.equal(ambience.duckAmount, 0.5);
const weaponEvents = events(mixer.buses.weapons.level).length;
mixer.setBusVolume('voice', 0.2);
assert.equal(events(mixer.buses.weapons.level).length, weaponEvents, 'other buses untouched');
mixer.dispose();
console.log('Audio volumes: validated persistence, loudness curve, independent live categories');
