import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import type { AudioVoice } from '../../src/audio/types.ts';
import { WEAPON_PROFILES } from '../../src/audio/weapons.ts';
import { Rng } from '../../src/core/rng.ts';
import { AUDIO_BANKS } from '../lib/audio-banks.ts';
import { FixtureAudioBuffer, createAudioContext } from '../lib/audio-fixture.ts';

const total = 39 + AUDIO_BANKS.reduce((n, [, count]): number => n + count, 0);
const failedUrls = ['smg-1', ...AUDIO_BANKS.map(([banks]): string => Object.values(banks)[0][0])];
const fetch = globalThis.fetch;
try {
  for (const failure of [null, ...failedUrls, 'decode']) {
    let decodes = 0;
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return new Response(new ArrayBuffer(1), {
          status:
            !failure ||
            failure === 'decode' ||
            !(url === failure || url.endsWith('/' + failure + '.opus'))
              ? 200
              : 404,
        });
      },
      { preconnect: fetch.preconnect }
    );
    const actx = createAudioContext();
    actx.decodeAudioData = async (): Promise<AudioBuffer> => {
      decodes++;
      if (failure === 'decode') throw Error('invalid recording');
      return new FixtureAudioBuffer({ duration: 0.2 });
    };
    const bank = new WeaponSampleBank(actx);
    if (failure)
      await assert.rejects(bank.load(), failure === 'decode' ? /invalid recording/ : /HTTP 404/);
    else assert.equal(await bank.load(), total);
    assert.equal(
      decodes,
      failure !== null && failedUrls.includes(failure) ? total - 1 : total,
      'all jobs settle before failure teardown'
    );
    bank.dispose();
    assert(Object.values(bank.buffers).every((buffers): boolean => buffers.length === 0));
    assert.equal(bank.heartbeatBuffer, null);
    assert.deepEqual(bank.hitBuffers, {});
    assert.deepEqual(bank.hitIndices, {});
    assert.deepEqual(bank.aircraftBuffers, []);
    assert.equal(bank.aircraftIndex, -1);
    assert.deepEqual(bank.reloadBuffers, {});
    assert.deepEqual(bank.reloadIndices, {});
  }
  const missing = new WeaponSampleBank(createAudioContext());
  missing.buffers.rifle = [new FixtureAudioBuffer({ duration: 0.2 })];
  assert.throws(
    (): AudioVoice => missing.shot(WEAPON_PROFILES.smg, new Rng(1)),
    /smg recordings are not loaded/,
    'a missing weapon recording must not use a rifle take'
  );
  assert.throws(
    (): AudioVoice => missing.explosion('grenade', new Rng(1)),
    /recordings are not loaded/
  );
  const audio = new AudioSystem();
  audio.samples = missing;
  audio.rng = new Rng(1);
  assert.throws(
    (): AudioVoice => audio._build('shot', 0, 0, { profile: WEAPON_PROFILES.smg }),
    /smg recordings are not loaded/,
    'near recorded fire must not synthesize a substitute'
  );
  assert.throws((): AudioVoice => audio._build('explosion', 0, 0, {}), /recordings are not loaded/);
} finally {
  globalThis.fetch = fetch;
}
console.log(
  'All recorded assets are required; HTTP/decode failures and missing takes never select substitutes'
);
