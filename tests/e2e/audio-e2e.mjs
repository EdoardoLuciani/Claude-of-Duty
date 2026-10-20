import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import reference from '../../src/audio/samples/reference.json' with { type: 'json' };
import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const masters = new Map();
if (process.env.AUDIO_MASTER_DIR)
  for (const [name, ref] of Object.entries(reference.files)) {
    const data = readFileSync(resolve(process.env.AUDIO_MASTER_DIR, name + '.wav'));
    assert.equal(
      createHash('sha256').update(data).digest('hex'),
      ref.sha256,
      name + ': master changed'
    );
    masters.set(name + '.wav', data);
  }
const port = Number(process.env.PORT ?? 5495);
const server = await ensureViteServer({ root, port });
assert(server, 'Refusing an unverified server on an occupied port');
const results = {},
  errors = [];
let browser;
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/private-audio', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'Native audio regressions' })
  );
  if (masters.size)
    await page.route('**/private-audio-masters/*.wav', (route) => {
      const data = masters.get(new URL(route.request().url()).pathname.split('/').at(-1));
      return data ? route.fulfill({ contentType: 'audio/wav', body: data }) : route.abort();
    });
  await page.goto(`http://127.0.0.1:${port}/private-audio`);

  // hearing: real native nodes and automation; no Web Audio substitutes.
  results.hearing = await page.evaluate(async (rates) => {
    const [{ Mixer }, { Rng }] = await Promise.all([
      import('/src/audio/mixer.ts'),
      import('/src/core/rng.ts'),
    ]);
    const rows = [];
    for (const rate of rates)
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
          highStep = 0;
        for (let ch = 0; ch < 4; ch++)
          for (const value of output.getChannelData(ch))
            if (!Number.isFinite(value)) throw Error('Nonfinite native hearing output');
        for (let i = 1; i < output.length; i++) {
          const low = Math.abs(output.getChannelData(2)[i] - output.getChannelData(2)[i - 1]);
          const high = Math.abs(output.getChannelData(3)[i] - output.getChannelData(3)[i - 1]);
          lowStep = Math.max(lowStep, low);
          highStep = Math.max(highStep, high);
        }
        rows.push({
          rate,
          mode,
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
          lowRatio: mode === 'healthy' ? null : rms(2, 1.5, 1.7) / rms(0, 1.5, 1.7),
          highRatio: mode === 'healthy' ? null : rms(3, 1.5, 1.7) / rms(1, 1.5, 1.7),
        });
        mixer.dispose();
      }
    return rows;
  }, reference.rates);
  for (const row of results.hearing) {
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
  assert.equal(results.hearing.length, 12);

  // spatial: real native nodes and automation; no Web Audio substitutes.
  results.spatial = await page.evaluate(async (rates) => {
    const { SpatialField } = await import('/src/audio/spatial.ts');
    const rows = [];
    for (const rate of rates) {
      for (const mode of [
        'steal',
        'release',
        'interrupted-target',
        'interrupted-target-fallback',
      ]) {
        const ctx = new OfflineAudioContext(6, Math.ceil(rate * 1.4), rate);
        const merge = ctx.createChannelMerger(6);
        merge.connect(ctx.destination);
        const makeField = (offset, sendChannel) => {
          const bus = ctx.createGain(),
            reverbSend = ctx.createGain(),
            split = ctx.createChannelSplitter(2);
          bus.connect(split);
          split.connect(merge, 0, offset);
          split.connect(merge, 1, offset + 1);
          reverbSend.connect(merge, 0, sendChannel);
          const field = new SpatialField(ctx, { bus: () => bus, sendBus: () => reverbSend }, null);
          field.setListener(0, 0, 0, 0, 0, -1, 0, 1, 0);
          return field;
        };
        const field = makeField(0, 4),
          reference = makeField(2, 5);
        const params = (em) => [
          em.panner.positionX,
          em.panner.positionY,
          em.panner.positionZ,
          em.airLP.frequency,
          em.occLP.frequency,
          em.occHS.gain,
          em.distGain.gain,
          em.sendGain.gain,
        ];
        const oldPosition = [100, 10, -20];
        const oldArrival = 100 / 343;
        const silence = ctx.createBuffer(1, rate, rate);
        const oldEmitters = [];
        for (let i = 0; i < 40; i++) {
          const source = ctx.createBufferSource();
          source.buffer = silence;
          const endTime = oldArrival + silence.duration + 0.04;
          const em = field.acquire({
            x: oldPosition[0],
            y: oldPosition[1],
            z: oldPosition[2],
            when: oldArrival,
            endTime,
            priority: 0.95,
            gain: 1,
            send: 0.3,
            occlusion: 0.7,
          });
          field.hold(em, source, endTime);
          source.start(oldArrival);
          oldEmitters.push(em);
          if (mode.endsWith('-fallback'))
            for (const param of params(em)) param.cancelAndHoldAtTime = undefined;
          if (mode.startsWith('interrupted-target'))
            for (const [j, param] of params(em).entries())
              param.setTargetAtTime(j < 3 ? oldPosition[j] : j + 1, 0, 0.5);
        }
        // A panner/filter with prior processing history is not equivalent to a
        // never-used node during its startup transition. Match that legitimate
        // history in the control, but give it NO old future ownership events.
        if (mode.startsWith('interrupted-target')) {
          const em = reference.emitters[0];
          em.connectOut(reference.mixer.bus('weapons'), reference.mixer.sendBus('weapons'));
          const source = ctx.createBufferSource();
          source.buffer = silence;
          reference.hold(em, source, oldArrival + silence.duration + 0.04);
          source.start(oldArrival);
          for (const [j, param] of params(em).entries())
            param.setTargetAtTime(j < 3 ? oldPosition[j] : j + 1, 0, 0.5);
        }
        let replacement,
          fresh,
          when,
          activeBefore,
          sameSlot,
          heldExpected,
          retiredClean = true,
          heldError = 0;
        const snapshots = [];
        const callbacks = [0.1, 0.103, 0.4, 0.8].map((time) =>
          ctx.suspend(time).then(() => {
            field.update();
            if (time === 0.1) {
              activeBefore = field.stats.active;
              const selected = oldEmitters[0];
              heldExpected = params(selected).map((param) => param.value);
              if (mode !== 'steal') {
                selected.detach();
                retiredClean = selected.free && !selected._connected && !selected._sendConnected;
              }
              when = ctx.currentTime + 2 / 343;
              const input = ctx.createBuffer(1, rate, rate);
              for (let i = 0; i < input.length; i++)
                input.getChannelData(0)[i] =
                  0.01 * Math.sin((2 * Math.PI * 375 * i) / rate) +
                  0.005 * Math.sin((2 * Math.PI * 4000 * i) / rate);
              const options = {
                x: 2,
                y: 0,
                z: 0,
                when,
                endTime: when + input.duration + 0.04,
                priority: 1,
                gain: 0.8,
                send: 0.2,
                occlusion: 0,
              };
              replacement = field.acquire(options);
              // Independently establish the same explicit current-time baseline
              // on the control, without using Emitter.detach or its helper.
              for (const param of params(reference.emitters[0])) {
                const value = param.value;
                param.cancelAndHoldAtTime(ctx.currentTime);
                param.setValueAtTime(value, ctx.currentTime);
              }
              reference.emitters[0].attached?.disconnect();
              fresh = reference.acquire(options);
              sameSlot = replacement === selected;
              for (const [owner, em] of [
                [field, replacement],
                [reference, fresh],
              ]) {
                const source = ctx.createBufferSource();
                source.buffer = input;
                owner.hold(em, source, options.endTime);
                source.start(when);
              }
            } else if (time === 0.103) {
              // A started target must stop evolving during the new voice's delay.
              for (const [i, param] of params(replacement).entries())
                heldError = Math.max(heldError, Math.abs(param.value - heldExpected[i]));
            } else {
              snapshots.push({
                time: ctx.currentTime,
                actual: params(replacement).map((param) => param.value),
                reference: params(fresh).map((param) => param.value),
              });
            }
            return ctx.resume();
          })
        );
        const rendered = await ctx.startRendering();
        await Promise.all(callbacks);
        const error = (start, end, pairs) => {
          let maximum = 0;
          for (const [a, b] of pairs)
            for (let i = Math.ceil(start * rate); i < Math.floor(end * rate); i++)
              maximum = Math.max(
                maximum,
                Math.abs(rendered.getChannelData(a)[i] - rendered.getChannelData(b)[i])
              );
          return maximum;
        };
        rows.push({
          rate,
          mode,
          activeBefore,
          sameSlot,
          heldError,
          retiredClean,
          stolen: field.stats.stolen,
          dropped: field.stats.dropped,
          beforeOldArrivalError: error(when + 0.03, oldArrival - 0.01, [
            [0, 2],
            [1, 3],
            [4, 5],
          ]),
          afterOldArrivalError: error(oldArrival + 0.03, 1, [
            [0, 2],
            [1, 3],
            [4, 5],
          ]),
          replacementPeak: rendered
            .getChannelData(0)
            .reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
          snapshots,
        });
        field.dispose();
        reference.dispose();
      }
    }
    return rows;
  }, reference.rates);
  for (const row of results.spatial) {
    assert.equal(row.activeBefore, 40);
    assert(row.sameSlot && row.replacementPeak > 0.001, JSON.stringify(row));
    assert.equal(row.stolen, row.mode === 'steal' ? 1 : 0);
    assert.equal(row.dropped, 0);
    assert.equal(row.heldError, 0);
    assert(row.retiredClean, 'Retired emitter retains a connection');
    // Independently rendered native chains can differ by a few Float32 ULPs
    // during startup (observed 3.73e-9 at 96 kHz). The actual stale-event window
    // below remains strictly sample-exact; this is not an audible-error margin.
    assert(row.beforeOldArrivalError < 1e-8, JSON.stringify(row));
    assert.equal(row.afterOldArrivalError, 0, JSON.stringify(row));
    for (const point of row.snapshots) assert.deepEqual(point.actual, point.reference);
  }
  assert.equal(results.spatial.length, 12);

  // buses: real native nodes and automation; no Web Audio substitutes.
  results.buses = await page.evaluate(async (rates) => {
    const [{ Mixer }, { Rng }] = await Promise.all([
      import('/src/audio/mixer.ts'),
      import('/src/core/rng.ts'),
    ]);
    const rows = [];
    for (const rate of rates)
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
  }, reference.rates);
  for (const row of results.buses) {
    assert.equal(row.maxDifference, 0, `${row.rate}/${row.name}: mismatched dry/wet automation`);
    assert(row.mutedPeak < 1e-5, `${row.rate}/${row.name}: mute defeated by duck recovery`);
    assert(row.restoredPeak > 1e-4, `${row.rate}/${row.name}: category did not recover`);
  }
  assert.equal(results.buses.length, 18);

  results.codecs = await page.evaluate(
    async ({ files, rates, external }) => {
      const rows = [];
      for (const rate of rates)
        for (const [name, reference] of Object.entries(files)) {
          const ctx = new OfflineAudioContext(2, rate, rate);
          const load = async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw Error('Missing audio: ' + url);
            return ctx.decodeAudioData(await response.arrayBuffer());
          };
          const [master, opus] = await Promise.all([
            external ? load('/private-audio-masters/' + name + '.wav') : null,
            load('/src/audio/samples/' + name + '.opus'),
          ]);
          function measure(buffer) {
            let energy = 0,
              peak = 0;
            for (let ch = 0; ch < buffer.numberOfChannels; ch++)
              for (const value of buffer.getChannelData(ch)) {
                if (!Number.isFinite(value)) throw Error('Nonfinite PCM: ' + name);
                energy += value * value;
                peak = Math.max(peak, Math.abs(value));
              }
            return {
              frames: buffer.length,
              channels: buffer.numberOfChannels,
              rate: buffer.sampleRate,
              rms: Math.sqrt(energy / (buffer.length * buffer.numberOfChannels)),
              peak,
            };
          }
          const a = master
            ? measure(master)
            : {
                frames: reference.native[rate][0],
                rms: reference.native[rate][1],
                channels: reference.channels,
                rate,
              };
          const b = measure(opus);
          let pulsePeaks;
          if (name === 'heartbeat') {
            const data = opus.getChannelData(0),
              bins = [],
              width = rate / 100;
            for (let i = 0; i + width <= data.length; i += width) {
              let energy = 0;
              for (let j = i; j < i + width; j++) energy += data[j] ** 2;
              bins.push(energy);
            }
            pulsePeaks = [
              [2, 20],
              [20, 45],
            ].map(([start, end]) => {
              let best = start;
              for (let i = start + 1; i < end; i++) if (bins[i] > bins[best]) best = i;
              return best / 100;
            });
          }
          rows.push({
            name,
            rate,
            master: a,
            opus: b,
            pulsePeaks,
            energyDeltaDb: 20 * Math.log10(b.rms / a.rms),
          });
        }
      return rows;
    },
    { ...reference, external: masters.size > 0 }
  );
  for (const row of results.codecs) {
    assert.equal(row.opus.frames, row.master.frames, row.name + ': full duration/pre-skip');
    assert.equal(row.opus.channels, row.master.channels, row.name + ': channel identity');
    assert.equal(row.opus.rate, row.rate);
    assert(Math.abs(row.energyDeltaDb) < 0.5, row.name + ': energy drift above 0.5 dB');
    row.pulsePeaks?.forEach((time, i) =>
      assert(
        Math.abs(time - reference.files[row.name].pulsePeaksSec[i]) < 0.05,
        'Delivered heartbeat pulse timing'
      )
    );
  }
  assert(
    results.codecs.some((row) => row.opus.peak > 1),
    'Float headroom must survive decode'
  );

  assert.equal(results.codecs.length, 120);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 12 hearing, 12 emitter-ownership, 18 category-envelope and 120 codec cases at 44.1/48/96 kHz.'
  );
} finally {
  await browser?.close();
  await stopViteServer(server);
  if (process.env.AUDIO_EVIDENCE_DIR) {
    const out = resolve(process.env.AUDIO_EVIDENCE_DIR);
    assert(out !== resolve(root) && !out.startsWith(root), 'Keep evidence outside the repository');
    mkdirSync(out, { recursive: true });
    writeFileSync(
      resolve(out, 'results.json'),
      JSON.stringify({ results, errors }, null, 2) + '\n'
    );
  }
}
