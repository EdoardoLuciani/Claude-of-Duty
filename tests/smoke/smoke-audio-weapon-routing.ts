import assert from 'node:assert/strict';

import { Vector3 } from 'three';

import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import type { SpatialField } from '../../src/audio/spatial.ts';
import type { WeaponProfile } from '../../src/audio/types.ts';
import {
  SUPPRESSED_WEAPON_PROFILES,
  WEAPON_PROFILES,
  resolveProfile,
} from '../../src/audio/weapons.ts';
import { Rng } from '../../src/core/rng.ts';
import { BASE_ATTACHMENTS } from '../../src/weapons/attachments.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import {
  audioFixture,
  FixtureAudioBuffer,
  type FixtureBufferSource,
  fixtureEntries,
  fixtureMixer,
  fixtureBuffer,
} from '../lib/audio-fixture.ts';
import { fixture } from '../lib/fixture.ts';

// Exercise the real event-definition seam and sample bank, with no synthesis nodes.
const { actx, sources } = audioFixture(3);
const createSource = actx.createBufferSource.bind(actx);
actx.createBufferSource = (): FixtureBufferSource => {
  const source = createSource();
  // These report fixtures originally start at zero to detect missing playback-rate writes.
  source.playbackRate.value = 0;
  return source;
};
const audio = new AudioSystem(),
  samples = new WeaponSampleBank(actx);
const profiles: WeaponProfile[] = [
  ...Object.values(WEAPON_PROFILES),
  ...Object.values(SUPPRESSED_WEAPON_PROFILES),
];
for (const profile of profiles) {
  samples.buffers[profile.sample] = [new FixtureAudioBuffer({ duration: 3, kind: profile.sample })];
  if (profile.distantSample)
    samples.buffers[profile.distantSample] = [
      new FixtureAudioBuffer({ duration: 4, kind: profile.distantSample }),
    ];
}
audio.running = true;
audio.actx = actx;
audio.samples = samples;
audio.rng = new Rng(1);
audio.mixer = fixtureMixer(actx);
audio.field = fixture<SpatialField>({
  listenerPos: { x: 0, y: 0, z: 0 },
  distanceTo: (x): number => Math.abs(x),
});
type Seen = { profile: WeaponProfile | undefined; path: string; buffers: string[] };
const captureState: { seen: Seen | null } = { seen: null };
function capture(
  options: NonNullable<Parameters<AudioSystem['_playAt']>[4]>,
  distance: number,
  path: string
): boolean {
  const before = sources.length;
  const voice = audio._build('shot', 4, distance, options);
  captureState.seen = {
    profile: options.profile,
    path,
    buffers: sources.slice(before).map((s): string => fixtureBuffer(s.buffer).kind),
  };
  assert.equal(voice.send, 0, 'recorded decay only');
  assert.equal(voice.node.gain.value, 1, 'no per-profile boost');
  return true;
}
let dryFires = 0;
audio._playDry = (kind, options, bus, send): boolean => {
  if (kind === 'dryfire') {
    assert.equal(bus, 'weapons');
    assert.equal(send, 0.15);
    dryFires++;
    return true;
  }
  assert.equal(kind, 'shot');
  assert.equal(bus, 'weapons');
  assert.equal(send, 0);
  assert(options);
  return capture(options, 0, 'dry');
};
audio._playAt = (kind, x, y, z, options): boolean => {
  assert.equal(kind, 'shot');
  assert(options);
  assert.equal(options.gain, 1);
  return capture(options, Math.abs(x), 'spatial');
};
const expected = {
  rifle: 'rifle',
  mcx: 'mcx',
  pistol: 'pistol',
  lmg: 'lmg',
  smg: 'mpx',
  sniper: 'sniper',
  shotgun: 'shotgun',
} as const;
function expectedBanks(profile: WeaponProfile, distance: number): string[] {
  if (!profile.distantSample || distance <= 20) return [profile.sample];
  return distance >= 140 ? [profile.distantSample] : [profile.sample, profile.distantSample];
}
for (const [id, key] of fixtureEntries(expected)) {
  const def = WEAPON_DEFS[id],
    original = JSON.stringify(def);
  const weapon = { ...def, suppressed: false, attachments: BASE_ATTACHMENTS };
  for (const distance of [0, 20, 45, 70, 140, 300]) {
    for (const suppressed of [false, true, false]) {
      weapon.attachments = { ...BASE_ATTACHMENTS, muzzle: suppressed ? 'suppressor' : null };
      const expectedProfile = suppressed ? SUPPRESSED_WEAPON_PROFILES[key] : WEAPON_PROFILES[key];
      captureState.seen = null;
      audio._onFire({
        weapon,
        origin: new Vector3(distance, 0, 0),
        actor: null,
        dir: new Vector3(),
        seed: 0,
      });
      const seen = latestCapture();
      assert(seen);
      assert.equal(seen.profile, expectedProfile, `${id}: next shot follows suppression state`);
      assert.equal(seen.path, distance ? 'spatial' : 'dry');
      assert.deepEqual(seen.buffers, expectedBanks(expectedProfile, distance));
    }
  }
  assert.equal(JSON.stringify(def), original, 'routing does not mutate definitions');
}
assert.equal(WEAPON_DEFS.smg.audio, 'mpx');
assert.equal(WEAPON_DEFS.smg.suppressed, true);

for (const [weapon, expectedProfile] of [
  ['ak', WEAPON_PROFILES.ak],
  ['smg', WEAPON_PROFILES.smg],
  ['mpx', WEAPON_PROFILES.mpx],
  ['mcx', WEAPON_PROFILES.mcx],
  ['ai_rifle', WEAPON_PROFILES.rifle],
] as const) {
  for (const distance of [0, 70, 180]) {
    // Bare profile keys enter through untyped callers, not gameplay event types.
    Reflect.apply(audio._onFire.bind(audio), audio, [
      { weapon, origin: new Vector3(distance, 0, 0) },
    ]);
    assert.equal(captureState.seen?.profile, expectedProfile);
    assert.deepEqual(captureState.seen?.buffers, expectedBanks(expectedProfile, distance));
  }
}
for (const weapon of [
  { id: 'mp5', suppressed: true },
  { id: 'ak', suppressed: true },
]) {
  captureState.seen = null;
  Reflect.apply(audio._onFire.bind(audio), audio, [{ weapon, origin: new Vector3(0, 0, 0) }]);
  assert.equal(
    captureState.seen,
    null,
    'removed generic routes stay silent, never borrow another report'
  );
}
// Empty triggers remain mechanical clicks, even for an unsupported suppressed report.
audio._onFire({
  weapon: { id: 'ai_rifle', audio: 'ak', suppressed: true },
  origin: new Vector3(),
  actor: null,
  dir: new Vector3(),
  seed: 0,
  empty: true,
});
assert.equal(dryFires, 1);
assert.equal(resolveProfile(null), WEAPON_PROFILES.rifle);
assert.equal(resolveProfile('ai_rifle'), WEAPON_PROFILES.rifle);
console.log(
  'All seven firearm banks switch on the next shot at every range; unsupported suppressed reports stay silent, empty triggers still click'
);

function latestCapture(): Seen | null {
  return captureState.seen;
}
