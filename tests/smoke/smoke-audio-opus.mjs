import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

import { audioReference } from '../helpers/audio-masters.mjs';

const module = readFileSync(new URL('../../src/audio/samples.ts', import.meta.url), 'utf8');
const names = [...module.matchAll(/new URL\(['"]\.\/samples\/([a-z0-9-]+)\.opus['"]/g)].map(
  (m) => m[1]
);
assert.equal(names.length, 40, 'All required runtime assets use Opus');
assert.equal(new Set(names).size, 40);
assert(!/new URL\(['"]\.\/samples\/[^'"]+\.wav/.test(module), 'WAV masters are not shipped');
assert(
  !readdirSync(new URL('../../src/audio/samples/', import.meta.url)).some((n) =>
    n.endsWith('.wav')
  ),
  'WAV masters belong in the external authoring archive'
);
let totalBytes = 0;
for (const name of names) {
  const reference = audioReference[name];
  assert(reference, 'Frozen master baseline must exist');
  const opus = readFileSync(new URL(`../../src/audio/samples/${name}.opus`, import.meta.url));
  const frames = reference.frames;
  const head = opus.indexOf('OpusHead');
  assert(head >= 0, 'Required Opus header');
  assert.equal(opus[head + 9], reference.channels, 'Preserve stereo/mono identity');
  assert.equal(opus.readInt16LE(head + 16), 0, 'No header gain compensation');
  const skip = opus.readUInt16LE(head + 10);
  let granule;
  const payloadHash = createHash('sha256');
  for (let p = 0; p < opus.length;) {
    assert.equal(opus.toString('ascii', p, p + 4), 'OggS');
    const segments = opus[p + 26];
    const payload = opus.subarray(p + 27, p + 27 + segments).reduce((sum, n) => sum + n, 0);
    payloadHash.update(opus.subarray(p + 27 + segments, p + 27 + segments + payload));
    if (opus[p + 5] & 4) granule = opus.readBigUInt64LE(p + 6);
    p += 27 + segments + payload;
    assert(p <= opus.length, 'Complete Ogg page');
  }
  assert.equal(Number(granule) - skip, frames, 'Granules retain the complete master duration');
  assert.equal(
    payloadHash.digest('hex'),
    reference.opusPayloadSha256,
    `${name}: approved codec payload changed`
  );
  totalBytes += opus.length;
}
assert(totalBytes < 4_000_000, 'High-quality delivery bank stays within4MB');
console.log('PASS:40 Opus assets, intact master durations/layouts, zero header gain, compact bank');
