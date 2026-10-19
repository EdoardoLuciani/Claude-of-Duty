import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.PORT ?? 5495);
const server = await ensureViteServer({ root, port });
let browser;
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/private-hearing', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: 'Native hearing transparency / concussion / recovery',
    })
  );
  await page.goto(`http://127.0.0.1:${port}/private-hearing`);
  const rows = await page.evaluate(async () => {
    const [{ Mixer }, { Rng }] = await Promise.all([
      import('/src/audio/mixer.ts'),
      import('/src/core/rng.ts'),
    ]);
    const rows = [];
    for (const rate of [44100, 48000, 96000])
      for (const mode of ['healthy', 'recovery', 'retrigger', 'injury-retrigger']) {
        const seconds = mode === 'healthy' ? 1 : 14;
        const ctx = new OfflineAudioContext(4, seconds * rate, rate);
        await Mixer.prepare(ctx);
        const mixer = new Mixer(ctx, new Rng(909));
        const input = ctx.createBuffer(2, ctx.length, rate);
        for (let i = 0; i < input.length; i++) {
          const t = i / rate;
          if (mode === 'healthy') {
            // Broadband/near-Nyquist content and independent stereo expose phase,
            // peak, channel or passband changes that a low sine would miss.
            input.getChannelData(0)[i] =
              0.2 * Math.sin(2 * Math.PI * 250 * t) + 0.1 * Math.sin(2 * Math.PI * rate * 0.47 * t);
            input.getChannelData(1)[i] =
              -0.1 * Math.sin(2 * Math.PI * 7100 * t) + 0.07 * (i % 2 ? -1 : 1);
          } else {
            input.getChannelData(0)[i] = 0.02 * Math.sin(2 * Math.PI * 250 * t);
            input.getChannelData(1)[i] = 0.02 * Math.sin(2 * Math.PI * 8000 * t);
          }
        }
        if (mode === 'healthy') input.getChannelData(0)[128] = 1.1942;
        const source = ctx.createBufferSource();
        source.buffer = input;
        const raw = ctx.createChannelSplitter(2),
          processed = ctx.createChannelSplitter(2),
          merge = ctx.createChannelMerger(4);
        source.connect(mixer.worldSum);
        mixer.worldSum.connect(raw);
        mixer.muffleGain.connect(processed);
        mixer.masterGain.disconnect();
        for (let ch = 0; ch < 2; ch++) {
          raw.connect(merge, ch, ch);
          processed.connect(merge, ch, ch + 2);
        }
        merge.connect(ctx.destination);
        source.start();
        const frequencies = new Float32Array([1, 1000, rate * 0.2, rate * 0.49]);
        const magnitude = new Float32Array(4),
          phase = new Float32Array(4);
        mixer.muffleLP.getFrequencyResponse(frequencies, magnitude, phase);
        const initialMagnitudeError = Math.max(...magnitude.map((x) => Math.abs(x - 1)));
        const initialPhaseError = Math.max(...phase.map(Math.abs));
        const initialDry = mixer.muffleDry.gain.value,
          initialWet = mixer.muffleWet.gain.value;
        const recoveries = [],
          snapshots = [],
          callbacks = [];
        let requested = false,
          retriggered = false,
          retriggerAt = Infinity,
          tinnitusSeen = false;
        if (mode !== 'healthy')
          for (let tick = 1; tick < seconds * 60; tick++) {
            callbacks.push(
              ctx.suspend(tick / 60).then(() => {
                if (!requested && ctx.currentTime >= 1) {
                  mixer.concuss(1, 0.2, 0.045);
                  requested = true;
                }
                if (mode === 'injury-retrigger' && ctx.currentTime >= 2 && !retriggered) {
                  mixer.concuss(1, 0, 0.02);
                  retriggered = true;
                }
                if (ctx.currentTime >= retriggerAt && !retriggered) {
                  mixer.concuss(0.65, 0, 0.02);
                  retriggered = true;
                }
                const previous = mixer.deafness;
                mixer.update(1 / 60);
                if (mixer._tin) tinnitusSeen = true;
                if (previous > 0 && mixer.deafness === 0) {
                  recoveries.push(ctx.currentTime);
                  if (mode === 'retrigger' && !retriggered) retriggerAt = ctx.currentTime + 0.01;
                }
                if (
                  mixer.deafness === 0 &&
                  recoveries.length &&
                  ctx.currentTime > recoveries.at(-1) + 0.1
                )
                  snapshots.push({
                    time: ctx.currentTime,
                    frequency: mixer.muffleLP.frequency.value,
                    shelf: mixer.muffleHS.gain.value,
                    gain: mixer.muffleGain.gain.value,
                    dry: mixer.muffleDry.gain.value,
                    wet: mixer.muffleWet.gain.value,
                  });
                return ctx.resume();
              })
            );
          }
        const output = await ctx.startRendering();
        await Promise.all(callbacks);
        const error = (start, end) => {
          let maximum = 0;
          for (let ch = 0; ch < 2; ch++)
            for (let i = Math.ceil(start * rate); i < Math.floor(end * rate); i++)
              maximum = Math.max(
                maximum,
                Math.abs(output.getChannelData(ch)[i] - output.getChannelData(ch + 2)[i])
              );
          return maximum;
        };
        const rms = (ch, start, end) => {
          let power = 0,
            count = 0;
          for (let i = Math.ceil(start * rate); i < Math.floor(end * rate); i++) {
            power += output.getChannelData(ch)[i] ** 2;
            count++;
          }
          return Math.sqrt(power / count);
        };
        let lowStep = 0,
          highStep = 0,
          lowStepTime = 0,
          highStepTime = 0,
          lowEdge = [];
        for (let ch = 0; ch < 4; ch++)
          for (const value of output.getChannelData(ch))
            if (!Number.isFinite(value)) throw Error('Nonfinite native hearing output');
        for (let i = 1; i < output.length; i++) {
          const low = Math.abs(output.getChannelData(2)[i] - output.getChannelData(2)[i - 1]);
          const high = Math.abs(output.getChannelData(3)[i] - output.getChannelData(3)[i - 1]);
          if (low > lowStep) {
            lowStep = low;
            lowStepTime = i / rate;
            lowEdge = [
              output.getChannelData(2)[i - 1],
              output.getChannelData(2)[i],
              output.getChannelData(0)[i],
            ];
          }
          if (high > highStep) {
            highStep = high;
            highStepTime = i / rate;
          }
        }
        rows.push({
          rate,
          mode,
          initialMagnitudeError,
          initialPhaseError,
          initialDry,
          initialWet,
          healthyError: error(0, mode === 'healthy' ? 1 : 1.15),
          recoveredError: mode === 'healthy' ? null : error(recoveries.at(-1) + 0.05, 13.9),
          recoveries,
          snapshots,
          retriggered,
          tinnitusSeen,
          lowStep,
          highStep,
          lowStepTime,
          highStepTime,
          lowEdge,
          lowRatio: mode === 'healthy' ? null : rms(2, 1.5, 1.7) / rms(0, 1.5, 1.7),
          highRatio: mode === 'healthy' ? null : rms(3, 1.5, 1.7) / rms(1, 1.5, 1.7),
        });
        mixer.dispose();
      }
    return rows;
  });
  if (process.env.HEARING_EVIDENCE_DIR) {
    mkdirSync(process.env.HEARING_EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      `${process.env.HEARING_EVIDENCE_DIR}/native-hearing.json`,
      JSON.stringify({ rows, errors }, null, 2) + '\n'
    );
  }
  for (const row of rows) {
    assert.equal(row.initialDry, 1);
    assert.equal(row.initialWet, 0);
    // The concussion branch need not be flat: it is completely muted when healthy.
    assert.equal(row.healthyError, 0, 'dry healthy output is sample-exact');
    if (row.mode === 'healthy') continue;
    assert(row.tinnitusSeen && row.recoveries.length === (row.mode === 'retrigger' ? 2 : 1));
    assert.equal(row.retriggered, row.mode !== 'recovery');
    assert.equal(row.recoveredError, 0, 'recovered output is sample-exact');
    assert(row.lowRatio > 0.6 && row.lowRatio < 0.85, JSON.stringify(row));
    assert(row.highRatio < 0.1, 'concussion still strongly muffles highs');
    assert(row.snapshots.length > 1);
    for (const point of row.snapshots)
      assert(point.dry === 1 && point.wet === 0 && point.gain === 1);
    assert(
      row.lowStep < 1.2 * 0.04 * Math.sin((Math.PI * 250) / row.rate) + 0.0001,
      JSON.stringify(row)
    );
    assert(
      row.highStep < 1.3 * 0.04 * Math.sin((Math.PI * 8000) / row.rate) + 0.001,
      JSON.stringify(row)
    );
  }
  assert.deepEqual(errors, []);
  if (process.env.HEARING_EVIDENCE_DIR) {
    mkdirSync(process.env.HEARING_EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      `${process.env.HEARING_EVIDENCE_DIR}/native-hearing.json`,
      JSON.stringify({ rows, errors }, null, 2) + '\n'
    );
  }
  console.log(JSON.stringify(rows, null, 2));
  console.log(
    'PASS: native sample-exact healthy/recovered hearing, preserved concussion/tinnitus, finite settle, retrigger during settle and bounded transitions at three rates'
  );
} finally {
  await browser?.close();
  stopViteServer(server);
}
