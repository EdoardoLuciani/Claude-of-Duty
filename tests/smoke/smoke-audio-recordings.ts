import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { WeaponSampleBank } from '../../src/audio/samples.ts';
import { AUDIO_BANKS } from '../lib/audio-banks.ts';

const root = new URL('../../src/audio/samples/', import.meta.url);
const relative = (url) => url.slice(root.href.length);
const hash = (name, value) => {
  const payload = JSON.stringify(value);
  if (process.env.DUMP_CHARACTERIZATION) console.log(name, payload);
  return createHash('sha256').update(payload).digest('hex');
};
// Pinned from the explicit URL lists at af113a8: keys, bank order and take order.
const bankHashes = [
  'ed7a94239eb143caeac51388245143d042c700e02e6d7fe8193282357c388127',
  '77baca42c9a537386679f0b380d6a10b0541677c034e83eab2f934d9fb1363cc',
  'e8a8ba8251e9a25720487daddc0ac50de2eeed0c3cb84730ae4d88209c3febc1',
  '7005ed087e90911dcb6afbac3ae9f8a84159e3a05ddff8a4e6a7b2604b9a512c',
  '8c504e960fcb328e91687c444c60bfa048e69ee84d08aee108e38f6b92d0560c',
  '5a4e3d6b0f4d812b90625babc285a3f34b47b06059e933c4d909f2f06b9cfd31',
  'e65e3c900abedf1474be59e25022537246c277fee3322bbd2965cfe8a8660d43',
  '39006e92a419974e7ddc17a0e9951b7d80c4258682f9357f9d875e02b3c91849',
  'e6ae6a9ac45d73e5bb5be581f0f704a6b73a3883a670a41307fce765db05a8c0',
  '8f88913a61d429b6ea237ac101ff7a856f14b39eef7e5157dbb18a6f69b0203f',
];
for (const [index, [banks]] of AUDIO_BANKS.entries()) {
  const catalog = Object.entries(banks).map(([kind, urls]) => [kind, urls.map(relative)]);
  const name = Object.keys(banks)[0];
  assert.equal(
    hash(`catalog:${name}`, catalog),
    bankHashes[index],
    `${name}: catalog characterization changed; inspect with DUMP_CHARACTERIZATION=1`
  );
}

const fetched = [];
const pending = [];
const bank = new WeaponSampleBank({
  decodeAudioData(bytes) {
    return new Promise((resolve) => {
      pending.push(() => resolve({ name: new TextDecoder().decode(bytes), duration: 0.5 }));
    });
  },
});
const fetch = globalThis.fetch;
try {
  globalThis.fetch = async (url) => {
    assert(url.startsWith(root.href), 'raw Node imports retain local file URLs');
    fetched.push(relative(url));
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(relative(url)).buffer };
  };
  const loading = bank.load();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 375);
  // Completing decodes backwards must not reorder the takes or their initial cursors.
  for (const finish of pending.reverse()) finish();
  assert.equal(await loading, 375);
} finally {
  globalThis.fetch = fetch;
}
assert.equal(
  hash('fetch-order', fetched),
  'ee24c46687630e01e3e2ff6632d4103e6e95e25a35b5bf6cbbcf654a67381964',
  'fetch-order characterization changed; inspect with DUMP_CHARACTERIZATION=1'
);
const localFiles = readdirSync(root, { recursive: true }).filter((name) => name.endsWith('.opus'));
assert.deepEqual([...fetched].sort(), localFiles.sort(), 'every local recording is loaded once');
for (const [banks] of AUDIO_BANKS) {
  for (const [kind, urls] of Object.entries(banks)) {
    const reload = urls[0].includes('/reloads/');
    const buffers =
      kind === 'propeller'
        ? bank.aircraftBuffers
        : (reload ? bank.reloadBuffers : bank.hitBuffers)[kind];
    assert.deepEqual(
      buffers.map((buffer) => buffer.name),
      urls.map(relative),
      kind
    );
    if (kind !== 'propeller')
      assert.equal((reload ? bank.reloadIndices : bank.hitIndices)[kind], -1);
  }
}
for (const [kind, buffers] of Object.entries(bank.buffers)) {
  assert.equal(bank.indices[kind], 0, 'firearm takes still start at zero, not a random variant');
  assert.deepEqual(
    buffers.map((buffer) => buffer.name),
    buffers.map((_, i) => `${kind}-${i + 1}.opus`)
  );
}
assert.equal(bank.aircraftIndex, -1);
assert.equal(bank.heartbeatBuffer.name, 'heartbeat.opus');
const retained = [
  ...Object.values(bank.buffers),
  ...Object.values(bank.hitBuffers),
  ...Object.values(bank.reloadBuffers),
  bank.aircraftBuffers,
];
bank.dispose();
assert(
  retained.every((buffers) => buffers.length === 0),
  'dispose clears even borrowed array handles'
);
assert.equal(bank.loaded, 0);

// Exercise Vite's actual eager URL transform, separately from raw Node's file fallback.
// Library output inlines assets, allowing byte-for-byte checks without a server or dist writes.
const result = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    minify: false,
    reportCompressedSize: false,
    lib: {
      entry: fileURLToPath(new URL('../../src/audio/recordings.ts', import.meta.url)),
      formats: ['es'],
    },
  },
});
const outputs = Array.isArray(result) ? result : [result];
const chunk = outputs
  .flatMap((output) => output.output)
  .find((entry) => entry.type === 'chunk' && entry.isEntry);
const bundled = await import(
  `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
);
for (const name of fetched) {
  const url = bundled.recordingUrl(name.slice(0, -'.opus'.length));
  assert.match(url, /^data:.*;base64,/);
  assert.deepEqual(
    Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
    readFileSync(new URL(name, root)),
    name
  );
}
assert.deepEqual(
  bundled.recordingUrls('mpx', 3),
  [1, 2, 3].map((i) => bundled.recordingUrl(`mpx-${i}`))
);
assert.throws(() => bundled.recordingUrl('not-a-recording'), /missing bundled recording/);
console.log(
  '375 unchanged ordered recordings: raw Node, reverse decode completion, disposal and Vite URL bytes'
);
