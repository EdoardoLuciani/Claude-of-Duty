#!/usr/bin/env node
/** Actual game/master graph: controlled reaction palette and real bullet-caused hurt/death. */
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
  out = args.out ? resolve(args.out) : null;
assert(!out || (out !== root && !out.startsWith(root + '/')));
if (out) mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ root, port: Number(args.port ?? 5545) });
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
  await page.goto(`http://127.0.0.1:${Number(args.port ?? 5545)}/?capture=1&lockstep=1&shot=hero`);
  await waitForGame(page, { timeout: 180000 });
  const report = await page.evaluate(
    async ({ capture, baseline }) => {
      const engine = window.__ENGINE__,
        ctx = engine.ctx,
        audio = ctx.get('audio'),
        ai = ctx.get('ai'),
        physics = ctx.get('physics'),
        player = ctx.get('player');
      const { combatLane } = await import('/tools/lib/combat-fixture.js');
      for (const a of ai.agents) a.dispose();
      ai.agents.length = 0;
      ai.squads.length = 0;
      const { positions } = combatLane(ai, ctx.get('world'), physics, [[9, 0]]),
        V3 = ctx.camera.position.constructor;
      const eye = positions[0].clone().add(new V3(0, 1.6, 0));
      player.teleport(eye, 0);
      player.setControlEnabled(false);
      ctx.camera.position.copy(eye);
      ctx.camera.lookAt(positions[1].clone().add(new V3(0, 1.4, 0)));
      if (!(await audio.start())) throw Error('Audio failed');
      audio.ambience.dispose();
      audio.update(0, ctx);
      const records = [],
        original = audio.samples.reaction;
      if (original)
        audio.samples.reaction = function (kind, voice, rng, o) {
          const result = original.call(this, kind, voice, rng, o);
          records.push({
            kind,
            voice,
            key: `reaction-${Math.abs(voice | 0) % 2}-${kind}`,
            end: result.end,
          });
          return result;
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
      for (const actor of [0, 1])
        for (const kind of ['hurt', 'death'])
          for (let variant = 0; variant < 3; variant++) {
            const draw = audio.rng.u32;
            if (!baseline) {
              audio.samples.hitIndices[`reaction-${actor}-${kind}`] = -1;
              audio.rng.u32 = () => variant;
            }
            try {
              audio.update(0, ctx);
              if (
                !audio.bark(
                  kind,
                  { x: eye.x + 3, y: eye.y, z: eye.z },
                  { voice: actor, force: true }
                )
              )
                throw Error('Palette voice rejected');
            } finally {
              audio.rng.u32 = draw;
            }
            timeline.push({ actor, kind, variant });
            await wait(1400);
          }
      await wait(2200); // Let the longer legacy death/exhale and room return finish too.
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
      const target = ai.spawn('vanguard', positions[1], 0);
      target._drive(1 / 60);
      target.syncHitboxes();
      target.health = 100;
      const fire = (damage) =>
        physics.fireBullet({
          origin: eye,
          dir: target.position
            .clone()
            .add(new V3(0, 1.35, 0))
            .sub(eye)
            .normalize(),
          shooter: player,
          damage,
          penetration: 1,
          maxDist: 30,
          weapon: 'rifle',
        });
      const start = records.length,
        draw = audio.rng.float;
      // Deterministic contract probe only: force the existing 30% reaction draw, not levels or gameplay damage.
      audio.rng.float = () => 0;
      try {
        fire(1);
      } finally {
        audio.rng.float = draw;
      }
      const hurtHealth = target.health;
      await wait(900);
      audio.update(0, ctx);
      target.health = 1;
      fire(100);
      await wait(2200);
      audio.update(0, ctx);
      const actual = records.slice(start);
      window.reactionTarget = target;
      return {
        timeline,
        records,
        actual,
        hurtHealth,
        alive: target.alive,
        actor: target.id,
        recording,
        audio: audio.report(),
        active: audio.field.emitters.filter((e) => !e.free).length,
        engineError: engine.error ?? null,
      };
    },
    { capture: !!out, baseline: !!args.baseline }
  );
  assert(report.hurtHealth < 100 && report.hurtHealth > 0);
  assert.equal(report.alive, false);
  assert.equal(report.audio.errors, 0);
  assert.equal(report.engineError, null);
  assert.equal(report.active, 0);
  if (!args.baseline) {
    assert.equal(report.records.length, 14);
    assert.deepEqual(
      report.actual.map((r) => r.kind),
      ['hurt', 'death']
    );
    assert(report.actual.every((r) => r.voice === report.actor));
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
    'PASS actual game recorded reaction palette, real bullet hurt/death, actor identity, finite cleanup',
    JSON.stringify({ actual: report.actual, actor: report.actor, active: report.active })
  );
} finally {
  await browser?.close();
  stopViteServer(server);
}
