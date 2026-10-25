import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import provenance from '../../src/audio/samples/ak-provenance.json' with { type: 'json' };
import reference from '../../src/audio/samples/reference.json' with { type: 'json' };
import * as reports from '../../src/audio/weapons.ts';
import { AUDIO_BANKS } from '../lib/audio-banks.mjs';

const names = ['ak-1', 'ak-2', 'ak-3', 'ak-distant-1', 'ak-distant-2'];
assert.deepEqual(Object.keys(provenance.files).sort(), [...names].sort());
assert.equal(Object.keys(provenance.sources).length, 2);
assert.equal(reports.WEAPON_PROFILES.ak.distantSample, 'ak-distant');
assert.equal('weaponShot' in reports, false, 'procedural report generator removed');
assert.equal('weaponPunch' in reports, false, 'synthetic reinforcement removed');
let bytes = 0;
const crops = new Set();
for (const name of names) {
  const file = provenance.files[name],
    master = reference.files[name];
  const data = readFileSync(new URL(`../../src/audio/samples/${name}.opus`, import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256);
  assert.equal(master.sha256, file.masterSha256);
  assert.equal(master.frames, Math.round(file.duration * reference.masterRate));
  assert.equal(master.channels, 2, 'retain authored stereo for own reports');
  assert(master.monoEnergy > 0);
  assert.match(provenance.sources[file.source].sha256, /^[a-f0-9]{64}$/);
  assert(
    file.source.endsWith(
      name.startsWith('ak-distant')
        ? 'GUNAuto_AR-AK47 Distant Single_B00M_TGDS.wav'
        : 'GUNAuto_AR-AK47 Close Single_B00M_TGDS.wav'
    )
  );
  assert.equal(file.gainDb, -3, 'one common offline delivery headroom, no per-take normalization');
  assert.equal(data.readInt16LE(data.indexOf('OpusHead') + 16), 0);
  crops.add(file.source + ':' + file.start);
  bytes += data.length;
}
assert.equal(crops.size, 5);
assert(bytes < 600000, 'compact complete close/distant report bank');

// Every new recording is mandatory; none can disappear behind another firearm or synthesis.
const originalFetch = globalThis.fetch;
const total = 39 + AUDIO_BANKS.reduce((n, bank) => n + bank[3], 0);
try {
  for (const name of names)
    for (const mode of ['HTTP', 'decode']) {
      let decodes = 0;
      globalThis.fetch = async (url) => {
        const selected = url.endsWith('/' + name + '.opus');
        return {
          ok: !(selected && mode === 'HTTP'),
          status: 404,
          arrayBuffer: async () => new Uint8Array([Number(selected)]).buffer,
        };
      };
      const bank = new WeaponSampleBank({
        async decodeAudioData(data) {
          decodes++;
          if (mode === 'decode' && new Uint8Array(data)[0]) throw Error('invalid AK recording');
          return { duration: 0.2 };
        },
      });
      await assert.rejects(bank.load(), mode === 'HTTP' ? /HTTP 404/ : /invalid AK recording/);
      assert.equal(decodes, mode === 'HTTP' ? total - 1 : total, 'all load jobs settle');
      bank.dispose();
      assert.deepEqual(bank.buffers, {});
    }
} finally {
  globalThis.fetch = originalFetch;
}
const bank = new WeaponSampleBank({});
bank.buffers.rifle = [{ duration: 0.2 }];
const audio = new AudioSystem();
Object.assign(audio, { samples: bank, rng: {} });
for (const distance of [0, 20, 45, 70, 140, 300])
  assert.throws(
    () => audio._build('shot', 4, distance, { profile: reports.WEAPON_PROFILES.ak }),
    /recordings are not loaded/,
    'missing AK never synthesizes or borrows another weapon'
  );
console.log(
  'AK reports: exact authored donors, distinct crops, frozen delivery/master references, retired synthesis, every new asset mandatory at all ranges'
);
