import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import { WeaponSampleBank } from '../../src/audio/samples.ts';
import reports from '../../src/audio/samples/weapon-reports-provenance.json' with { type: 'json' };
import { AUDIO_BANKS } from '../lib/audio-banks.ts';
import {
  fixtureBuffer,
  FixtureAudioBuffer,
  createAudioContext,
  fixtureEntries,
} from '../lib/audio-fixture.ts';

// Served from public/audio/samples/ at this fixed path.
const PREFIX = '/audio/samples/';
const root = new URL('../../public/audio/samples/', import.meta.url);
const relative = (url: string): string => {
  assert(url.startsWith(PREFIX), `${url}: served from ${PREFIX}`);
  return url.slice(PREFIX.length);
};
const fetched: string[] = [];
const pending: Array<() => void> = [];
const actx = createAudioContext();
actx.decodeAudioData = (bytes): Promise<AudioBuffer> =>
  new Promise((resolve): void => {
    pending.push((): void =>
      resolve(new FixtureAudioBuffer({ name: new TextDecoder().decode(bytes), duration: 0.5 }))
    );
  });
const bank = new WeaponSampleBank(actx);
const fetch = globalThis.fetch;
try {
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetched.push(relative(url));
      return new Response(new TextEncoder().encode(relative(url)));
    },
    { preconnect: fetch.preconnect }
  );
  const loading = bank.load();
  await new Promise((resolve): NodeJS.Immediate => setImmediate(resolve));
  assert.equal(pending.length, fetched.length);
  // Completing decodes backwards must not reorder the takes or their initial cursors.
  for (const finish of pending.reverse()) finish();
  assert.equal(await loading, fetched.length);
} finally {
  globalThis.fetch = fetch;
}
const localFiles = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
  (name): boolean => name.endsWith('.opus')
);
assert.deepEqual([...fetched].sort(), localFiles.sort(), 'every local recording is loaded once');
for (const [name, recording] of Object.entries(reports.files)) {
  const bytes = readFileSync(new URL(`${name}.opus`, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), recording.sha256, name);
  assert(recording.monoEnergy > 1e-7, `${name}: authored shot must not be silent`);
}
for (const [banks] of AUDIO_BANKS) {
  for (const [kind, urls] of fixtureEntries(banks)) {
    const reload = urls[0].includes('/reloads/');
    const buffers =
      kind === 'propeller'
        ? bank.aircraftBuffers
        : (reload ? fixtureEntries(bank.reloadBuffers) : fixtureEntries(bank.hitBuffers)).find(
            ([key]): boolean => key === kind
          )?.[1];
    assert(buffers);
    assert.deepEqual(
      buffers.map((buffer): string => fixtureBuffer(buffer).name),
      urls.map(relative),
      kind
    );
    if (kind !== 'propeller')
      assert.equal(
        (reload ? fixtureEntries(bank.reloadIndices) : fixtureEntries(bank.hitIndices)).find(
          ([key]): boolean => key === kind
        )?.[1],
        -1
      );
  }
}
for (const [kind, buffers] of fixtureEntries(bank.buffers)) {
  assert(buffers);
  assert.equal(bank.indices[kind], 0, 'firearm takes still start at zero, not a random variant');
  assert.deepEqual(
    buffers.map((buffer): string => fixtureBuffer(buffer).name),
    buffers.map((_, i): string => `${kind}-${i + 1}.opus`)
  );
}
assert.equal(bank.aircraftIndex, -1);
assert.equal(fixtureBuffer(bank.heartbeatBuffer).name, 'heartbeat.opus');
const retained = [
  ...Object.values(bank.buffers),
  ...Object.values(bank.hitBuffers),
  ...Object.values(bank.reloadBuffers),
  bank.aircraftBuffers,
];
bank.dispose();
assert(
  retained.every((buffers): boolean => buffers?.length === 0),
  'dispose clears even borrowed array handles'
);
assert.equal(bank.loaded, 0);

console.log(
  'Recording banks: reverse decode completion, disposal and every local recording loaded once'
);
