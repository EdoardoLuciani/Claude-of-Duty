import assert from 'node:assert/strict';

import { uiSound } from '../../src/audio/foley.ts';
import { RADIO_URLS, radioCue } from '../../src/audio/radio.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
const parameter = () => ({
  value: 0,
  events: [],
  setValueAtTime(v, t) {
    this.events.push(['set', v, t]);
  },
  linearRampToValueAtTime(v, t) {
    this.events.push(['ramp', v, t]);
  },
  exponentialRampToValueAtTime() {},
  setTargetAtTime() {},
});
const sources = [],
  oscillators = [];
const actx = {
  currentTime: 0,
  createGain: () => ({ gain: parameter(), connect() {}, disconnect() {} }),
  createBufferSource() {
    const s = {
      playbackRate: { value: 1 },
      connect() {},
      start(when) {
        this.when = when;
      },
    };
    sources.push(s);
    return s;
  },
  createOscillator() {
    const o = {
      frequency: parameter(),
      detune: parameter(),
      connect() {},
      start(when) {
        this.when = when;
      },
      stop() {},
    };
    oscillators.push(o);
    return o;
  },
};
const bank = new WeaponSampleBank(actx),
  rng = new Rng(474),
  noNoise = {
    source() {
      throw Error('replaced procedural radio noise');
    },
  };
for (const [key, urls] of Object.entries(RADIO_URLS))
  bank.hitBuffers[key] = urls.map((_, index) => ({ key, index, duration: 0.3 }));
for (const kind of ['radio_open', 'radio_strike', 'intel_call']) {
  const before = sources.length;
  const recorded = bank.radio(kind, rng, { when: 2 });
  const used = sources.slice(before);
  assert.equal(used.length, kind === 'intel_call' ? 1 : 2);
  assert.deepEqual(
    used.map((source) => source.buffer.key),
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
]) {
  oscillators.length = 0;
  uiSound(actx, noNoise, rng, kind, { when: 2 });
  assert.equal(oscillators.length, freqs.length);
  oscillators.forEach((o, i) => {
    assert(Math.abs(o.frequency.value - freqs[i]) < 1e-8);
    assert(Math.abs(o.when - times[i]) < 1e-8);
  });
}
assert.throws(
  () => new WeaponSampleBank(actx).radio('radio_open', rng),
  /recordings are not loaded/
);
const events = new EventBus(),
  calls = [];
events.on('radio:strike', () => calls.push('radio_strike'));
const w = Object.create(WeaponSystem.prototype);
Object.assign(w, {
  carpetBombs: 2,
  radioEquipped: true,
  radioSys: {
    callStrike() {
      events.emit('radio:strike', {});
      return true;
    },
  },
  audio: { playUi: (id) => calls.push(id) },
  ui: { clearPrompt() {}, setPrompt() {} },
  _viewmodel: { endRadio() {} },
});
w._selectRequest(1);
assert.equal(w.carpetBombs, 1);
assert.deepEqual(
  calls,
  ['radio_strike'],
  'accepted event owns acknowledgment once, not producer plus UI'
);
w.radioSys.callStrike = () => false;
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
