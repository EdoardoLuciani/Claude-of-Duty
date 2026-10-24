#!/usr/bin/env node
/** Continuous living-combat audio, captured AFTER the actual game's master gain. */
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
} from './lib/browser-harness.mjs';
import { captureNative, waitForGame } from './lib/native-render.mjs';

const args = parseArgs();
const root = resolve(args.root ?? REPO_ROOT);
const out = resolve(args.out ?? '/tmp/cod-473-combat-after');
const port = Number(args.port ?? 5537);
const seconds = Number(args.seconds ?? 26);
assert(seconds >= 25 && seconds <= 60, '25–60 seconds exercise both grenade throws');
assert(
  out !== root && !out.startsWith(root + '/'),
  'Keep gameplay captures outside the repository'
);
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ root, port });
assert(server, 'Refusing an occupied server port');
let browser;
const errors = [];
try {
  browser = await launchChromium({
    headless: true,
    args: ['--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await waitForGame(page, { timeout: 180000 });
  await page.evaluate(() => window.__APPLY_SHOT__('weapon'));
  await page.evaluate(() => window.__PUMP__(3));
  const captureOptions = { seconds, foley: !!args.foley };
  const result = await page.evaluate(async ({ seconds, foley }) => {
    const [{ createCombatProfile }, { combatLane }, { HEALTH }] = await Promise.all([
      import('/tools/lib/profile-combat.js'),
      import('/tools/lib/combat-fixture.js'),
      import('/src/player/tuning.ts'),
    ]);
    const engine = window.__ENGINE__,
      ctx = engine.ctx;
    const audio = ctx.get('audio'),
      player = ctx.get('player'),
      input = engine.input;
    if (!(await audio.start())) throw Error('Actual game audio failed to start');
    const lane = (ai, world, physics, offsets) =>
      combatLane(ai, world, physics, offsets.slice(0, 4));
    const fixture = createCombatProfile(engine, lane, { realtime: true });
    const weapons = ctx.get('weapons');
    if (foley) ctx.get('ai').agents[0].health = 40;
    // The initial screenshot pose is not gameplay: release both weapon and
    // viewmodel debug gates before driving normal fire/reload/grenade input.
    weapons.debugMode = null;
    weapons.viewmodel.debugFrozen = false;
    // Keep the real update/physics/AI/input paths, but pace against the wall clock
    // rather than the screenshot harness's fixed 1/60 clock (audio is real time).
    engine.step = Object.getPrototypeOf(engine).step.bind(engine);
    engine._last = performance.now();
    player.health.armour = HEALTH.maxArmour;
    // Include an environmental event at the opening, before the normal finite
    // emitter pool fills with combat. Its selection/gain/routing stay untouched.
    audio.ambience._timers.oneshot = 0.05;
    const report = {
      seconds,
      fixture: 'living-combat-realtime',
      finiteHp: 10000,
      woundedEnemyHp: foley ? 40 : null,
      masterVolume: audio.mixer.masterVolume,
      playerShots: 0,
      enemyShots: 0,
      healthHits: 0,
      armourHits: 0,
      plateBreaks: 0,
      fleshContacts: 0,
      enemyFleshContacts: 0,
      whizzes: 0,
      grenades: 0,
      footsteps: 0,
      backgroundVoices: 0,
      bodyFalls: 0,
      bodyFallVoices: 0,
      landings: 0,
      jumps: 0,
      jumpLandings: 0,
      frames: 0,
    };
    let jumpPending = false;
    const offs = [
      ctx.events.on('weapon:fire', (e) => {
        if (e.actor === 'player' || e.actor === player) report.playerShots++;
        else report.enemyShots++;
      }),
      ctx.events.on('damage:taken', (e) => {
        if (e.amount > 0) report.healthHits++;
        if (e.armourAbsorbed > 0) report.armourHits++;
        if (e.plateBreak) report.plateBreaks++;
      }),
      ctx.events.on('bullet:impact', (e) => {
        if (e.surface !== 'flesh' || e.exit) return;
        report.fleshContacts++;
        if (e.actor !== 'player' && e.actor !== player && !e.actor?.isPlayer)
          report.enemyFleshContacts++;
      }),
      ctx.events.on('explosion', () => report.grenades++),
      ctx.events.on('player:footstep', () => report.footsteps++),
      ctx.events.on('player:jump', () => {
        report.jumps++;
        jumpPending = true;
      }),
      ctx.events.on('player:land', (e) => {
        report.landings++;
        if (jumpPending && e.velocity > 2) {
          report.jumpLandings++;
          jumpPending = false;
        }
      }),
      ctx.events.on('actor:death', () => report.bodyFalls++),
    ];
    const play = audio._playAt.bind(audio);
    audio._playAt = (...args) => {
      const accepted = play(...args);
      if (accepted && args[0] === 'whizz') report.whizzes++;
      if (accepted && args[5] === 'ambience') report.backgroundVoices++;
      if (accepted && args[0] === 'bodyfall') report.bodyFallVoices++;
      return accepted;
    };
    const dest = audio.actx.createMediaStreamDestination();
    audio.mixer.masterGain.connect(dest);
    const chunks = [];
    const recorder = new MediaRecorder(dest.stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 192000,
    });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const setKey = (key, down) => {
      if (down && !input.down.has(key)) input._pendingDown.add(key);
      if (!down && input.down.has(key)) input._pendingUp.add(key);
    };
    await new Promise((ready) => {
      recorder.onstart = ready;
      recorder.start();
    });
    const started = performance.now();
    let replenished = false;
    try {
      while (performance.now() - started < seconds * 1000) {
        const now = await new Promise((ready) => requestAnimationFrame(ready));
        const elapsed = (performance.now() - started) / 1000;
        fixture.before(report.frames, elapsed * 60);
        // Mouse counter-recoil keeps the ordinary shots aimed at torso height,
        // rather than letting this unattended audition climb into the sky.
        input._rawLook.y += (player.pitch + 0.025) / engine.config.sensitivity;
        if (foley) {
          // Aim via ordinary mouse input so a real shot can kill the one actor
          // starting wounded at 40 HP. Others keep the audition running.
          const target = ctx.get('ai').agents.find((a) => a.alive);
          if (target) {
            const dx = target.position.x - player.eyePosition.x;
            const dz = target.position.z - player.eyePosition.z;
            const yaw = Math.atan2(-dx, -dz);
            const delta = Math.atan2(Math.sin(yaw - player.yaw), Math.cos(yaw - player.yaw));
            input._rawLook.x = -delta / engine.config.sensitivity;
            const pitch = Math.atan2(
              target.position.y + 1.25 - player.eyePosition.y,
              Math.hypot(dx, dz)
            );
            input._rawLook.y = (player.pitch - pitch) / engine.config.sensitivity;
          }
          setKey('Space', (elapsed >= 2.5 && elapsed < 2.7) || (elapsed >= 11 && elapsed < 11.2));
        }
        // Normal G/ADS input: equip, cook briefly, release a short throw. The
        // actual animation releases the live physics grenade and its fuse.
        const g = (elapsed >= 4.8 && elapsed < 4.95) || (elapsed >= 19.8 && elapsed < 19.95);
        const cook = (elapsed >= 5.15 && elapsed < 5.45) || (elapsed >= 20.15 && elapsed < 20.45);
        setKey('KeyG', g);
        setKey('Mouse2', cook);
        // Refill one plate once to expose armour + plate-break feedback without
        // faking damage events or touching source/bus/master gains.
        if (!replenished && elapsed >= 12) {
          player.health.armour = HEALTH.plateSize;
          replenished = true;
        }
        engine.step(now);
        if (foley) {
          if (engine.error) throw Error(JSON.stringify(engine.error));
          if (player.dead) throw Error('Audition player died');
        } else fixture.after();
        report.frames++;
      }
      report.simulationSeconds = engine.time.elapsed;
      report.audio = audio.report();
      await new Promise((ready) => {
        recorder.onstop = ready;
        recorder.stop();
      });
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return { ...report, pcm: btoa(binary), engineError: engine.error ?? null };
    } finally {
      fixture.dispose();
      setKey('KeyG', false);
      setKey('Mouse2', false);
      setKey('Space', false);
      audio._playAt = play;
      for (const off of offs) off();
      engine.setGameplaySuspended(true);
    }
  }, captureOptions);
  const media = resolve(out, 'combat.webm');
  writeFileSync(media, Buffer.from(result.pcm, 'base64'));
  delete result.pcm;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ ...result, errors }, null, 2) + '\n');
  await captureNative(page, resolve(out, 'combat.png'));
  const convert = spawnSync('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-i',
    media,
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    resolve(out, 'combat.mp3'),
  ]);
  assert.equal(convert.status, 0, convert.stderr?.toString());
  assert.deepEqual(errors, []);
  assert.equal(result.engineError, null);
  assert.equal(result.audio.errors, 0);
  for (const name of [
    'playerShots',
    'enemyShots',
    'healthHits',
    'armourHits',
    'plateBreaks',
    'fleshContacts',
    'enemyFleshContacts',
    'whizzes',
    'grenades',
    'footsteps',
    'backgroundVoices',
  ])
    assert(result[name] > 0, `Combat capture did not exercise ${name}; inspect report.json`);
  assert(result.grenades >= 2, 'Both real input-driven grenades must explode');
  if (args.foley) {
    assert.equal(result.jumps, 2, 'Both scripted jump presses cause actual jumps');
    assert.equal(
      result.jumpLandings,
      2,
      'Both actual jumps must land, not merely terrain step-downs'
    );
    assert(
      result.bodyFalls > 0 && result.bodyFallVoices > 0,
      'Real actor death and accepted body fall'
    );
  }
  console.log(JSON.stringify(result, null, 2));
  console.log(
    'PASS: continuous real-game combat audio; no per-source/bus/master overrides or loudness normalization.'
  );
} finally {
  await browser?.close();
  stopViteServer(server);
}
