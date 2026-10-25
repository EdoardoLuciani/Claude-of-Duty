import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { WEAPON_PROFILES } from '../../src/audio/weapons.ts';
import { AUDIO_BANKS } from '../lib/audio-banks.mjs';

const total = 40 + AUDIO_BANKS.reduce((n, bank) => n + bank[3], 0);
const failedUrls = ['smg-1', ...AUDIO_BANKS.map(([, banks]) => Object.values(banks)[0][0])];
const fetch = globalThis.fetch;
try {
  for (const failure of [null, ...failedUrls, 'decode']) {
    let decodes = 0;
    globalThis.fetch = async (url) => ({
      ok: !failure || failure === 'decode' || !url.includes(failure),
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(1),
    });
    const bank = new WeaponSampleBank({
      async decodeAudioData() {
        decodes++;
        if (failure === 'decode') throw Error('invalid recording');
        return { duration: 0.2 };
      },
    });
    if (failure)
      await assert.rejects(bank.load(), failure === 'decode' ? /invalid recording/ : /HTTP 404/);
    else assert.equal(await bank.load(), total);
    assert.equal(
      decodes,
      failedUrls.includes(failure) ? total - 1 : total,
      'all jobs settle before failure teardown'
    );
    bank.dispose();
    assert(Object.values(bank.buffers).every((buffers) => buffers.length === 0));
    assert.equal(bank.heartbeatBuffer, null);
    assert.deepEqual(bank.hitBuffers, {});
    assert.deepEqual(bank.hitIndices, {});
    assert.deepEqual(bank.aircraftBuffers, []);
    assert.equal(bank.aircraftIndex, -1);
    assert.deepEqual(bank.reloadBuffers, {});
    assert.deepEqual(bank.reloadIndices, {});
  }
  const missing = new WeaponSampleBank({});
  missing.buffers.rifle = [{ duration: 0.2 }];
  assert.throws(
    () => missing.shot(WEAPON_PROFILES.smg, {}),
    /smg recordings are not loaded/,
    'a missing weapon recording must not use a rifle take'
  );
  assert.throws(() => missing.explosion({}), /recording is not loaded/);
  const audio = new AudioSystem();
  audio.samples = missing;
  audio.rng = {};
  assert.throws(
    () => audio._build('shot', 0, 0, { profile: WEAPON_PROFILES.smg }),
    /smg recordings are not loaded/,
    'near recorded fire must not synthesize a substitute'
  );
  assert.throws(() => audio._build('explosion', 0, 0, {}), /recording is not loaded/);
} finally {
  globalThis.fetch = fetch;
}
console.log(
  'All recorded assets are required; HTTP/decode failures and missing takes never select substitutes'
);
