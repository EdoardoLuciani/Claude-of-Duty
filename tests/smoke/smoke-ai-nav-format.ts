import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { navHash, packNav, unpackNav } from '../../src/ai/nav-format.ts';
import { isRecord } from '../../src/ai/validation.ts';

const directory = new URL('../../public/models/world/', import.meta.url);
const level: unknown = JSON.parse(readFileSync(new URL('level.json', directory), 'utf8'));
assert(isRecord(level) && isRecord(level.assets) && typeof level.assets.nav === 'string');
assert(isRecord(level.navigation) && typeof level.navigation.sha256 === 'string');
const original = new Uint8Array(gunzipSync(readFileSync(new URL(level.assets.nav, directory))));
const baked = await unpackNav(original, { sha256: level.navigation.sha256 });
const packed = await packNav(baked.meta, baked.nav, baked.components, baked.points);
assert.deepEqual(
  packed,
  original,
  'checked metadata and binary sections preserve exact bake output'
);
assert.equal(await navHash(packed), level.navigation.sha256);

// Re-sign mutated metadata so rejection tests reach its schema, not the checksum.
async function changedMetadata(
  change: (metadata: Record<string, unknown>) => void
): Promise<Uint8Array<ArrayBuffer>> {
  const oldSize = new DataView(original.buffer).getUint32(8, true);
  const metadata: unknown = JSON.parse(
    new TextDecoder().decode(original.subarray(64, 64 + oldSize))
  );
  assert(isRecord(metadata));
  change(metadata);
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const size = (json.length + 3) & ~3;
  const output = new Uint8Array(original.length + size - oldSize);
  output.set(original.subarray(0, 64));
  new DataView(output.buffer).setUint32(8, size, true);
  output.fill(32, 64, 64 + size);
  output.set(json, 64);
  output.set(original.subarray(64 + oldSize), 64 + size);
  output.set(new Uint8Array(await crypto.subtle.digest('SHA-256', output.subarray(64))), 32);
  return output;
}

const missingFields: [string, RegExp][] = [
  ['version', /unsupported bake version\/engine/],
  ['engine', /unsupported bake version\/engine/],
  ['profile', /incompatible infantry profile/],
  ['config', /incompatible bake configuration/],
];
for (const [key, expected] of missingFields) {
  await assert.rejects(
    unpackNav(
      await changedMetadata((metadata): void => {
        delete metadata[key];
      })
    ),
    expected,
    `${key} must be checked before constructing normalized metadata`
  );
}
const invalidBounds: [unknown, RegExp][] = [
  [null, /missing bounds/],
  [{ min: null, max: [1, 2, 3] }, /missing bounds/],
  [{ min: [0, '0', 0], max: [1, 2, 3] }, /missing bounds/],
  [{ min: [0, 0], max: [1, 2, 3] }, /missing bounds/],
  [{ min: [0, 0, 0, 0], max: [1, 2, 3] }, /missing bounds/],
  [{ min: [0, 3, 0], max: [1, 2, 3] }, /invalid bounds/],
];
for (const [value, expected] of invalidBounds) {
  await assert.rejects(
    unpackNav(
      await changedMetadata((metadata): void => {
        metadata.bounds = value;
      })
    ),
    expected
  );
}
await assert.rejects(
  unpackNav(await changedMetadata((metadata): number => (metadata.sourceHash = 1))),
  /invalid sourceHash/
);
console.log('AI nav format: byte-identical round trip and metadata validation/error precedence');
