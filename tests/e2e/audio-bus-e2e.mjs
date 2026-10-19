import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.PORT ?? 5501);
const server = await ensureViteServer({ root, port });
assert(server, 'Refusing an unverified server on an occupied port');
let browser;
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/private-category-automation', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'Native shared dry/wet category automation' })
  );
  await page.goto(`http://127.0.0.1:${port}/private-category-automation`);
  const rows = await page.evaluate(async () => {
    const [{ Mixer }, { Rng }] = await Promise.all([
      import('/src/audio/mixer.ts'),
      import('/src/core/rng.ts'),
    ]);
    const rows = [];
    for (const rate of [44100, 48000, 96000])
      for (const name of ['weapons', 'foley', 'ambience', 'voice', 'ui', 'music']) {
        const ctx = new OfflineAudioContext(4, Math.round(rate * 2.2), rate);
        await Mixer.prepare(ctx);
        const mixer = new Mixer(ctx, new Rng(1907)),
          bus = mixer.buses[name];
        mixer.masterGain.disconnect(ctx.destination);
        // Isolate the two logical category envelopes, not native compression or
        // room convolution: feed identical stereo probes AFTER the dry compressor.
        const input = ctx.createBuffer(2, ctx.length, rate);
        for (let i = 0; i < input.length; i++) {
          input.getChannelData(0)[i] = 0.025 * Math.sin((2 * Math.PI * 541 * i) / rate);
          input.getChannelData(1)[i] = 0.019 * Math.sin((2 * Math.PI * 1693 * i) / rate);
        }
        const src = ctx.createBufferSource();
        src.buffer = input;
        src.connect(bus.level);
        src.connect(mixer.sendBus(name));
        const merge = ctx.createChannelMerger(4);
        for (const [node, offset] of [
          [bus.level, 0],
          [bus.send, 2],
        ]) {
          const split = ctx.createChannelSplitter(2);
          node.connect(split);
          split.connect(merge, 0, offset);
          split.connect(merge, 1, offset + 1);
        }
        merge.connect(ctx.destination);
        src.start();
        let previous = 0;
        const callbacks = [];
        for (let tick = 1; tick < 110; tick++)
          callbacks.push(
            ctx
              .suspend((Math.floor((tick * 0.02 * rate) / 128) * 128 + 0.5) / rate)
              .then(async () => {
                mixer.update(ctx.currentTime - previous);
                previous = ctx.currentTime;
                if (tick === 3) {
                  mixer.setBusVolume(name, 0.4);
                  mixer.duck(0.6, 0.1);
                }
                if (tick === 6) mixer.setBusVolume(name, 0);
                if (tick === 60) mixer.setBusVolume(name, 1);
                if (tick === 65) {
                  mixer.setBusVolume(name, 0.7);
                  mixer.duck(0.8, 0.08);
                }
                if (tick === 71) mixer.setBusVolume(name, 0);
                await ctx.resume();
              })
          );
        const output = await ctx.startRendering();
        await Promise.all(callbacks);
        let maxDifference = 0,
          mutedPeak = 0,
          restoredPeak = 0;
        for (let ch = 0; ch < 2; ch++) {
          const dry = output.getChannelData(ch),
            wet = output.getChannelData(ch + 2);
          for (let i = 0; i < dry.length; i++) {
            maxDifference = Math.max(maxDifference, Math.abs(dry[i] - wet[i]));
            if (i > rate * 1.05 && i < rate * 1.12)
              mutedPeak = Math.max(mutedPeak, Math.abs(wet[i]));
            if (i > rate * 1.25 && i < rate * 1.28)
              restoredPeak = Math.max(restoredPeak, Math.abs(wet[i]));
          }
        }
        rows.push({ rate, name, maxDifference, mutedPeak, restoredPeak });
        mixer.dispose();
      }
    return rows;
  });
  const evidence = resolve(process.env.AUDIO_BUS_EVIDENCE_DIR ?? '/tmp/cod-audio-buses');
  assert(!evidence.startsWith(root), 'Keep diagnostic evidence outside the repository');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(
    resolve(evidence, 'results.json'),
    JSON.stringify({ rows, errors }, null, 2) + '\n'
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  for (const row of rows) {
    assert.equal(row.maxDifference, 0, `${row.rate}/${row.name}: mismatched dry/wet automation`);
    assert(row.mutedPeak < 1e-5, `${row.rate}/${row.name}: mute defeated by duck recovery`);
    assert(row.restoredPeak > 1e-4, `${row.rate}/${row.name}: category did not recover`);
  }
  console.log(
    'Native category envelopes: 18 exact dry/wet comparisons; volume/mute/duck recovery passed.'
  );
} finally {
  await browser?.close();
  await stopViteServer(server);
}
