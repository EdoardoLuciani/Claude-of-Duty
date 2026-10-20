import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const references = JSON.parse(
  readFileSync(resolve(root, 'src/audio/samples/reference.json'), 'utf8')
).files;
const masterDirectory = process.env.AUDIO_MASTER_DIR;
const masters = new Map();
if (masterDirectory)
  for (const name of names) {
    const data = readFileSync(resolve(masterDirectory, name + '.wav'));
    assert.equal(createHash('sha256').update(data).digest('hex'), references[name].sha256);
    masters.set(name + '.wav', data);
  }
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
  if (masterDirectory)
    await page.route('**/private-audio-masters/*.wav', (route) => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      assert(masters.has(name));
      return route.fulfill({ contentType: 'audio/wav', body: masters.get(name) });
    });
  await page.goto(`http://127.0.0.1:${port}/private-opus-decode`);
  for (const rate of [44100, 48000, 96000]) {
    for (const name of names) {
      const row = await page.evaluate(
        async ({ name, rate, reference, external }) => {
          const ctx = new OfflineAudioContext(2, rate, rate);
          const load = async (extension) => {
            const url =
              extension === 'wav'
                ? `/private-audio-masters/${name}.wav`
                : `/src/audio/samples/${name}.opus`;
            const response = await fetch(url);
            if (!response.ok) throw Error(`Missing ${name}.${extension}`);
            return ctx.decodeAudioData(await response.arrayBuffer());
          };
          const [a, b] = await Promise.all([external ? load('wav') : null, load('opus')]);
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
          const native = reference.native[String(rate)];
          const wav = a
            ? measure(a)
            : {
                frames: native[0],
                channels: reference.channels,
                rate,
                rms: native[1],
                peak: native[2],
                finite: true,
              };
          const opus = measure(b);
          let pulsePeaks;
          if (name === 'heartbeat') {
            const x = b.getChannelData(0),
              n = rate / 100,
              bins = [];
            for (let i = 0; i + n <= x.length; i += n) {
              let sum = 0;
              for (let j = i; j < i + n; j++) sum += x[j] * x[j];
              bins.push(sum);
            }
            const peak = (start, end) => {
              let best = start;
              for (let i = start + 1; i < end; i++) if (bins[i] > bins[best]) best = i;
              return best / 100;
            };
            pulsePeaks = [peak(2, 20), peak(20, 45)];
          }
          return {
            name,
            rate,
            wav,
            opus,
            pulsePeaks,
            energyDeltaDb: 20 * Math.log10(opus.rms / wav.rms),
          };
        },
        { name, rate, reference: references[name], external: Boolean(masterDirectory) }
      );
      rows.push(row);
      assert(row.wav.finite && row.opus.finite, `${name}: non-finite PCM`);
      assert.equal(row.opus.channels, row.wav.channels, `${name}: channel identity`);
      assert.equal(row.opus.frames, row.wav.frames, `${name}: pre-skip/full duration`);
      assert.equal(row.opus.rate, rate);
      if (row.pulsePeaks)
        row.pulsePeaks.forEach((time, i) =>
          assert(
            Math.abs(time - references[name].pulsePeaksSec[i]) < 0.05,
            'Delivered heartbeat pulse timing'
          )
        );
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
        masterComparison: masterDirectory
          ? 'verified external WAV archive'
          : 'frozen native master references',
      },
      null,
      2
    ) + '\n'
  );
  await browser?.close();
  await stopViteServer(server);
}
