import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AIRCRAFT_URLS } from '../../src/audio/aircraft.ts';
import * as ambienceModule from '../../src/audio/ambience.ts';
import {
  ENVIRONMENT_URLS,
  ENVIRONMENT_KINDS,
  environmentBank,
} from '../../src/audio/environment.ts';
import { FOLEY_URLS } from '../../src/audio/foley-urls.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { RELOAD_URLS } from '../../src/audio/reloads.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import provenance from '../../src/audio/samples/environment/provenance.json' with { type: 'json' };
import { Rng } from '../../src/core/rng.ts';
import { sha256 } from '../../tools/lib/recorded-one-shot.mjs';
assert(!('ambientOneShot' in ambienceModule), 'replaced generators are removed');
assert.deepEqual(
  [...ambienceModule.ONE_SHOTS],
  ['dog', 'siren', 'creak', 'settle', 'birds', 'vehicle', 'heli']
);
let bytes = 0,
  decoded = 0;
for (const [key, urls] of Object.entries(ENVIRONMENT_URLS)) {
  assert.equal(urls.length, 2);
  for (const [i, url] of urls.entries()) {
    const data = readFileSync(new URL(url)),
      meta = provenance.files[`${key}-${i + 1}`];
    assert.equal(sha256(data), meta.sha256);
    const h = data.indexOf('OpusHead');
    assert(h >= 0);
    assert.equal(data[h + 9], 1);
    assert.equal(data.readInt16LE(h + 16), 0);
    assert(meta.decodedPeak < 0.5 && meta.decodedDuration <= 10 && meta.downmixLossDb > -6);
    bytes += data.length;
    decoded += meta.decodedDuration * 48000 * 4;
  }
}
assert(bytes < 1000000 && decoded < 16000000);
const sources = [],
  actx = {
    currentTime: 0,
    createGain: () => ({ gain: { value: 0 }, connect() {} }),
    createBufferSource() {
      const s = {
        playbackRate: { value: 1 },
        connect() {},
        start(when) {
          this.when = when;
        },
      };
      sources.push(s);
      return s;
    },
  };
const bank = new WeaponSampleBank(actx),
  rng = new Rng(474);
for (const [key, urls] of Object.entries(ENVIRONMENT_URLS))
  bank.hitBuffers[key] = urls.map((_, index) => ({ key, index, duration: 2 }));
for (const kind of ENVIRONMENT_KINDS) {
  let last = -1;
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const voice = bank.environment(kind, rng, { when: 3 });
    const s = sources.at(-1);
    assert.equal(s.buffer.key, environmentBank(kind));
    assert.notEqual(s.buffer.index, last);
    assert.equal(s.playbackRate.value, 1);
    assert.equal(s.when, 3);
    assert.equal(voice.end, 5.02);
    last = s.buffer.index;
    seen.add(last);
  }
  assert.equal(seen.size, 2);
}
const audio = new AudioSystem();
Object.assign(audio, {
  running: true,
  actx,
  samples: bank,
  rng,
  field: { listenerPos: { x: 0, y: 1.6, z: 0 } },
});
const calls = [];
audio._playAt = (...a) => {
  calls.push(a);
  return true;
};
audio.bark = () => {
  throw Error('phantom tactical voice');
};
for (const which of ENVIRONMENT_KINDS) {
  rng.pick = () => which;
  audio._ambientOneShot();
  assert.equal(calls.at(-1)[4].which, which);
  assert.equal(calls.at(-1)[5], 'ambience');
}
assert.equal(typeof audio._distantChatter, 'undefined');
const empty = new WeaponSampleBank(actx);
assert.throws(() => empty.environment('dog', rng), /recordings are not loaded/);
assert.throws(() => bank.environment('shout', rng), /recordings are not loaded/);
const oldFetch = globalThis.fetch;
try {
  let decodes = 0,
    fail = false;
  globalThis.fetch = async (url) => ({
    ok: !(fail && url.includes('environment-heli-2')),
    status: 404,
    arrayBuffer: async () => new ArrayBuffer(1),
  });
  const complete = new WeaponSampleBank({ decodeAudioData: async () => ({ duration: 1 }) });
  const completeCount = await complete.load();
  complete.dispose();
  fail = true;
  const required = new WeaponSampleBank({
    decodeAudioData: async () => {
      decodes++;
      return { duration: 1 };
    },
  });
  await assert.rejects(required.load(), /environment-heli-2.*HTTP 404/);
  const total =
    50 +
    AIRCRAFT_URLS.length +
    [FOLEY_URLS, RELOAD_URLS, ENVIRONMENT_URLS].reduce(
      (sum, group) => sum + Object.values(group).reduce((n, urls) => n + urls.length, 0),
      0
    );
  assert(completeCount >= total, 'full bank includes every category required by this slice');
  assert.equal(decodes, completeCount - 1, 'one failed file, all other categories settle');
  required.dispose();
  assert.deepEqual(required.hitBuffers, {});
} finally {
  globalThis.fetch = oldFetch;
}
console.log(
  'Recorded environment assets, variants, no synthesis fallback, sparse scheduler ownership and no phantom tactical voices'
);
