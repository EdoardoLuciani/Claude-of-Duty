import assert from 'node:assert/strict';

import { AIRCRAFT_URLS } from '../../src/audio/aircraft.ts';
import { FOLEY_URLS } from '../../src/audio/foley-urls.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { RELOAD_URLS } from '../../src/audio/reloads.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { WEAPON_PROFILES } from '../../src/audio/weapons.ts';

const total =
  50 +
  Object.values(FOLEY_URLS).reduce((sum, urls) => sum + urls.length, 0) +
  Object.values(RELOAD_URLS).reduce((sum, urls) => sum + urls.length, 0) +
  AIRCRAFT_URLS.length;
const fetch = globalThis.fetch;
try {
  for (const failure of [null, 'http', 'reload-http', 'decode']) {
    let decodes = 0;
    globalThis.fetch = async (url) => ({
      ok: !(
        (failure === 'http' && url.includes('smg-1')) ||
        (failure === 'reload-http' && url.includes('ar-in-1'))
      ),
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
      await assert.rejects(
        bank.load(),
        failure === 'http'
          ? /smg-1.*HTTP 404/
          : failure === 'reload-http'
            ? /ar-in-1.*HTTP 404/
            : /invalid recording/
      );
    else assert.equal(await bank.load(), total);
    assert.equal(
      decodes,
      failure?.endsWith('http') ? total - 1 : total,
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
