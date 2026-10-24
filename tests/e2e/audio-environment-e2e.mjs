#!/usr/bin/env node
/** Actual game master: fixed open-path environmental palette, then real scheduler contract. */
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
import { waitForGame, captureNative } from '../../tools/lib/native-render.mjs';
const args = parseArgs(),
  root = resolve(args.root ?? REPO_ROOT),
  port = Number(args.port ?? 5547),
  out = args.out ? resolve(args.out) : null;
assert(!out || (out !== root && !out.startsWith(root + '/')));
if (out) mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ root, port });
assert(server);
let browser;
const errors = [];
try {
  browser = await launchChromium({
    headless: true,
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=hero`);
  await waitForGame(page, { timeout: 180000 });
  const report = await page.evaluate(
    async ({ capture, baseline }) => {
      const engine = window.__ENGINE__,
        ctx = engine.ctx,
        audio = ctx.get('audio'),
        ai = ctx.get('ai'),
        world = ctx.get('world'),
        physics = ctx.get('physics'),
        player = ctx.get('player');
      for (const a of ai.agents) a.dispose();
      ai.agents.length = 0;
      ai.squads.length = 0;
      const x = (world.bounds.min.x + world.bounds.max.x) / 2,
        z = (world.bounds.min.z + world.bounds.max.z) / 2,
        y = physics.groundHeight(x, z, 30) + 1.7,
        V3 = ctx.camera.position.constructor;
      player.teleport(new V3(x, y, z), 0);
      player.setControlEnabled(false);
      ctx.camera.position.set(x, y, z);
      ctx.camera.lookAt(new V3(x, y, z - 10));
      if (!(await audio.start())) throw Error('Audio failed');
      audio.ambience.dispose();
      audio.update(0, ctx);
      const { AMBIENT_EVENT_GAIN } = await import('/src/audio/ambience.ts');
      const records = [],
        method = audio.samples.environment;
      if (method)
        audio.samples.environment = function (kind, rng, o) {
          const voice = method.call(this, kind, rng, o);
          records.push({ kind, end: voice.end });
          return voice;
        };
      const destination = audio.actx.createMediaStreamDestination();
      audio.mixer.masterGain.connect(destination);
      const chunks = [];
      let recorder;
      if (capture) {
        recorder = new MediaRecorder(destination.stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 192000,
        });
        recorder.ondataavailable = (e) => chunks.push(e.data);
        await new Promise((r) => {
          recorder.onstart = r;
          recorder.start();
        });
      }
      const wait = (ms) => new Promise((r) => setTimeout(r, ms)),
        timeline = [];
      let offset = 0;
      for (const [kind, seconds] of [
        ['dog', 3],
        ['birds', 3.5],
        ['creak', 4.5],
        ['settle', 5],
        ['vehicle', 11],
        ['heli', 17],
        ['siren', 13],
      ]) {
        audio.update(0, ctx);
        const far = kind === 'heli' || kind === 'siren',
          distance = far ? 90 : 14;
        if (
          !audio._playAt(
            'ambient',
            x + distance,
            y + (kind === 'heli' ? 15 : 0),
            z,
            {
              which: kind,
              level: 1,
              gain: AMBIENT_EVENT_GAIN[kind] ?? AMBIENT_EVENT_GAIN.near,
              occlusion: 0,
            },
            'ambience',
            0.15
          )
        )
          throw Error('Palette voice denied');
        timeline.push({ kind, start: offset, seconds, distance });
        offset += seconds;
        await wait(seconds * 1000);
      }
      if (recorder)
        await new Promise((r) => {
          recorder.onstop = r;
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
      const before = records.length,
        choose = audio.rng.pick;
      audio.rng.pick = () => 'dog';
      try {
        audio.ambience.start();
        audio.ambience._timers.oneshot = 0;
        audio.ambience._timers.volley = 999;
        audio.ambience._timers.boom = 999;
        if (baseline) audio.ambience._timers.chatter = 999;
        audio.update(0.01, ctx);
      } finally {
        audio.rng.pick = choose;
        audio.ambience.dispose();
      }
      await wait(2500);
      audio.update(0, ctx);
      return {
        timeline,
        records,
        scheduler: records.slice(before),
        noPhantom: typeof audio._distantChatter === 'undefined',
        recording,
        audio: audio.report(),
        active: audio.field.emitters.filter((e) => !e.free).length,
        engineError: engine.error ?? null,
      };
    },
    { capture: !!out, baseline: !!args.baseline }
  );
  assert.equal(report.audio.errors, 0);
  assert.equal(report.engineError, null);
  assert.equal(report.active, 0);
  if (!args.baseline) {
    assert.equal(report.records.length, 8);
    assert.deepEqual(
      report.scheduler.map((r) => r.kind),
      ['dog']
    );
    assert(report.noPhantom);
  }
  if (out) {
    writeFileSync(resolve(out, 'palette.webm'), Buffer.from(report.recording, 'base64'));
    const f = spawnSync('ffmpeg', [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-i',
      resolve(out, 'palette.webm'),
      '-c:a',
      'libmp3lame',
      '-q:a',
      '2',
      resolve(out, 'palette.mp3'),
    ]);
    assert.equal(f.status, 0);
    await page.evaluate(() => window.__PUMP__(1));
    await captureNative(page, resolve(out, 'snapshot.png'));
  }
  delete report.recording;
  assert.deepEqual(errors, []);
  if (out) writeFileSync(resolve(out, 'report.json'), JSON.stringify({ report, errors }, null, 2));
  console.log(
    'PASS actual master environmental palette, real scheduler, no phantom voices, finite cleanup',
    JSON.stringify({ events: report.records.length, active: report.active })
  );
} finally {
  await browser?.close();
  stopViteServer(server);
}
