#!/usr/bin/env node
// Real game HDR rendering, scope, bolt/chamber events, reloads and interruptions.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5221), out = resolve(args.out ?? '.tmp-rend/ax338/game');
const baseline = Boolean(args.baseline);
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const pump = n => page.evaluate(n => window.__PUMP__(n), n);
async function capture(name) {
  await page.evaluate(() => window.__PRESENT__(2)); await page.screenshot({ path: `${out}/${name}.png` });
}
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__ENGINE__.ctx.get('weapons')._restDone, null, { timeout: 90000 });
  await page.evaluate(async baseline => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx, w = ctx.get('weapons');
    window.ax338Review = { ctx, w, shells: 0, shots: 0, reloads: [] };
    ctx.events.on('weapon:shell', () => window.ax338Review.shells++);
    ctx.events.on('weapon:fire', () => window.ax338Review.shots++);
    ctx.events.on('weapon:reload', e => window.ax338Review.reloads.push(e.phase));
    ctx.get('player').setControlEnabled(true);
    if (!w.equipPrimary('sniper')) throw new Error('AX338 failed to equip');
    if (baseline) {
      // Review-only replacement from the preserved old builder. Neither game
      // loading nor production exports can fall back to this procedural model.
      const { buildSniper } = await import('/src/weapons/models/sniper.js');
      w.viewmodel.weapons.get('sniper').group.visible = false;
      w.viewmodel.addWeapon(buildSniper(), w.state.def);
      w.viewmodel.setActive('sniper');
    }
  }, baseline);
  await pump(60);
  if (!baseline) assert.equal(await page.evaluate(() => window.ax338Review.w.viewmodel.active.animation.constructor.name), 'AX338Animation');
  await capture('hip-day');
  await page.evaluate(() => { window.ax338Review.w.debugMode = 'ads'; }); await pump(60);
  assert(await page.evaluate(() => { const vm = window.ax338Review.w.viewmodel; return vm.scopeOverlay.visible && !vm.active.group.visible && vm.adsT > .99; }));
  await capture('scope-ads');
  await page.evaluate(() => { window.ax338Review.w.debugMode = 'idle'; }); await pump(40);
  assert(await page.evaluate(() => { const { w } = window.ax338Review; w.state.mag = 3; w.state.reserve = 30; return w.reload(); }));
  await pump(82); await capture('reload-tactical');
  if (!baseline) assert(await page.evaluate(() => { const a = window.ax338Review.w.viewmodel.active.animation; return a.spare.visible && !a.magazine.visible; }));
  await pump(95); assert.equal(await page.evaluate(() => window.ax338Review.w.ammo.mag), 11);
  assert(await page.evaluate(() => { const { w } = window.ax338Review; w.state.mag = 0; w.state.chambered = false; return w.reload(); }));
  await pump(110); await capture('reload-empty-magazine');
  await pump(80); await capture('reload-empty-bolt');
  await pump(35); assert.equal(await page.evaluate(() => window.ax338Review.w.ammo.mag), 10);
  await page.evaluate(() => { window.ax338Review.w.debugMode = null; });
  assert(await page.evaluate(() => window.ax338Review.w.tryFire())); await pump(10); await capture('bolt-cycle');
  await pump(60);
  assert.equal(await page.evaluate(() => window.ax338Review.w.state.chambered), true);
  const counts = await page.evaluate(() => ({ shots: window.ax338Review.shots, shells: window.ax338Review.shells }));
  assert.deepEqual(counts, { shots: 1, shells: 1 });
  assert(await page.evaluate(() => window.ax338Review.w.inspect())); await pump(45); await capture('inspect');
  assert(await page.evaluate(() => window.ax338Review.w.tryFire()), 'fire interrupts inspect'); await pump(70);
  await page.evaluate(() => { window.ax338Review.w.state.mag = 0; window.ax338Review.w.state.chambered = true; });
  assert(await page.evaluate(() => window.ax338Review.w.tryFire())); await pump(70);
  assert.equal(await page.evaluate(() => window.ax338Review.w.state.chambered), false);
  assert(!await page.evaluate(() => window.ax338Review.w.tryFire()), 'dry fire cannot create another shot');
  await page.evaluate(() => { window.ax338Review.w.setWeaponImmediate('pistol'); }); await pump(15);
  await page.evaluate(() => { window.ax338Review.w.setWeaponImmediate('sniper'); }); await pump(15);
  assert.equal(await page.evaluate(() => window.ax338Review.w.state.chambered), false, 'switch does not refill chamber');
  assert(await page.evaluate(() => window.ax338Review.w.reload())); await pump(100);
  await page.evaluate(() => window.ax338Review.w._onPlayerDeath()); await pump(8);
  if (!baseline) assert(await page.evaluate(() => { const a = window.ax338Review.w.viewmodel.active.animation; return !a.spare.visible && a.magazine.visible; }));
  await page.evaluate(() => { const { w, ctx } = window.ax338Review; w.resetForNewGame(); w.equipPrimary('sniper'); ctx.get('sky').setTimeOfDay(23); }); await pump(60);
  await capture('hip-night');
  await page.evaluate(() => window.ax338Review.ctx.get('player').setFlashlightEnabled(true)); await pump(15); await capture('hip-night-flashlight');
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => ({ shots: window.ax338Review.shots, shells: window.ax338Review.shells })), { shots: 3, shells: 3 });
  const report = { ok: true, baseline, shots: 3, shells: 3, render: await page.evaluate(() => window.__RENDER_INFO__), errors };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); stopViteServer(server); }
