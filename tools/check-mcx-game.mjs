#!/usr/bin/env node
/** GPU/browser integration review. Run after npm ci; no Blender or network assets.
 * node tools/check-mcx-game.mjs --port=5197 --out=.tmp-rend/mcx-game
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs();
const port = Number(args.port ?? 5197), out = resolve(args.out ?? '.tmp-rend/mcx-game');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const pump = n => page.evaluate(n => window.__PUMP__(n), n);
const capture = async name => {
  await page.evaluate(() => window.__PRESENT__(2));
  await page.screenshot({ path: `${out}/${name}.png` });
};
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  await page.evaluate(() => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx;
    const w = ctx.get('weapons'), market = ctx.get('market');
    window.mcxReview = { ctx, w, market, shells: 0, shots: 0 };
    ctx.events.on('weapon:shell', () => window.mcxReview.shells++);
    ctx.events.on('weapon:fire', () => window.mcxReview.shots++);
    market.credits = 10000; market.openShop(1);
  });
  await pump(30);
  await capture('shop');
  await page.keyboard.press('Digit7'); // real shop input, not a debug ownership grant
  await pump(2);
  assert.equal(await page.evaluate(() => window.mcxReview.w.activeId), 'mcx');
  assert.equal(await page.evaluate(() => window.mcxReview.market.credits), 8900);
  const charges = await page.evaluate(() => window.mcxReview.w.carpetBombs);
  await page.keyboard.press('Digit0'); // tenth card remains keyboard-accessible
  await pump(2);
  assert.equal(await page.evaluate(() => window.mcxReview.w.carpetBombs), charges + 1);
  await page.evaluate(() => {
    const { market, ctx } = window.mcxReview;
    market.closeShop();
    // Exercise Player/CameraRig's actual ADS FOV solve, not a fixed shot camera.
    ctx.get('player').setControlEnabled(true);
  });
  await pump(30);
  await capture('hip');

  await page.evaluate(() => { const { w } = window.mcxReview; w.debugMode = 'ads'; });
  await pump(60);
  assert.equal(await page.evaluate(() => window.mcxReview.w.viewmodel.scopeReticle.material.uniforms.uChevron.value), 1);
  assert(await page.evaluate(() => {
    const { ctx } = window.mcxReview;
    return ctx.camera.fov < ctx.config.fov * .3;
  }), 'actual camera reaches the MCX 4x ADS FOV');
  await capture('acog');
  await page.setViewportSize({ width: 1024, height: 768 }); await pump(4);
  assert.equal(await page.evaluate(() => window.mcxReview.w.viewmodel.scopeMask.material.uniforms.uAspect.value), 4 / 3);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { window.mcxReview.w.debugMode = 'idle'; });
  await pump(40);

  assert(await page.evaluate(() => { const { w } = window.mcxReview; w.state.mag = 8; return w.reload(); }));
  await pump(43); await capture('reload-tactical');
  await pump(120);
  assert.equal(await page.evaluate(() => window.mcxReview.w.state.mag), 30);
  assert(await page.evaluate(() => { const { w } = window.mcxReview; w.state.mag = 0; w.state.chambered = false; return w.reload(); }));
  await pump(146); await capture('reload-empty');
  await pump(60);
  assert.equal(await page.evaluate(() => window.mcxReview.w.state.mag), 29);

  assert(await page.evaluate(() => window.mcxReview.w.inspect()));
  await pump(55); await capture('inspect');
  assert(await page.evaluate(() => window.mcxReview.w.tryFire()), 'fire cancels inspect');
  await pump(30);
  await page.evaluate(() => {
    const { ctx, w } = window.mcxReview;
    ctx.input.enabled = true; ctx.input.frozen = false; w.debugMode = null;
  });
  await page.keyboard.down('Shift'); await page.keyboard.down('KeyI'); await pump(1);
  assert.equal(await page.evaluate(() => window.mcxReview.w.viewmodel.clipName), 'stockFold');
  await page.keyboard.up('KeyI'); await page.keyboard.up('Shift');
  await pump(54); await capture('stock-fold');
  await pump(75);

  const before = await page.evaluate(() => ({ shots: window.mcxReview.shots, shells: window.mcxReview.shells }));
  for (let i = 0; i < 8; i++) {
    assert(await page.evaluate(() => window.mcxReview.w.tryFire()));
    await pump(5);
  }
  await capture('fire');
  const after = await page.evaluate(() => ({ shots: window.mcxReview.shots, shells: window.mcxReview.shells }));
  assert.equal(after.shots - before.shots, 8);
  assert.equal(after.shells - before.shells, 8);

  // Audition the actual sample + procedural reinforcement pipeline, with a
  // quiet single shot then an 800 rpm burst. Dry preview, not scene reverb.
  const audio = await page.evaluate(async () => {
    const { WeaponSampleBank } = await import('/src/audio/samples.js');
    const { NoiseBank } = await import('/src/audio/dsp.js');
    const { Rng } = await import('/src/core/rng.js');
    const { WEAPON_PROFILES, weaponPunch, weaponShot } = await import('/src/audio/weapons.js');
    const ac = new OfflineAudioContext(2, 48000 * 3, 48000), rng = new Rng(0x300bc);
    const bank = new NoiseBank(ac, rng), samples = new WeaponSampleBank(ac);
    await samples.load();
    const profile = WEAPON_PROFILES.mcx;
    const sum = ac.createGain(); sum.gain.value = .22 * 1.35 * .95 * profile.firstPersonGain;
    sum.connect(ac.destination);
    for (const when of [.15, 1, 1.075, 1.15, 1.225, 1.3, 1.375]) {
      const opts = { when, distance: 0, firstPerson: true };
      const recorded = samples.shot(profile, rng, opts);
      if (!recorded) throw new Error('MCX samples failed to decode');
      recorded.node.connect(sum);
      weaponPunch(ac, bank, rng, profile, opts).node.connect(sum);
    }
    // Also exercise the no-sample fallback, separately at the end of the demo.
    weaponShot(ac, bank, rng, profile, { when: 2.3, distance: 0, firstPerson: true }).node.connect(sum);
    const b = await ac.startRendering();
    return { left: Array.from(b.getChannelData(0)), right: Array.from(b.getChannelData(1)), loaded: samples.loaded };
  });
  const wav = Buffer.alloc(44 + audio.left.length * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  let peak = 0;
  for (let i = 0; i < audio.left.length; i++) {
    for (const [channel, samples] of [audio.left, audio.right].entries()) {
      peak = Math.max(peak, Math.abs(samples[i]));
      wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 4 + channel * 2);
    }
  }
  assert(peak > .05 && peak < .95, `audio peak ${peak}: audible without clipping`);
  writeFileSync(`${out}/sound-preview.wav`, wav);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, out, shots: after.shots, shells: after.shells,
    audioPeakDBFS: 20 * Math.log10(peak), decodedSamples: audio.loaded,
    render: await page.evaluate(() => window.__RENDER_INFO__), errors }, null, 2));
} finally {
  await browser.close(); stopViteServer(server);
}
