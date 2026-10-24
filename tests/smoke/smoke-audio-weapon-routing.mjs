import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { WEAPON_PROFILES, resolveProfile } from '../../src/audio/weapons.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';

// Exercise the real event-definition seam, not only hand-selected audio profiles.
const param = () => ({ value: 0 });
const node = () => ({ connect() {}, frequency: param(), Q: param(), gain: param(), pan: param() });
const sources = [];
const actx = {
  currentTime: 3,
  createGain: node,
  createBiquadFilter: node,
  createStereoPanner: node,
  createBufferSource() {
    const source = { ...node(), playbackRate: param(), start() {} };
    sources.push(source);
    return source;
  },
};
const audio = new AudioSystem();
const samples = new WeaponSampleBank(actx);
for (const profile of Object.values(WEAPON_PROFILES)) {
  samples.buffers[profile.sample] = [{ duration: 3, kind: profile.sample }];
  if (profile.distantSample)
    samples.buffers[profile.distantSample] = [{ duration: 4, kind: profile.distantSample }];
}
samples.actionBuffer = { duration: 0.5 };
Object.assign(audio, {
  running: true,
  actx,
  samples,
  rng: { range: (a, b) => (a + b) / 2 },
  mixer: { duck() {} },
  field: { listenerPos: { x: 0, y: 0, z: 0 }, distanceTo: (x) => Math.abs(x) },
  _lastEnemyFire: 1000,
});
let seen;
function capture(options, distance, path) {
  const profile = options.profile;
  const before = sources.length;
  // The selected profile is passed into the actual sample bank. Legacy distant
  // profiles deliberately retain their procedural branch; no substitute buffer.
  const recorded = distance <= 45 || profile.samplePunch === false;
  if (recorded) samples.shot(profile, audio.rng, { ...options, when: 4, distance });
  seen = {
    profile,
    path,
    buffers: recorded
      ? (profile.samplePunch === false
          ? sources.slice(before)
          : sources.slice(before, before + 1)
        ).map((s) => s.buffer.kind)
      : [],
  };
  return true;
}
audio._playDry = (kind, options) => {
  assert.equal(kind, 'shot');
  return capture(options, 0, 'dry');
};
audio._playAt = (kind, x, y, z, options) => {
  assert.equal(kind, 'shot');
  assert.equal(options.gain, 1, 'enemy reports have no extra presentation boost');
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
};
function expectedBanks(profile, distance) {
  if (distance > 45 && profile.samplePunch !== false) return [];
  if (!profile.distantSample || distance <= 20) return [profile.sample];
  return distance >= 140 ? [profile.distantSample] : [profile.sample, profile.distantSample];
}
for (const [id, key] of Object.entries(expected)) {
  const def = WEAPON_DEFS[id];
  const original = JSON.stringify(def);
  for (const distance of [0, 20, 70, 140]) {
    audio._onFire({ weapon: def, origin: { x: distance, y: 0, z: 0 } });
    const profile = WEAPON_PROFILES[key];
    assert.equal(seen.profile, profile, `${id}: real definition selects ${key}`);
    assert.equal(seen.path, distance ? 'spatial' : 'dry');
    assert.deepEqual(seen.buffers, expectedBanks(profile, distance));
  }
  assert.equal(JSON.stringify(def), original, 'audio must not mutate weapon definition');
}
assert.equal(WEAPON_DEFS.smg.audio, 'suppressed');
assert.equal(WEAPON_DEFS.smg.suppressed, true);
assert.equal(WEAPON_PROFILES.mpx.suppressed, true);
assert.equal(WEAPON_PROFILES.mcx.suppressed, true);
assert.notEqual(
  WEAPON_PROFILES.smg.suppressed,
  true,
  'compatibility UZI family stays unsuppressed'
);
for (const [weapon, expectedProfile] of [
  [{ id: 'smg', suppressed: false }, WEAPON_PROFILES.smg],
  [{ id: 'mp5', suppressed: false }, WEAPON_PROFILES.smg],
  [{ id: 'mp5', suppressed: true }, WEAPON_PROFILES.suppressed],
  [{ id: 'rifle', suppressed: true }, WEAPON_PROFILES.suppressed],
  ['suppressed', WEAPON_PROFILES.suppressed],
  ['silenced-test', WEAPON_PROFILES.suppressed],
  ['smg', WEAPON_PROFILES.smg],
  ['mp5', WEAPON_PROFILES.smg],
  ['mpx', WEAPON_PROFILES.mpx],
  ['ai_rifle', WEAPON_PROFILES.rifle],
]) {
  for (const distance of [0, 70]) {
    audio._onFire({ weapon, origin: { x: distance, y: 0, z: 0 } });
    assert.equal(seen.profile, expectedProfile, `fallback contract ${JSON.stringify(weapon)}`);
    assert.deepEqual(seen.buffers, expectedBanks(expectedProfile, distance));
  }
}
assert.equal(resolveProfile('suppressed'), WEAPON_PROFILES.suppressed);
console.log(
  'Actual weapon:fire routing: all seven definitions, stereo/positional banks, MPX suppression and legacy aliases'
);
