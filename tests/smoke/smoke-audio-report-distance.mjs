import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { SpatialField } from '../../src/audio/spatial.ts';
import {
  REPORT_DISTANCE,
  REPORT_DISTANT_MATCH,
  WEAPON_PROFILES,
  reportDistanceGain,
  reportDistantMix,
} from '../../src/audio/weapons.ts';
import { audioMaster } from '../helpers/audio-masters.mjs';

const reference = 1.9905358527674861; // independently pinned approved +12 dB audition
assert.deepEqual(REPORT_DISTANCE, { reference, blendStart: 20, blendEnd: 140 });
assert.equal(reportDistanceGain(0), 1);
assert.equal(reportDistanceGain(0.5), 1);
assert.equal(reportDistanceGain(1), 1);
assert.equal(reportDistanceGain(reference), 1);
assert.equal(reportDistanceGain(2), reference / 2);
assert.equal(reportDistanceGain(20), reference / 20);
assert.equal(reportDistanceGain(70), reference / 70);
assert(Math.abs(20 * Math.log10(reportDistanceGain(20)) + 20.04119982655925) < 1e-12);
for (const distance of [2, 5, 10, 20, 70, 140, 320])
  assert(
    Math.abs(20 * Math.log10(reportDistanceGain(distance) / (0.5 / distance)) - 12) < 1e-12,
    'one common +12 dB positional reference above the close-range unity cap'
  );
assert(
  Math.abs(20 * Math.log10(reportDistanceGain(70) / reportDistanceGain(20)) + 10.881360887005513) <
    1e-12
);
let previous = 1;
for (let distance = 0; distance <= 320; distance += 0.125) {
  const level = reportDistanceGain(distance);
  assert(level > 0 && level <= previous && level <= 1);
  previous = level;
}
// This is the geometric curve's continuity, not equality of different waveforms.
assert(Math.abs(reportDistanceGain(45 - 1e-6) - reportDistanceGain(45 + 1e-6)) < 1e-7);
assert.equal(SpatialField.prototype.attenuation(20), 2 / (2 + 0.85 * 18));

function meanReportEnergy(kind, count) {
  let energy = 0;
  for (let variant = 1; variant <= count; variant++) {
    const { file, reference } = audioMaster(`${kind}-${variant}`);
    if (!file) {
      energy += reference.monoEnergy;
      continue;
    }
    assert.equal(file.readUInt16LE(20), 3);
    assert.equal(file.readUInt16LE(34), 32);
    assert.equal(file.readUInt32LE(24), 48000);
    const channels = file.readUInt16LE(22);
    let offset = 12;
    while (file.toString('ascii', offset, offset + 4) !== 'data') {
      const size = file.readUInt32LE(offset + 4);
      offset += 8 + size + (size & 1);
      assert(offset + 8 <= file.length);
    }
    const end = offset + 8 + file.readUInt32LE(offset + 4);
    assert.equal(end, file.length);
    for (let p = offset + 8; p < end; p += 4 * channels) {
      let mono = 0;
      for (let ch = 0; ch < channels; ch++) mono += file.readFloatLE(p + ch * 4) / channels;
      energy += (mono * mono) / 48000;
    }
  }
  return energy / count;
}
assert.equal(Object.keys(REPORT_DISTANT_MATCH).length, 5);
for (const kind of ['rifle', 'pistol', 'lmg', 'sniper', 'shotgun']) {
  const profile = WEAPON_PROFILES[kind];
  const close = meanReportEnergy(kind, 3);
  const distant = meanReportEnergy(profile.distantSample, 2);
  const match = REPORT_DISTANT_MATCH[profile.distantSample];
  assert(
    Math.abs(match - Math.sqrt(close / distant)) < 1e-10,
    `${kind}: actual full-tail bank energy`
  );
  const energy20 = close * reportDistanceGain(20, profile) ** 2;
  const energy140 = distant * reportDistanceGain(140, profile) ** 2;
  assert(Math.abs(10 * Math.log10(energy140 / energy20) + 16.901960800285135) < 1e-8);
  assert.equal(reportDistantMix(20, profile), 0);
  assert.equal(reportDistantMix(80, profile), 0.5);
  assert.equal(reportDistantMix(140, profile), 1);
  for (const edge of [20, 45, 140])
    assert(
      Math.abs(
        reportDistanceGain(edge - 1e-6, profile) - reportDistanceGain(edge + 1e-6, profile)
      ) < 1e-7
    );
  for (let d = 0; d <= 320; d += 0.125) {
    const m = reportDistantMix(d, profile);
    assert(m >= 0 && m <= 1);
    assert(reportDistanceGain(d, profile) > 0 && reportDistanceGain(d, profile) <= 1);
    if (m > 0 && m < 1) {
      const near = Math.cos((m * Math.PI) / 2),
        far = match * Math.sin((m * Math.PI) / 2);
      const level = reportDistanceGain(d, profile);
      assert(Math.abs((level * near) / (near + far) - reportDistanceGain(d) * near) < 1e-12);
      assert(Math.abs((level * far) / (near + far) - reportDistanceGain(d) * far) < 1e-12);
    }
  }
  assert.equal(
    reportDistanceGain(70, profile, true),
    reference / 70,
    'forced positional close gets no far match; own dry reports bypass this curve'
  );
}
for (const kind of ['mcx', 'mpx'])
  assert.equal(reportDistanceGain(70, WEAPON_PROFILES[kind]), reference / 70);

const audio = new AudioSystem();
let distance = 20,
  acquired,
  built;
Object.assign(audio, {
  running: true,
  actx: { currentTime: 2, state: 'running' },
  field: {
    distanceTo: () => distance,
    acquire(options) {
      acquired = options;
      return {};
    },
    hold() {},
  },
  _build(kind, when, dist, options) {
    built = { kind, when, dist, options };
    return { node: { disconnect() {} }, send: 0, end: when + 2 };
  },
});
for (const profile of Object.values(WEAPON_PROFILES)) {
  for (distance of [0.5, 2, 20, 45, 45.001, 70, 320]) {
    assert(audio._playAt('shot', distance, 0, 0, { profile }, 'weapons'));
    assert.equal(
      acquired.atten,
      profile.samplePunch === false ? reportDistanceGain(distance, profile) : undefined
    );
    assert(acquired.atten === undefined || (acquired.atten > 0 && acquired.atten <= 1));
    assert.equal(acquired.gain, 1, 'emitter gain remains unity');
    assert.equal(acquired.when, 2 + distance / 343);
    assert.equal(built.dist, distance);
    assert.equal(built.options.profile, profile);
    assert.equal(
      reportDistantMix(distance, profile) === 1,
      distance >= 140 && !!profile.distantSample
    );
    assert.equal(reportDistantMix(distance, profile, true) === 1, false);
  }
}
for (const kind of ['step', 'explosion', 'bark', 'ambient', 'whizz']) {
  assert(audio._playAt(kind, distance, 0, 0));
  assert.equal(acquired.atten, undefined, `${kind}: no report-only falloff`);
}
distance = 70;
assert(audio._playAt('shot', 70, 0, 0));
assert.equal(acquired.atten, reportDistanceGain(70, WEAPON_PROFILES.rifle));
assert(audio._playAt('shot', 70, 0, 0, { profile: WEAPON_PROFILES.rifle, firstPerson: true }));
assert.equal(acquired.atten, reference / 70);
assert.equal(audio.stats.errors, 0);
console.log(
  'Approved +12dB positional reference: capped close range, unchanged perspective handoff/bank references; unity emitter, real timing and other sounds preserved'
);
