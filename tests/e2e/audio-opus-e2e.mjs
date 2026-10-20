import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = resolve(process.env.OPUS_EVIDENCE_DIR ?? '/tmp/cod-opus-decode');
assert(!evidence.startsWith(root), 'Keep private evidence outside the repository');
mkdirSync(evidence, { recursive: true });
const source = readFileSync(resolve(root, 'src/audio/samples.ts'), 'utf8');
const names = [...source.matchAll(/new URL\(['"]\.\/samples\/([a-z0-9-]+)\.opus['"]/g)].map(
  (m) => m[1]
);
assert.equal(names.length, 40);
const rows = [],
  errors = [];
const port = Number(process.env.PORT ?? 5510);
const server = await ensureViteServer({ root, port });
assert(server, 'Refusing occupied/unverified Opus test server');
let browser;
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/private-opus-decode', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'Native Opus/master decode comparison' })
  );
  await page.goto(`http://127.0.0.1:${port}/private-opus-decode`);
  for (const rate of [44100, 48000, 96000]) {
    for (const name of names) {
      const row = await page.evaluate(
        async ({ name, rate }) => {
          const ctx = new OfflineAudioContext(2, rate, rate);
          const load = async (extension) => {
            const response = await fetch(`/src/audio/samples/${name}.${extension}`);
            if (!response.ok) throw Error(`Missing ${name}.${extension}`);
            return ctx.decodeAudioData(await response.arrayBuffer());
          };
          const [a, b] = await Promise.all([load('wav'), load('opus')]);
          function measure(buffer) {
            let energy = 0,
              peak = 0,
              finite = true;
            for (let channel = 0; channel < buffer.numberOfChannels; channel++)
              for (const value of buffer.getChannelData(channel)) {
                energy += value * value;
                peak = Math.max(peak, Math.abs(value));
                finite &&= Number.isFinite(value);
              }
            return {
              frames: buffer.length,
              channels: buffer.numberOfChannels,
              rate: buffer.sampleRate,
              rms: Math.sqrt(energy / (buffer.length * buffer.numberOfChannels)),
              peak,
              finite,
            };
          }
          const wav = measure(a),
            opus = measure(b);
          return { name, rate, wav, opus, energyDeltaDb: 20 * Math.log10(opus.rms / wav.rms) };
        },
        { name, rate }
      );
      rows.push(row);
      assert(row.wav.finite && row.opus.finite, `${name}: non-finite PCM`);
      assert.equal(row.opus.channels, row.wav.channels, `${name}: channel identity`);
      assert.equal(row.opus.frames, row.wav.frames, `${name}: pre-skip/full duration`);
      assert.equal(row.opus.rate, rate);
      assert(Math.abs(row.energyDeltaDb) < 0.5, `${name}: encoded energy drift above0.5dB`);
    }
  }
  assert(
    rows.some((r) => r.opus.peak > 1),
    'Decoder retains legitimate float headroom'
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'PASS:120 native Opus/master pairs, exact layouts/lengths, float headroom, energy drift<0.5dB'
  );
} finally {
  writeFileSync(
    resolve(evidence, 'decode.json'),
    JSON.stringify(
      {
        rows,
        errors,
        scope: 'Codec engineering checks, not lossless/punch/listening/all-browser acceptance.',
      },
      null,
      2
    ) + '\n'
  );
  await browser?.close();
  await stopViteServer(server);
}
