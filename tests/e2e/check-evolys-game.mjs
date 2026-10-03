#!/usr/bin/env node
// Real startup, HDR weapon pass, shared arms, ammo, switching and shot events.
import assert from 'node:assert/strict';
import { verifyNative, captureNative } from './native-render.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5213), out = resolve(args.out ?? '.tmp-rend/evolys/game');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const pump = n => page.evaluate(n => window.__PUMP__(n), n);
async function capture(name) {
  await page.evaluate(() => window.__PRESENT__(2)); await captureNative(page, `${out}/${name}.png`);
}
const beltCount = () => page.evaluate(() => window.evolysReview.w.viewmodel.active.animation.bones.filter(b => b.scale.x > .5).length);
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await verifyNative(page);
  await page.waitForFunction(() => window.__ENGINE__.ctx.get('weapons')._restDone, null, { timeout: 90000 });
  await page.evaluate(() => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx, w = ctx.get('weapons');
    window.evolysReview = { ctx, w, shells: 0, shots: 0 };
    ctx.events.on('weapon:shell', () => window.evolysReview.shells++);
    ctx.events.on('weapon:fire', () => window.evolysReview.shots++);
    ctx.get('player').setControlEnabled(true);
    if (!w.equipPrimary('lmg')) throw new Error('LMG failed to equip');
  });
  await pump(60);
  assert.equal(await page.evaluate(() => window.evolysReview.w.viewmodel.active.animation.constructor.name), 'EvolysAnimation');
  await capture('hip'); assert.equal(await beltCount(), 8);
  await page.evaluate(() => { window.evolysReview.w.debugMode = 'ads'; }); await pump(60);
  assert(await page.evaluate(() => { const vm = window.evolysReview.w.viewmodel; return vm.reticle.visible && !vm.scopeOverlay.visible && vm.adsT > .99; }));
  await capture('reflex-ads');
  await page.evaluate(() => { window.evolysReview.w.debugMode = 'idle'; }); await pump(40);
  assert(await page.evaluate(() => { const { w } = window.evolysReview; w.state.mag = 8; return w.reload(); }));
  await pump(104); await capture('reload-tactical-pouch');
  assert(await page.evaluate(() => { const a = window.evolysReview.w.viewmodel.active.animation; return a.spare.visible && !a.pouch.visible && !a.belt.visible; }));
  await pump(40); await capture('reload-tactical-feed'); assert.equal(await beltCount(), 8);
  await pump(70); assert.equal(await page.evaluate(() => window.evolysReview.w.state.mag), 100);
  assert(await page.evaluate(() => { const { w } = window.evolysReview; w.state.mag = 0; w.state.chambered = false; w.state.reserve = 150; return w.reload(); }));
  await pump(150); await capture('reload-empty-pouch');
  assert.equal(await beltCount(), 0);
  await pump(55); await capture('reload-empty-feed'); assert.equal(await beltCount(), 8);
  await pump(49); await capture('reload-empty-charge');
  await pump(50); assert.equal(await page.evaluate(() => window.evolysReview.w.ammo.mag), 100);
  assert(await page.evaluate(() => { const { w } = window.evolysReview; w.debugMode = null; return w.inspect(); }));
  await pump(54); await capture('inspect');
  assert(await page.evaluate(() => window.evolysReview.w.tryFire()), 'fire interrupts inspect'); await pump(8);
  const before = await page.evaluate(() => ({ shots: window.evolysReview.shots, shells: window.evolysReview.shells }));
  for (let i = 0; i < 8; i++) { assert(await page.evaluate(() => window.evolysReview.w.tryFire())); await pump(6); }
  await capture('fire');
  const after = await page.evaluate(() => ({ shots: window.evolysReview.shots, shells: window.evolysReview.shells }));
  assert.equal(after.shots - before.shots, 8); assert.equal(after.shells - before.shells, 8);
  await page.evaluate(() => { const { w } = window.evolysReview; w.state.mag = 2; w.state.chambered = true; }); await pump(8);
  assert.equal(await beltCount(), 3);
  for (let i = 2; i >= 0; i--) {
    assert(await page.evaluate(() => window.evolysReview.w.tryFire())); await pump(8);
    assert.equal(await beltCount(), i, 'post-shot tail reflects actual total ammunition');
  }
  await capture('empty');
  await page.evaluate(() => { window.evolysReview.w.setWeaponImmediate('pistol'); }); await pump(15);
  await page.evaluate(() => { window.evolysReview.w.setWeaponImmediate('lmg'); }); await pump(15);
  assert.equal(await beltCount(), 0, 'switch does not respawn empty ammunition');
  assert(await page.evaluate(() => window.evolysReview.w.reload())); await pump(90);
  await page.evaluate(() => { window.evolysReview.w._onPlayerDeath(); }); await pump(8);
  assert(await page.evaluate(() => { const a = window.evolysReview.w.viewmodel.active.animation; return !a.spare.visible && a.pouch.visible && Math.abs(a.cover.rotation.y) < .001 && !a.belt.visible; }));
  await page.evaluate(() => { const { w } = window.evolysReview; w.resetForNewGame(); w.equipPrimary('lmg'); }); await pump(60);
  assert.equal(await beltCount(), 8, 'restart restores full short belt');
  assert.deepEqual(errors, []);
  const counts = await page.evaluate(() => ({ shots: window.evolysReview.shots, shells: window.evolysReview.shells }));
  assert.deepEqual(counts, { shots: 12, shells: 12 }, 'one shell event per shot, including the three runout shots');
  const report = { ok: true, ...counts, render: await page.evaluate(() => window.__RENDER_INFO__), errors };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); stopViteServer(server); }
