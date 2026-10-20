import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const module = readFileSync(new URL('../../src/audio/samples.ts', import.meta.url), 'utf8');
const names = [...module.matchAll(/new URL\(['"]\.\/samples\/([a-z0-9-]+)\.opus['"]/g)].map(
  (m) => m[1]
);
assert.equal(names.length, 40, 'All required runtime assets use Opus');
assert.equal(new Set(names).size, 40);
assert(!/new URL\(['"]\.\/samples\/[^'"]+\.wav/.test(module), 'WAV masters are not shipped');
let totalBytes = 0;
for (const name of names) {
  const wav = readFileSync(new URL(`../../src/audio/samples/${name}.wav`, import.meta.url));
  const opus = readFileSync(new URL(`../../src/audio/samples/${name}.opus`, import.meta.url));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 48000);
  let at = 12;
  while (wav.toString('ascii', at, at + 4) !== 'data') {
    at += 8 + wav.readUInt32LE(at + 4) + (wav.readUInt32LE(at + 4) & 1);
    assert(at + 8 <= wav.length, 'Master has a data chunk');
  }
  const frames = wav.readUInt32LE(at + 4) / wav.readUInt16LE(32);
  const head = opus.indexOf('OpusHead');
  assert(head >= 0, 'Required Opus header');
  assert.equal(opus[head + 9], wav.readUInt16LE(22), 'Preserve stereo/mono identity');
  assert.equal(opus.readInt16LE(head + 16), 0, 'No header gain compensation');
  const skip = opus.readUInt16LE(head + 10);
  let granule;
  for (let p = 0; p < opus.length;) {
    assert.equal(opus.toString('ascii', p, p + 4), 'OggS');
    const segments = opus[p + 26];
    const payload = opus.subarray(p + 27, p + 27 + segments).reduce((sum, n) => sum + n, 0);
    if (opus[p + 5] & 4) granule = opus.readBigUInt64LE(p + 6);
    p += 27 + segments + payload;
    assert(p <= opus.length, 'Complete Ogg page');
  }
  assert.equal(Number(granule) - skip, frames, 'Granules retain the complete master duration');
  totalBytes += opus.length;
}
assert(totalBytes < 4_000_000, 'High-quality delivery bank stays within4MB');
console.log('PASS:40 Opus assets, intact master durations/layouts, zero header gain, compact bank');
