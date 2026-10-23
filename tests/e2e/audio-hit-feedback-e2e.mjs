#!/usr/bin/env node
/** Actual game graph/HUD integration + optional local before/after audio capture. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const root = resolve(args.root ?? fileURLToPath(new URL('../../', import.meta.url)));
const out = args.out ? resolve(args.out) : null;
assert(!out || !out.startsWith(root), 'Audio evidence stays outside the repository');
if (out) mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ root, port: Number(args.port ?? 5533) });
assert(server, 'Refusing an occupied server port');
let browser;
const errors = [],
  results = [];
try {
  browser = await launchChromium({
    headless: true,
    args: ['--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    `http://127.0.0.1:${Number(args.port ?? 5533)}/?capture=1&lockstep=1&shot=weapon`
  );
  await waitForGame(page, { timeout: 180000 });
  await page.evaluate(() => window.__APPLY_SHOT__('weapon'));
  await page.evaluate(() => window.__PUMP__(3));
  await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx;
    const audio = ctx.get('audio');
    if (!(await audio.start())) throw Error('Actual game audio failed to start');
    audio.ambience.dispose();
    audio.update(0, ctx);
    window.hitTrace = [];
    for (const method of ['_playDry', '_playAt']) {
      const original = audio[method].bind(audio);
      audio[method] = (...args) => {
        window.hitTrace.push({
          method,
          kind: args[0],
          options: method === '_playDry' ? args[1] : args[4],
        });
        return original(...args);
      };
    }
    const dest = audio.actx.createMediaStreamDestination();
    audio.mixer.masterGain.connect(dest);
    window.hitCaptureStream = dest.stream;
  });
  for (const [id, amount, armourAbsorbed, plateBreak] of [
    ['health', 25, 0, false],
    ['armour', 0, 25, false],
    ['mixed', 15, 15, false],
    ['break-mixed', 15, 15, true],
    ['break-armour-only', 0, 25, true],
    ['empty', 0, 0, false],
  ]) {
    const row = await page.evaluate(
      async ({ id, amount, armourAbsorbed, plateBreak, capture }) => {
        const engine = window.__ENGINE__,
          ctx = engine.ctx;
        const audio = ctx.get('audio'),
          player = ctx.get('player'),
          ui = ctx.get('ui');
        const chunks = [];
        let recorder;
        if (capture) {
          recorder = new MediaRecorder(window.hitCaptureStream, {
            mimeType: 'audio/webm;codecs=opus',
          });
          recorder.ondataavailable = (e) => chunks.push(e.data);
          await new Promise((ready) => {
            recorder.onstart = ready;
            recorder.start();
          });
          // Establish capture before scheduling the contact's sharp attack.
          await new Promise((ready) => setTimeout(ready, 80));
        }
        window.hitTrace.length = 0;
        player.health.value = 100 - amount;
        player.health.armour = plateBreak ? 0 : 50;
        const from = engine.camera.position.clone();
        from.x += 5;
        // Real collider contacts publish before incoming resolution. Only the
        // damage event should sound, even though the player collider is flesh.
        ctx.events.emit('bullet:impact', {
          point: engine.camera.position,
          surface: 'flesh',
          damage: 30,
          actor: player,
          shooter: 'enemy',
          exit: false,
          shot: 900,
        });
        ctx.events.emit('damage:taken', {
          amount,
          armourAbsorbed,
          plateBreak,
          from,
          health: player.health.value,
          armour: player.health.armour,
        });
        ui.lateUpdate(1 / 60, ctx);
        const trace = window.hitTrace.slice();
        const health = ui.state.health;
        let pcm;
        if (recorder) {
          await new Promise((r) => setTimeout(r, 900));
          await new Promise((r) => {
            recorder.onstop = r;
            recorder.stop();
          });
          const data = new Uint8Array(await new Blob(chunks).arrayBuffer());
          let binary = '';
          for (let i = 0; i < data.length; i += 32768)
            binary += String.fromCharCode(...data.subarray(i, i + 32768));
          pcm = btoa(binary);
        } else await new Promise((r) => setTimeout(r, 450));
        audio.update(0, ctx);
        return {
          id,
          amount,
          armourAbsorbed,
          plateBreak,
          trace,
          health,
          report: audio.report(),
          pcm,
        };
      },
      { id, amount, armourAbsorbed, plateBreak, capture: !!out }
    );
    if (out) {
      const path = resolve(out, `${id}.webm`);
      writeFileSync(path, Buffer.from(row.pcm, 'base64'));
      const converted = spawnSync('ffmpeg', [
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
        resolve(out, `${id}.mp3`),
      ]);
      assert.equal(converted.status, 0, converted.stderr?.toString());
      await page.screenshot({ path: resolve(out, `${id}.png`) });
    }
    delete row.pcm;
    assert.equal(row.report.errors, 0, id + ': actual graph errors');
    assert.equal(row.health, 100 - amount, id + ': HUD retains health');
    if (!args.baseline) {
      assert.equal(
        row.trace.length,
        amount || armourAbsorbed ? 1 : 0,
        id + ': one audio-owned incoming voice'
      );
      if (row.trace.length) {
        assert.equal(row.trace[0].kind, 'damage');
        assert.equal(row.trace[0].method, '_playDry');
      }
    }
    results.push(row);
  }
  // Exercise the real bullet resolver against an actual soldier, not a second
  // fabricated damage path. Physics already deduplicates overlapping regions.
  const enemy = await page.evaluate(async () => {
    const { combatLane } = await import('/tools/lib/combat-fixture.js');
    const engine = window.__ENGINE__,
      ctx = engine.ctx;
    const ai = ctx.get('ai'),
      physics = ctx.get('physics'),
      player = ctx.get('player');
    for (const agent of ai.agents) agent.dispose();
    ai.agents.length = 0;
    const { positions } = combatLane(ai, ctx.get('world'), physics, [[9, 0]]);
    const V3 = engine.camera.position.constructor;
    const eye = positions[0].clone().add(new V3(0, 1.6, 0));
    const target = ai.spawn('vanguard', positions[1], 0);
    target._drive(1 / 60);
    target.syncHitboxes();
    const aim = target.position.clone().add(new V3(0, 1.35, 0));
    player.teleport(eye, engine.camera.rotation);
    engine.camera.position.copy(eye);
    const audio = ctx.get('audio');
    audio.update(0, ctx);
    window.hitTrace.length = 0;
    physics.fireBullet({
      origin: eye,
      dir: aim.sub(eye).normalize(),
      shooter: player,
      damage: 20,
      penetration: 1,
      maxDist: 30,
      weapon: 'rifle',
    });
    return {
      trace: window.hitTrace.slice(),
      health: target.health,
      errors: audio.report().errors,
      engineError: engine.error ?? null,
    };
  });
  assert(enemy.health < 100, 'actual soldier takes damage');
  assert.equal(enemy.errors, 0);
  assert.equal(enemy.engineError, null);
  assert.equal(
    enemy.trace.filter((v) => v.kind === 'impact' && v.options?.surface === 'flesh').length,
    1,
    'one real enemy body contact'
  );
  if (!args.baseline) {
    assert.equal(
      enemy.trace.filter((v) => v.kind === 'whizz').length,
      0,
      'own body hit is not a near-miss'
    );
    assert.equal(
      enemy.trace.filter((v) => v.kind === 'hitmarker').length,
      1,
      'one confirmation UI tick, not a second copy from the HUD'
    );
  }
  results.push({ id: 'real-enemy', ...enemy });
  const healthPaths = await page.evaluate(async () => {
    const { HEALTH } = await import('/src/player/tuning.ts');
    const ctx = window.__ENGINE__.ctx,
      player = ctx.get('player');
    const from = ctx.camera.position.clone();
    from.x += 2;
    return [
      [
        'real-armour-break',
        100,
        HEALTH.plateSize,
        HEALTH.plateSize / (1 - HEALTH.armourReduction),
        'bullet',
      ],
      ['real-explosion-damage', 100, 0, 25, 'explosion'],
      ['real-lethal-damage', 10, 0, 25, 'bullet'],
    ].map(([id, health, armour, damage, type]) => {
      player.health.reset(true);
      player.health.value = health;
      player.health.armour = armour;
      window.hitTrace.length = 0;
      player.applyDamage(damage, from, { type });
      return {
        id,
        trace: window.hitTrace.slice(),
        health: player.health.value,
        armour: player.health.armour,
      };
    });
  });
  if (!args.baseline)
    for (const row of healthPaths) {
      assert.equal(
        row.trace.filter((v) => v.kind === 'damage').length,
        1,
        row.id + ': real health path has one incoming voice'
      );
      assert.equal(
        row.trace.filter((v) => v.kind === 'armour_hit' || v.kind === 'armour_break').length,
        0,
        row.id + ': no extra HUD armour sound'
      );
    }
  assert.equal(healthPaths[0].armour, 0);
  assert.equal(healthPaths[0].health, 100, 'real armour-only break leaves health intact');
  assert.equal(healthPaths[1].health, 75, 'explosion-derived health damage retains its route');
  assert.equal(healthPaths[2].health, 0, 'lethal damage still applies');
  results.push(...healthPaths);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: actual gameplay HUD/audio, six incoming cases, real health/explosion/death and enemy bullet contact${args.baseline ? ' (baseline recorded)' : ''}`
  );
} finally {
  await browser?.close();
  stopViteServer(server);
  if (out)
    writeFileSync(
      resolve(out, 'routing.json'),
      JSON.stringify({ results, errors }, null, 2) + '\n'
    );
}
