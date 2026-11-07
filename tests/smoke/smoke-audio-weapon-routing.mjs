import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { WEAPON_PROFILES, resolveProfile } from '../../src/audio/weapons.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';

// Exercise the real event-definition seam and sample bank, with no synthesis nodes.
const param = () => ({ value: 0 });
const node = () => ({ connect() {}, gain: param() });
const sources = [];
const actx = {
  currentTime: 3,
  createGain: node,
  createBufferSource() {
    const source = { ...node(), playbackRate: param(), start() {} };
    sources.push(source);
    return source;
  },
};
const audio = new AudioSystem(),
  samples = new WeaponSampleBank(actx);
for (const profile of Object.values(WEAPON_PROFILES)) {
  samples.buffers[profile.sample] = [{ duration: 3, kind: profile.sample }];
  if (profile.distantSample)
    samples.buffers[profile.distantSample] = [{ duration: 4, kind: profile.distantSample }];
}
Object.assign(audio, {
  running: true,
  actx,
  samples,
  rng: {},
  mixer: { duck() {} },
  field: { listenerPos: { x: 0, y: 0, z: 0 }, distanceTo: (x) => Math.abs(x) },
});
let seen;
function capture(options, distance, path) {
  const before = sources.length;
  const voice = audio._build('shot', 4, distance, options);
  seen = {
    profile: options.profile,
    path,
    buffers: sources.slice(before).map((s) => s.buffer.kind),
  };
  assert.equal(voice.send, 0, 'recorded decay only');
  assert.equal(voice.node.gain.value, 1, 'no per-profile boost');
  return true;
}
audio._playDry = (kind, options, bus, send) => {
  assert.equal(kind, 'shot');
  assert.equal(bus, 'weapons');
  assert.equal(send, 0);
  return capture(options, 0, 'dry');
};
audio._playAt = (kind, x, y, z, options) => {
  assert.equal(kind, 'shot');
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
};
function expectedBanks(profile, distance) {
  if (!profile.distantSample || distance <= 20) return [profile.sample];
  return distance >= 140 ? [profile.distantSample] : [profile.sample, profile.distantSample];
}
for (const [id, key] of Object.entries(expected)) {
  const def = WEAPON_DEFS[id],
    original = JSON.stringify(def);
  for (const distance of [0, 20, 45, 70, 140, 300]) {
    seen = null;
    audio._onFire({ weapon: def, origin: { x: distance, y: 0, z: 0 } });
    assert.equal(seen.profile, WEAPON_PROFILES[key], `${id}: real definition selects ${key}`);
    assert.equal(seen.path, distance ? 'spatial' : 'dry');
    assert.deepEqual(seen.buffers, expectedBanks(WEAPON_PROFILES[key], distance));
  }
  assert.equal(JSON.stringify(def), original, 'routing does not mutate definitions');
}
assert.equal(WEAPON_DEFS.smg.audio, 'mpx');
assert.equal(WEAPON_DEFS.smg.suppressed, true);
assert.equal(WEAPON_PROFILES.mpx.suppressed, true);
assert.equal(WEAPON_PROFILES.mcx.suppressed, true);
assert.equal(Object.hasOwn(WEAPON_PROFILES, 'suppressed'), false, 'generic report profile retired');
for (const [weapon, expectedProfile] of [
  ['ak', WEAPON_PROFILES.ak],
  ['akm', WEAPON_PROFILES.ak],
  ['smg', WEAPON_PROFILES.smg],
  ['mp5', WEAPON_PROFILES.smg],
  ['mpx', WEAPON_PROFILES.mpx],
  ['mcx', WEAPON_PROFILES.mcx],
  ['ai_rifle', WEAPON_PROFILES.rifle],
]) {
  for (const distance of [0, 70, 180]) {
    audio._onFire({ weapon, origin: { x: distance, y: 0, z: 0 } });
    assert.equal(seen.profile, expectedProfile);
    assert.deepEqual(seen.buffers, expectedBanks(expectedProfile, distance));
  }
}
for (const weapon of [
  'suppressed',
  'silenced-test',
  { id: 'mp5', suppressed: true },
  { id: 'rifle', suppressed: true },
]) {
  seen = null;
  audio._onFire({ weapon, origin: { x: 0, y: 0, z: 0 } });
  assert.equal(seen, null, 'removed generic routes stay silent, never borrow another report');
}
assert.equal(resolveProfile('suppressed'), null);
assert.equal(resolveProfile('silenced-test'), null);
assert.equal(resolveProfile('mcx-suppressed'), WEAPON_PROFILES.mcx);
assert.equal(resolveProfile('mpx-suppressed'), WEAPON_PROFILES.mpx);
console.log(
  'Actual firearm routing: all seven definitions, recorded AK at every range, dedicated MCX/MPX, unsupported generic-suppressed requests silent'
);
