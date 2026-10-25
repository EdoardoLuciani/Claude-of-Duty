import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { AUDIO_BANKS } from '../lib/audio-banks.mjs';

for (const [dir, banks, provenance, count, maxDuration, maxBytes, maxDecoded] of AUDIO_BANKS) {
  let bytes = 0,
    seconds = 0;
  const names = [];
  for (const [kind, urls] of Object.entries(banks)) {
    assert(urls.length >= (['foley', 'hits', 'radio', 'reactions'].includes(dir) ? 3 : 2));
    const cuts = new Set();
    for (const url of urls) {
      const name = new URL(url).pathname.split('/').at(-1).replace('.opus', '');
      names.push(name);
      const file = { ...provenance.banks?.[kind], ...provenance.files[name] };
      const data = readFileSync(new URL(url));
      assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256, name);
      const head = data.indexOf('OpusHead');
      assert(head >= 0, name);
      assert.equal(data[head + 9], 1, name + ': mono source');
      assert.equal(data.readInt16LE(head + 16), 0, name + ': no hidden codec gain');
      let granule;
      for (let p = 0; p < data.length;) {
        assert.equal(data.toString('ascii', p, p + 4), 'OggS');
        const segments = data[p + 26];
        const size = data.subarray(p + 27, p + 27 + segments).reduce((n, b) => n + b, 0);
        if (data[p + 5] & 4) granule = data.readBigUInt64LE(p + 6);
        p += 27 + segments + size;
        assert(p <= data.length, name + ': complete Ogg page');
      }
      const duration = (Number(granule) - data.readUInt16LE(head + 10)) / 48000;
      assert(duration > 0 && duration <= maxDuration, name + ': finite authored crop');
      if (dir === 'aircraft') assert(duration > 3);
      if (dir === 'foley') assert(duration >= 0.2);
      if (dir === 'reloads' && name.startsWith('pump-')) assert(duration <= 0.11);
      const layers = file.layers ?? [file];
      for (const layer of layers) {
        const source = provenance.sources?.[layer.source];
        assert.match(
          source?.sha256 ?? source?.sourceSha256 ?? layer.sourceSha256,
          /^[a-f0-9]{64}$/,
          name + ': donor hash'
        );
        if (dir === 'reloads') assert(source.description.length > 0);
      }
      cuts.add(file.source + ':' + file.start);
      bytes += data.length;
      seconds += duration;
    }
    if (dir === 'foley') assert.equal(cuts.size, urls.length, kind + ': distinct source crops');
  }
  assert.equal(names.length, count, dir);
  assert.deepEqual(
    names.sort(),
    Object.keys(provenance.files).sort(),
    dir + ': exact provenance coverage'
  );
  assert(bytes < maxBytes && seconds * 48000 * 4 < maxDecoded, dir + ': delivery/decode budget');
  if (dir === 'aircraft')
    assert.notEqual(provenance.files['propeller-1'].source, provenance.files['propeller-2'].source);
}
console.log(
  'All recorded banks: frozen output/donor hashes, distinct crops, mono Opus, duration and storage budgets'
);
