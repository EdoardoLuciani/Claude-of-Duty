import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const root = process.env.SPATIAL_TEST_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));
const server = await ensureViteServer({ root, port: Number(process.env.PORT ?? 5496) });
let browser;
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/private-spatial-reuse', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'Native spatial emitter reuse regression' })
  );
  await page.goto(`http://127.0.0.1:${Number(process.env.PORT ?? 5496)}/private-spatial-reuse`);
  const rows = await page.evaluate(async () => {
    const { SpatialField } = await import('/src/audio/spatial.ts');
    const rows = [];
    for (const rate of [44100, 48000, 96000]) {
      for (const mode of ['steal', 'release', 'interrupted-target']) {
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
        const oldArrival = 100 / 343;
        const silence = ctx.createBuffer(1, rate, rate);
        const oldEmitters = [];
        for (let i = 0; i < 40; i++) {
          const source = ctx.createBufferSource();
          source.buffer = silence;
          const endTime = oldArrival + silence.duration + 0.04;
          const em = field.acquire({
            x: 100,
            y: 0,
            z: 0,
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
          if (mode === 'interrupted-target')
            for (const [j, param] of params(em).entries())
              param.setTargetAtTime(j < 3 ? (j === 0 ? 100 : 0) : j + 1, 0, 0.5);
        }
        // A panner/filter with prior processing history is not equivalent to a
        // never-used node during its startup transition. Match that legitimate
        // history in the control, but give it NO old future ownership events.
        if (mode === 'interrupted-target') {
          const em = reference.emitters[0];
          em.connectOut(reference.mixer.bus('weapons'), reference.mixer.sendBus('weapons'));
          const source = ctx.createBufferSource();
          source.buffer = silence;
          reference.hold(em, source, oldArrival + silence.duration + 0.04);
          source.start(oldArrival);
          for (const [j, param] of params(em).entries())
            param.setTargetAtTime(j < 3 ? (j === 0 ? 100 : 0) : j + 1, 0, 0.5);
        }
        let replacement,
          fresh,
          when,
          activeBefore,
          sameSlot,
          heldExpected,
          heldError = 0;
        const snapshots = [];
        const callbacks = [0.1, 0.103, 0.4, 0.8].map((time) =>
          ctx.suspend(time).then(() => {
            field.update();
            if (time === 0.1) {
              activeBefore = field.stats.active;
              const selected = oldEmitters[0];
              heldExpected = params(selected).map((param) => param.value);
              if (mode !== 'steal') selected.detach();
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
          oldArrival,
          referenceKind:
            mode === 'interrupted-target' ? 'matched-past-state-no-future-events' : 'fresh',
          replacementArrival: when,
          activeBefore,
          sameSlot,
          heldError,
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
  });
  if (process.env.SPATIAL_EVIDENCE_DIR) {
    mkdirSync(process.env.SPATIAL_EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      `${process.env.SPATIAL_EVIDENCE_DIR}/native-spatial-reuse.json`,
      JSON.stringify({ rows, errors }, null, 2) + '\n'
    );
  }
  for (const row of rows) {
    assert.equal(row.activeBefore, 40);
    assert(row.sameSlot && row.replacementPeak > 0.001, JSON.stringify(row));
    assert.equal(row.stolen, row.mode === 'steal' ? 1 : 0);
    assert.equal(row.dropped, 0);
    assert.equal(row.heldError, 0);
    // Independently rendered native chains can differ by a few Float32 ULPs
    // during startup (observed 3.73e-9 at 96 kHz). The actual stale-event window
    // below remains strictly sample-exact; this is not an audible-error margin.
    assert(row.beforeOldArrivalError < 1e-8, JSON.stringify(row));
    assert.equal(row.afterOldArrivalError, 0, JSON.stringify(row));
    for (const point of row.snapshots) assert.deepEqual(point.actual, point.reference);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(rows, null, 2));
  console.log(
    'PASS: native full-pool steal/release/target interruption matches independent reference at three rates'
  );
} finally {
  await browser?.close();
  stopViteServer(server);
}
