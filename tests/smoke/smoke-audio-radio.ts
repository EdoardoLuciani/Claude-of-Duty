import assert from 'node:assert/strict';

import { Vector3 } from 'three';

import type { NoiseBank } from '../../src/audio/dsp.ts';
import { uiSound } from '../../src/audio/foley.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { RADIO_URLS, radioCue } from '../../src/audio/radio.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import type { AudioVoice } from '../../src/audio/types.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { RadioSystem } from '../../src/radio/index.ts';
import type { UiSystem } from '../../src/ui/index.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { audioFixture } from '../lib/audio-banks.ts';
import { fixtureEntries, fixtureBuffer, FixtureAudioBuffer } from '../lib/audio-fixture.ts';
import { fixture } from '../lib/fixture.ts';
const { actx, sources } = audioFixture();
const oscillators = actx.oscillators;
const bank = new WeaponSampleBank(actx),
  rng = new Rng(474),
  noNoise = fixture<NoiseBank>({
    source(): never {
      throw Error('replaced procedural radio noise');
    },
  });
for (const [key, urls] of fixtureEntries(RADIO_URLS))
  bank.hitBuffers[key] = urls.map(
    (_, index): FixtureAudioBuffer => new FixtureAudioBuffer({ key, index, duration: 0.3 })
  );
for (const kind of ['radio_open', 'radio_strike', 'intel_call'] as const) {
  const before = sources.length;
  const recorded = bank.radio(kind, rng, { when: 2 });
  const used = sources.slice(before);
  assert.equal(used.length, kind === 'intel_call' ? 1 : 2);
  assert.deepEqual(
    used.map((source): string => fixtureBuffer(source.buffer).key),
    kind === 'intel_call' ? ['radio-static'] : ['radio-click', 'radio-static']
  );
  for (const source of used) {
    assert.equal(source.playbackRate.value, 1);
    assert(source.when >= 2 && source.when <= 2.02);
  }
  const result = radioCue(actx, noNoise, rng, kind, recorded, 2);
  assert.equal(result.end, 2.9);
  assert.equal(result.send, 0);
}
for (const [kind, freqs, times] of [
  ['radio_open', [880], [2.11]],
  ['radio_strike', [660, 891], [2.16, 2.29]],
  ['intel_call', [720, 921.6, 1179.648], [2.08, 2.24, 2.4]],
] as const) {
  oscillators.length = 0;
  uiSound(actx, noNoise, rng, kind, { when: 2 });
  assert.equal(oscillators.length, freqs.length);
  oscillators.forEach((o, i): void => {
    assert(Math.abs(o.frequency.value - freqs[i]) < 1e-8);
    assert(Math.abs(o.when - times[i]) < 1e-8);
  });
}
assert.throws(
  (): AudioVoice => new WeaponSampleBank(actx).radio('radio_open', rng),
  /recordings are not loaded/
);
const events = new EventBus(),
  calls: string[] = [];
events.on('radio:strike', (): number => calls.push('radio_strike'));
const w = new WeaponSystem();
w.carpetBombs = 2;
w.radioEquipped = true;
w.radioSys = new RadioSystem();
w.radioSys.callStrike = (): boolean => {
  events.emit('radio:strike', { position: new Vector3() });
  return true;
};
w.audio = new AudioSystem();
w.audio.playUi = (id): boolean => {
  calls.push(id);
  return true;
};
w.ui = fixture<UiSystem>({ clearPrompt(): void {}, setPrompt(): void {} });
w._selectRequest(1);
assert.equal(w.carpetBombs, 1);
assert.deepEqual(
  calls,
  ['radio_strike'],
  'accepted event owns acknowledgment once, not producer plus UI'
);
w.radioSys.callStrike = (): boolean => false;
calls.length = 0;
w._selectRequest(1);
assert.equal(w.carpetBombs, 1);
assert.deepEqual(calls, ['radio_denied']);
w.carpetBombs = 0;
calls.length = 0;
w._selectRequest(1);
assert.deepEqual(calls, ['radio_denied']);
console.log(
  'Required radio components, variants, rate/timing, retained functional tones and sole accepted-strike acknowledgment'
);
