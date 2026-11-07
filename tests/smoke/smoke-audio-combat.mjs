import assert from 'node:assert/strict';

import {
  CASING_BANK,
  COMBAT_URLS,
  COMBAT_MIX,
  dryBank,
  nearMissGain,
} from '../../src/audio/combat.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import provenance from '../../src/audio/samples/combat/provenance.json' with { type: 'json' };
import { Rng } from '../../src/core/rng.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { audioFixture } from '../lib/audio-banks.mjs';

assert.equal(
  Object.values(COMBAT_URLS).reduce((n, urls) => n + urls.length, 0),
  46
);
assert.deepEqual(
  COMBAT_URLS.whizz.map((url) => {
    const name = new URL(url).pathname.split('/').at(-1).replace('.opus', '');
    return provenance.files[name].layers[0].source.split('/').at(-1);
  }),
  [507, 508, 509, 510, 511].map((n) => `BulletPassBy_BW.54${n}.wav`),
  'owner-selected pass-bys only; exclude the rejected variants'
);
const { actx, sources } = audioFixture(2);
const gains = [];
actx.createGain = () => {
  const node = { gain: { value: 0 }, connect() {}, disconnect() {} };
  gains.push(node);
  return node;
};
const bank = new WeaponSampleBank(actx),
  rng = new Rng(535);
for (const [key, urls] of Object.entries(COMBAT_URLS)) {
  bank.hitBuffers[key] = urls.map((_, index) => ({ key, index, duration: 0.2 + index * 0.01 }));
  const seen = new Set(),
    crops = new Set();
  let previous = -1;
  for (const url of urls) {
    const name = new URL(url).pathname.split('/').at(-1).replace('.opus', '');
    const file = provenance.files[name];
    crops.add(JSON.stringify(file.layers.map((l) => [l.source, l.start, l.delay ?? 0])));
  }
  assert.equal(crops.size, urls.length, key + ': distinct recorded takes');
  for (let i = 0; i < 60; i++) {
    const voice = bank.combat(key, rng, { when: 4, delay: 0.25, level: 0.7, send: 0.12 });
    const source = sources.at(-1);
    assert.equal(source.buffer.key, key);
    assert.notEqual(source.buffer.index, previous, key + ': no immediate repeat');
    previous = source.buffer.index;
    seen.add(previous);
    assert.equal(source.playbackRate.value, 1, 'no pitch-manufactured variants');
    assert.equal(source.when, 4.25);
    assert.equal(voice.end, source.when + source.buffer.duration + 0.02, 'complete edited tail');
    assert.equal(voice.send, 0.12);
    assert.equal(gains.at(-1).gain.value, 0.7);
  }
  assert.equal(seen.size, urls.length, key + ': every take reachable');
}

const audio = new AudioSystem();
Object.assign(audio, { actx, samples: bank, rng });
for (const [miss, expected] of [
  [0, 1],
  [0.5, 1],
  [3, 0.6],
  [6, 0.1],
  [100, 0.1],
])
  assert(Math.abs(nearMissGain(miss) - expected) < 1e-12);
let previous = 1;
for (let miss = 0; miss < 8; miss += 0.01) {
  const value = nearMissGain(miss);
  assert(value > 0 && value <= previous);
  previous = value;
}
audio._build('whizz', 4, 1, { miss: 3, level: 0.5 });
assert.equal(sources.at(-1).buffer.key, 'whizz');
assert(Math.abs(gains.at(-1).gain.value - 0.3) < 1e-12);
for (const [surface, key] of Object.entries(CASING_BANK)) {
  const result = audio._build('shell', 4, 1, { surface, flight: 0.4 });
  assert.equal(sources.at(-1).buffer.key, key);
  assert.equal(sources.at(-1).when, 4.4, 'casing flight precedes first recorded impact');
  assert.equal(result.end, 4.4 + sources.at(-1).buffer.duration + 0.02);
  assert.equal(result.send, COMBAT_MIX.casingSend);
}
audio._build('shell', 4, 1, { surface: 'unknown' });
assert.equal(sources.at(-1).buffer.key, 'casing-concrete');
for (const [weapon, expected] of [
  ['rifle', 'dry-ar'],
  ['mcx', 'dry-ar'],
  ['lmg', 'dry-ar'],
  ['pistol', 'dry-pistol'],
  ['smg', 'dry-smg'],
  ['mpx', 'dry-smg'],
  ['sniper', 'dry-bolt'],
  ['shotgun', 'dry-shotgun'],
  ['ak', 'dry-ak'],
]) {
  assert.equal(dryBank(weapon), expected);
  audio._build('dryfire', 4, 0, { dryWeapon: weapon });
  assert.equal(sources.at(-1).buffer.key, expected);
}
for (const [kind, key] of [['grenade_throw', 'grenade-throw']]) {
  audio._build(kind, 4, 0, { level: 0.8 });
  assert.equal(sources.at(-1).buffer.key, key);
  assert.equal(sources.at(-1).when, 4);
  assert.equal(gains.at(-1).gain.value, 0.8);
}
// Public grenade callbacks keep physical handling on foley, hit feedback on UI.
const calls = [];
audio._playDry = (...args) => {
  calls.push(args);
  return true;
};
assert.equal(audio.play('grenade_pin'), false);
assert.equal(audio.play('grenade_pin', { x: 0, y: 0, z: 0 }), false);
assert.equal(audio.ui('grenade_pin'), false);
assert.equal(audio.playUi('grenade_pin'), false);
assert.equal(calls.length, 0, 'rejected pin cue stays silent, never a fallback beep');
for (const cue of ['grenade_throw', 'hitmarker']) audio.playUi(cue, 0.9);
assert.deepEqual(
  calls.map((c) => c[2]),
  ['foley', 'ui']
);
assert(calls.every((c) => c[1].level === 0.9));
Object.assign(audio, { running: true, field: {}, mixer: {} });
for (const id of ['rifle', 'pistol', 'smg', 'sniper', 'shotgun']) {
  audio._onFire({ weapon: { id }, empty: true });
  assert.equal(calls.at(-1)[0], 'dryfire');
  assert.equal(calls.at(-1)[1].dryWeapon, id);
}
// Keep reached-segment ownership, shot deduplication and local-shooter rejection.
const nearCalls = [];
Object.assign(audio, {
  field: { listenerPos: { x: 0, y: 1.6, z: 0 } },
  _playAt: (...args) => nearCalls.push(args),
});
const segment = { from: { x: -10, y: 1.6, z: -1 }, to: { x: 10, y: 1.6, z: -1 }, shot: 123 };
audio._onBulletSegment(segment);
audio._onBulletSegment(segment);
assert.equal(nearCalls.length, 1);
assert.equal(nearCalls[0][0], 'whizz');
assert.equal(nearCalls[0][4].noDelay, true);
audio._onBulletSegment({ ...segment, shot: 124, from: { x: 0, y: 1.6, z: 0 } });
assert.equal(nearCalls.length, 1, 'own muzzle does not generate a pass-by');
audio._onBulletSegment({
  ...segment,
  shot: 125,
  from: { x: -10, y: 1.6, z: -6 },
  to: { x: 10, y: 1.6, z: -6 },
});
assert.equal(nearCalls.length, 1, 'out-of-range rounds are culled');

// Real empty-trigger producer: click only, cooldown respected, no shot side effects.
const weapon = new WeaponSystem(),
  dryCalls = [];
weapon.states.set('rifle', { def: { id: 'rifle' }, chambered: false, mag: 0 });
weapon.audio = { play: (...args) => dryCalls.push(args) };
weapon.ctx = {
  events: {
    emit() {
      throw Error('empty trigger emitted gameplay evidence');
    },
  },
};
assert.equal(weapon.tryFire(), false);
assert.deepEqual(dryCalls, [['dryfire', null, { dryWeapon: 'rifle' }]]);
assert.equal(weapon._pendingShots, 0);
assert.equal(weapon._fireTimer, 0.25);
assert.equal(weapon.tryFire(), false);
assert.equal(dryCalls.length, 1, 'cooldown prevents duplicate click');
weapon._fireTimer = 0;
weapon.grenadeEquipped = true;
assert.equal(weapon.tryFire(), false);
assert.equal(dryCalls.length, 1);
weapon.grenadeEquipped = false;
weapon.disabled = true;
assert.equal(weapon.tryFire(), false);
assert.equal(dryCalls.length, 1);

bank.dispose();
for (const key of Object.keys(COMBAT_URLS))
  assert.throws(() => bank.combat(key, rng), /recordings are not loaded/);
console.log(
  'Recorded combat foley: real variants, required banks, materials, families, timing/tails, reached-segment routing, physical/UI separation and real empty-trigger feedback'
);
