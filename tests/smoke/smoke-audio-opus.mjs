import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import reference from '../../src/audio/samples/reference.json' with { type: 'json' };

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
  const referenceFile = reference.files[name];
  assert(referenceFile, 'Frozen master baseline must exist');
  if (process.env.AUDIO_MASTER_DIR)
    assert.equal(
      createHash('sha256')
        .update(readFileSync(resolve(process.env.AUDIO_MASTER_DIR, name + '.wav')))
        .digest('hex'),
      referenceFile.sha256,
      name + ': archived master changed'
    );
  const opus = readFileSync(new URL(`../../src/audio/samples/${name}.opus`, import.meta.url));
  const frames = referenceFile.frames;
  const head = opus.indexOf('OpusHead');
  assert(head >= 0, 'Required Opus header');
  assert.equal(opus[head + 9], referenceFile.channels, 'Preserve stereo/mono identity');
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
    referenceFile.opusPayloadSha256,
    `${name}: approved codec payload changed`
  );
  totalBytes += opus.length;
}
assert(totalBytes < 4_000_000, 'High-quality delivery bank stays within4MB');
console.log('PASS:40 Opus assets, intact master durations/layouts, zero header gain, compact bank');
