#!/usr/bin/env node
/** Actual WebGPU bomber + actual master graph; optional local unnormalised audio. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  REPO_ROOT,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { captureNative, waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs(),
  root = resolve(args.root ?? REPO_ROOT),
  port = Number(args.port ?? 5542);
const out = args.out ? resolve(args.out) : null;
assert(!out || (out !== root && !out.startsWith(root + '/')), 'Keep evidence outside repository');
if (out) mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ root, port });
assert(server, 'Refusing an occupied port');
let browser;
const errors = [],
  rows = [];
try {
  browser = await launchChromium({
    headless: true,
    args: ['--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=hero`);
  await waitForGame(page, { timeout: 180000 });
  await page.evaluate(() => window.__PUMP__(3));
  await page.evaluate(async () => {
    const engine = window.__ENGINE__,
      ctx = engine.ctx;
    const audio = ctx.get('audio'),
      player = ctx.get('player'),
      ai = ctx.get('ai'),
      world = ctx.get('world');
    for (const actor of ai.agents) actor.dispose();
    ai.agents.length = 0;
    ai.squads.length = 0;
    if (!(await audio.start())) throw Error('Actual game audio failed');
    audio.ambience.dispose();
    const x = (world.bounds.min.x + world.bounds.max.x) / 2;
    const z = (world.bounds.min.z + world.bounds.max.z) / 2;
    const y = ctx.get('physics').groundHeight(x, z, 30) + 1.7;
    const V3 = ctx.camera.position.constructor;
    const eye = new V3(x, y, z),
      yaw = world.spawn(0)?.yaw ?? 0;
    player.health.value = 1000000;
    player.health.armour = 150;
    player.teleport(eye, 0);
    player.setControlEnabled(false);
    ctx.camera.position.copy(eye);
    ctx.camera.lookAt(new V3(x - Math.cos(yaw) * 10, y, z + Math.sin(yaw) * 10));
    audio.update(0, ctx);
    engine.step = Object.getPrototypeOf(engine).step.bind(engine);
    engine._last = performance.now();
    const dest = audio.actx.createMediaStreamDestination();
    audio.mixer.masterGain.connect(dest);
    window.airStream = dest.stream;
    const play = audio._playAt.bind(audio);
    audio._playAt = (...a) => {
      const accepted = play(...a);
      if (window.airReport && a[0] === 'ambient' && a[4]?.which === 'heli')
        window.airReport.heliCalls++;
      return accepted;
    };
    if (typeof audio.startAircraft === 'function') {
      const start = audio.startAircraft.bind(audio);
      audio.startAircraft = (position) => {
        const voice = start(position);
        if (voice && window.airReport) {
          window.airReport.starts++;
          if (!voice.source.loop) throw Error('Aircraft source is not continuous');
          const move = voice.move.bind(voice),
            stop = voice.stop.bind(voice);
          voice.move = (p, paused) => {
            const report = window.airReport;
            if (report) {
              report.moves++;
              if (report.moves % 6 === 0) report.positions.push([p.x, p.y, p.z]);
            }
            return move(p, paused);
          };
          voice.stop = () => {
            if (window.airReport) window.airReport.stops++;
            return stop();
          };
        }
        return voice;
      };
    }
    ctx.events.on('explosion', () => {
      if (window.airReport) window.airReport.explosions++;
    });
  });
  for (const engineOnly of [true, false]) {
    const options = { engineOnly, capture: !!out, baseline: !!args.baseline };
    const row = await page.evaluate(async ({ engineOnly, capture, baseline }) => {
      const engine = window.__ENGINE__,
        ctx = engine.ctx,
        radio = ctx.get('radio'),
        audio = ctx.get('audio');
      radio.clearStrike();
      const drop = radio._dropBomb;
      if (engineOnly) radio._dropBomb = () => {}; // labelled isolated-engine fixture, not full strike.
      const report = (window.airReport = {
        id: engineOnly ? 'engine-only' : 'full-strike',
        starts: 0,
        stops: 0,
        moves: 0,
        heliCalls: 0,
        explosions: 0,
        positions: [],
        frames: 0,
      });
      const chunks = [];
      let recorder;
      if (capture) {
        recorder = new MediaRecorder(window.airStream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 192000,
        });
        recorder.ondataavailable = (e) => chunks.push(e.data);
        await new Promise((ready) => {
          recorder.onstart = ready;
          recorder.start();
        });
      }
      engine._last = performance.now();
      const started = performance.now();
      let pause = false,
        resumed = false,
        pauseTravel,
        pausePose;
      if (!radio.callStrike()) throw Error('Strike rejected');
      const strike = radio.active[0],
        voice = strike.engine,
        source = voice?.source;
      if (engineOnly && !baseline && !voice) throw Error('No aircraft voice for pause checks');
      try {
        while (performance.now() - started < 18000) {
          const now = await new Promise((ready) => requestAnimationFrame(ready));
          const elapsed = (performance.now() - started) / 1000;
          if (engineOnly && elapsed >= 3 && !pause) {
            pause = true;
            pauseTravel = strike.travel;
            pausePose = strike.plane.position.clone();
            if (!baseline) report.beforePauseGain = voice.node.gain.value;
            engine.time.scale = 0;
            ctx.events.emit('ui:pause', { paused: true });
          }
          if (engineOnly && elapsed >= 3.5 && !resumed) {
            resumed = true;
            if (!baseline)
              report.paused = {
                gain: voice.node.gain.value,
                travel: strike.travel,
                sameHandle: strike.engine === voice,
                sameSource: voice.source === source,
              };
            engine.time.scale = 1;
            ctx.events.emit('ui:pause', { paused: false });
          }
          engine.step(now);
          if (engineOnly && pause && !resumed) {
            if (strike.travel !== pauseTravel || !strike.plane.position.equals(pausePose))
              throw Error('Aircraft moved while simulation was paused');
            report.pausedFrames = (report.pausedFrames ?? 0) + 1;
          }
          if (engineOnly && !baseline && resumed && elapsed >= 3.75 && !report.resumed)
            report.resumed = {
              gain: voice.node.gain.value,
              travel: strike.travel,
              sameHandle: strike.engine === voice,
              sameSource: voice.source === source,
            };
          report.frames++;
          if (engine.error) throw Error(JSON.stringify(engine.error));
        }
        if (recorder)
          await new Promise((ready) => {
            recorder.onstop = ready;
            recorder.stop();
          });
        let recording;
        if (capture) {
          const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 32768)
            binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          recording = btoa(binary);
        }
        return {
          ...report,
          pauseTravel,
          recording,
          engineError: engine.error ?? null,
          audio: audio.report(),
          loops: audio._aircraft?.size ?? 0,
          tracked: audio.field.emitters.filter((e) => !e.free && e.tracked).length,
        };
      } finally {
        engine.time.scale = 1;
        radio._dropBomb = drop;
        radio.clearStrike();
        window.airReport = null;
      }
    }, options);
    if (out) {
      const path = resolve(out, row.id + '.webm');
      writeFileSync(path, Buffer.from(row.recording, 'base64'));
      const p = spawnSync('ffmpeg', [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-i',
        path,
        '-c:a',
        'libmp3lame',
        '-q:a',
        '2',
        resolve(out, row.id + '.mp3'),
      ]);
      assert.equal(p.status, 0, p.stderr?.toString());
    }
    delete row.recording;
    assert.equal(row.engineError, null);
    assert.equal(row.audio.errors, 0);
    assert.equal(row.explosions === 0, engineOnly, 'isolated/full-strike fixtures are distinct');
    if (engineOnly) assert(row.pausedFrames > 0, 'sampled frozen plane during pause');
    if (!args.baseline) {
      if (engineOnly) {
        assert(Math.abs(row.beforePauseGain - 1) < 1e-6, 'source gain settled before pause');
        assert(Math.abs(row.paused.gain) < 1e-6, 'source gain settles to silence during pause');
        assert(Math.abs(row.resumed.gain - 1) < 1e-6, 'source gain recovers after resume');
        assert.equal(row.paused.travel, row.pauseTravel, 'travel remains exactly frozen');
        assert(row.resumed.travel > row.paused.travel, 'travel advances after resume');
        assert.equal(row.paused.sameHandle && row.resumed.sameHandle, true);
        assert.equal(row.paused.sameSource && row.resumed.sameSource, true);
        console.log('Aircraft pause evidence:', {
          beforeGain: row.beforePauseGain,
          pauseTravel: row.pauseTravel,
          pausedFrames: row.pausedFrames,
          paused: row.paused,
          resumed: row.resumed,
        });
      }
      assert.equal(row.starts, 1, 'one loop per aircraft pass');
      assert.equal(row.heliCalls, 0);
      assert.equal(row.stops, 1, 'one natural engine stop, independent of late bombs');
      assert.equal(row.loops, 0);
      assert.equal(row.tracked, 0);
      assert(row.moves > 50);
      assert(
        row.positions.at(-1)[0] !== row.positions[0][0] ||
          row.positions.at(-1)[2] !== row.positions[0][2]
      );
    }
    rows.push(row);
  }
  if (!args.baseline) {
    const lifecycle = await page.evaluate(async () => {
      const engine = window.__ENGINE__,
        ctx = engine.ctx,
        radio = ctx.get('radio'),
        audio = ctx.get('audio');
      radio.callStrike();
      const first = radio.active[0].engine;
      ctx.events.emit('game:restart', {});
      const empty = radio.active.length === 0;
      await new Promise((r) => setTimeout(r, 800));
      audio.update(0, ctx);
      const retiredBeforeRestart = first.ended && audio._aircraft.size === 0;
      radio.callStrike();
      const second = radio.active[0].engine;
      audio.dispose();
      radio.clearStrike();
      return {
        empty,
        retiredBeforeRestart,
        ended: first.ended,
        disposed: second.ended,
        loops: audio._aircraft.size,
      };
    });
    assert.deepEqual(lifecycle, {
      empty: true,
      retiredBeforeRestart: true,
      ended: true,
      disposed: true,
      loops: 0,
    });
  }
  if (out) {
    await page.evaluate(() => {
      const engine = window.__ENGINE__,
        ctx = engine.ctx,
        radio = ctx.get('radio');
      radio.callStrike();
      const s = radio.active[0];
      s.travel = s.drops[Math.floor(s.drops.length / 2)];
      radio.update(0);
      ctx.camera.lookAt(s.plane.position);
      engine.setGameplaySuspended(true);
    });
    await page.evaluate(() => window.__PUMP__(1));
    await captureNative(page, resolve(out, 'snapshot.png'));
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS: actual bomber engine/full-strike, pause, source ownership, natural stop and restart/disposal${args.baseline ? ' (baseline capture)' : ''}.`
  );
} finally {
  await browser?.close();
  stopViteServer(server);
  if (out)
    writeFileSync(resolve(out, 'report.json'), JSON.stringify({ rows, errors }, null, 2) + '\n');
}
