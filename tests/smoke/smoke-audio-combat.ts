import assert from 'node:assert/strict';

import { Vector3 } from 'three';

import {
  CASING_BANK,
  COMBAT_URLS,
  COMBAT_MIX,
  dryBank,
  nearMissGain,
} from '../../src/audio/combat.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import type { BusName } from '../../src/audio/mixer.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import provenance from '../../src/audio/samples/combat/provenance.json' with { type: 'json' };
import type { SpatialField } from '../../src/audio/spatial.ts';
import type { AudioVoice } from '../../src/audio/types.ts';
import { hasOwn } from '../../src/core/guards.ts';
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { SURFACE_NAMES, type SurfaceName } from '../../src/physics/surfaces.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { audioFixture } from '../lib/audio-banks.ts';
import {
  fixtureEntries,
  fixtureMixer,
  fixtureKeys,
  at,
  fixtureBuffer,
  FixtureAudioBuffer,
} from '../lib/audio-fixture.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';

assert.equal(
  Object.values(COMBAT_URLS).reduce((n, urls): number => n + urls.length, 0),
  46
);
assert.deepEqual(
  COMBAT_URLS.whizz.map((url): string | undefined => {
    const name = url.split('/').at(-1)?.replace('.opus', '');
    assert(name !== undefined && hasOwn(provenance.files, name));
    return provenance.files[name].layers[0].source.split('/').at(-1);
  }),
  [507, 508, 509, 510, 511].map((n): string => `BulletPassBy_BW.54${n}.wav`),
  'owner-selected pass-bys only; exclude the rejected variants'
);
const { actx, sources } = audioFixture(2);
const gains = actx.gains;
const bank = new WeaponSampleBank(actx),
  rng = new Rng(535);
for (const [key, urls] of fixtureEntries(COMBAT_URLS)) {
  bank.hitBuffers[key] = urls.map(
    (_, index): FixtureAudioBuffer =>
      new FixtureAudioBuffer({ key, index, duration: 0.2 + index * 0.01 })
  );
  const seen = new Set(),
    crops = new Set();
  let previous = -1;
  for (const url of urls) {
    const name = url.split('/').at(-1)?.replace('.opus', '');
    assert(name !== undefined && hasOwn(provenance.files, name));
    const file = provenance.files[name];
    crops.add(
      JSON.stringify(
        file.layers.map((l): unknown[] => [l.source, l.start, 'delay' in l ? l.delay : 0])
      )
    );
  }
  assert.equal(crops.size, urls.length, key + ': distinct recorded takes');
  for (let i = 0; i < 60; i++) {
    const voice = bank.combat(key, rng, { when: 4, delay: 0.25, level: 0.7, send: 0.12 });
    const source = at(sources, -1);
    assert.equal(fixtureBuffer(source.buffer).key, key);
    assert.notEqual(fixtureBuffer(source.buffer).index, previous, key + ': no immediate repeat');
    previous = fixtureBuffer(source.buffer).index;
    seen.add(previous);
    assert.equal(source.playbackRate.value, 1, 'no pitch-manufactured variants');
    assert.equal(source.when, 4.25);
    assert.equal(
      voice.end,
      source.when + fixtureBuffer(source.buffer).duration + 0.02,
      'complete edited tail'
    );
    assert.equal(voice.send, 0.12);
    assert.equal(at(gains, -1).gain.value, 0.7);
  }
  assert.equal(seen.size, urls.length, key + ': every take reachable');
}

const audio = new AudioSystem();
audio.actx = actx;
audio.samples = bank;
audio.rng = rng;
for (const [miss, expected] of [
  [0, 1],
  [0.5, 1],
  [3, 0.6],
  [6, 0.1],
  [100, 0.1],
] as const)
  assert(Math.abs(nearMissGain(miss) - expected) < 1e-12);
let previous = 1;
for (let miss = 0; miss < 8; miss += 0.01) {
  const value = nearMissGain(miss);
  assert(value > 0 && value <= previous);
  previous = value;
}
audio._build('whizz', 4, 1, { miss: 3, level: 0.5 });
assert.equal(fixtureBuffer(at(sources, -1).buffer).key, 'whizz');
assert(Math.abs(at(gains, -1).gain.value - 0.3) < 1e-12);
for (const [surface, key] of fixtureEntries(CASING_BANK)) {
  const result = audio._build('shell', 4, 1, { surface: surfaceName(surface), flight: 0.4 });
  assert.equal(fixtureBuffer(at(sources, -1).buffer).key, key);
  assert.equal(at(sources, -1).when, 4.4, 'casing flight precedes first recorded impact');
  assert.equal(result.end, 4.4 + fixtureBuffer(at(sources, -1).buffer).duration + 0.02);
  assert.equal(result.send, COMBAT_MIX.casingSend);
}
// Deliberate untyped surface fallback scenario.
Reflect.apply(audio._build.bind(audio), audio, ['shell', 4, 1, { surface: 'unknown' }]);
assert.equal(fixtureBuffer(at(sources, -1).buffer).key, 'casing-concrete');
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
] as const) {
  assert.equal(dryBank(weapon), expected);
  audio._build('dryfire', 4, 0, { dryWeapon: weapon });
  assert.equal(fixtureBuffer(at(sources, -1).buffer).key, expected);
}
for (const [kind, key] of [['grenade_throw', 'grenade-throw']] as const) {
  audio._build(kind, 4, 0, { level: 0.8 });
  assert.equal(fixtureBuffer(at(sources, -1).buffer).key, key);
  assert.equal(at(sources, -1).when, 4);
  assert.equal(at(gains, -1).gain.value, 0.8);
}
// Public grenade callbacks keep physical handling on foley, hit feedback on UI.
const calls: Parameters<AudioSystem['_playDry']>[] = [];
audio._playDry = (...args): boolean => {
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
  calls.map((c): BusName | undefined => c[2]),
  ['foley', 'ui']
);
assert(calls.every((c): boolean => c[1]?.level === 0.9));
audio.running = true;
audio.field = fixture<SpatialField>({});
audio.mixer = fixtureMixer(actx);
for (const id of ['rifle', 'pistol', 'smg', 'sniper', 'shotgun'] as const) {
  audio._onFire({
    weapon: { id },
    empty: true,
    actor: null,
    origin: new Vector3(),
    dir: new Vector3(),
    seed: 0,
  });
  assert.equal(at(calls, -1)[0], 'dryfire');
  assert.equal(at(calls, -1)[1]?.dryWeapon, id);
}
// Keep reached-segment ownership, shot deduplication and local-shooter rejection.
const nearCalls: Parameters<AudioSystem['_playAt']>[] = [];
audio.field = fixture<SpatialField>({ listenerPos: { x: 0, y: 1.6, z: 0 } });
audio._playAt = (...args): boolean => {
  nearCalls.push(args);
  return true;
};
const segment = {
  from: new Vector3(-10, 1.6, -1),
  to: new Vector3(10, 1.6, -1),
  shot: 123,
  shooter: null,
  weapon: 'rifle' as const,
  speed: 0,
  tracer: false,
};
audio._onBulletSegment(segment);
audio._onBulletSegment(segment);
assert.equal(nearCalls.length, 1);
assert.equal(nearCalls[0][0], 'whizz');
assert.equal(nearCalls[0][4]?.noDelay, true);
audio._onBulletSegment({ ...segment, shot: 124, from: new Vector3(0, 1.6, 0) });
assert.equal(nearCalls.length, 1, 'own muzzle does not generate a pass-by');
audio._onBulletSegment({
  ...segment,
  shot: 125,
  from: new Vector3(-10, 1.6, -6),
  to: new Vector3(10, 1.6, -6),
});
assert.equal(nearCalls.length, 1, 'out-of-range rounds are culled');

// Real empty-trigger producer: click only, cooldown respected, no shot side effects.
const weapon = new WeaponSystem(),
  dryCalls: Parameters<AudioSystem['play']>[] = [];
const state = weapon._makeState('rifle');
state.chambered = false;
state.mag = 0;
weapon.states.set('rifle', state);
weapon.audio = new AudioSystem();
weapon.audio.play = (...args): boolean => {
  dryCalls.push(args);
  return true;
};
const events = new EventBus();
events.emit = (): never => {
  throw Error('empty trigger emitted gameplay evidence');
};
weapon.ctx = createTestContext({ events, rng });
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
for (const key of fixtureKeys(COMBAT_URLS))
  assert.throws((): AudioVoice => bank.combat(key, rng), /recordings are not loaded/);
console.log(
  'Recorded combat foley: real variants, required banks, materials, families, timing/tails, reached-segment routing, physical/UI separation and real empty-trigger feedback'
);

function surfaceName(name: string): SurfaceName {
  assert(hasOwn(CASING_BANK, name));
  const surface = SURFACE_NAMES.find((surface): boolean => surface === name);
  assert(surface);
  return surface;
}
