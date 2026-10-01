#!/usr/bin/env node
/** Actual startup/GPU/shared-arm integration, not a replacement animation player.
 * node tests/e2e/check-m4-game.mjs --port=5199 --out=.tmp-rend/m4-game
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5199), out = resolve(args.out ?? '.tmp-rend/m4-game');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const pump = n => page.evaluate(n => window.__PUMP__(n), n);
async function capture(name) {
  await page.evaluate(() => window.__PRESENT__(2));
  await page.screenshot({ path: `${out}/${name}.png` });
}
async function checkVisibleSpare() {
  assert(await page.evaluate(() => {
    const a = window.m4Review.w.viewmodel.active.animation;
    a.root.updateMatrixWorld(true);
    let meshes = 0, collapsed = 0;
    a.spare.traverse(o => {
      if (!o.isMesh) return;
      meshes++;
      if (Math.abs(Math.abs(o.matrixWorld.determinant()) - 1) > .00001) collapsed++;
    });
    return a.spare.visible && a.spareRound.visible && meshes === 4 && collapsed === 0;
  }), 'actual replacement magazine body and cartridges render, not just their parent');
}
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  await page.evaluate(() => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx, w = ctx.get('weapons');
    window.m4Review = { ctx, w, shells: 0, shots: 0 };
    ctx.events.on('weapon:shell', () => window.m4Review.shells++);
    ctx.events.on('weapon:fire', () => window.m4Review.shots++);
    ctx.get('player').setControlEnabled(true);
  });
  await pump(40);
  assert.equal(await page.evaluate(() => window.m4Review.w.activeId), 'rifle');
  assert.equal(await page.evaluate(() => window.m4Review.w.viewmodel.active.animation.constructor.name), 'M4Animation');
  await capture('hip');
  await page.evaluate(() => { window.m4Review.w.debugMode = 'ads'; });
  await pump(60);
  assert(await page.evaluate(() => {
    const { ctx, w } = window.m4Review, vm = w.viewmodel;
    return !vm.reticle.visible && !vm.scopeOverlay.visible && ctx.camera.fov < ctx.config.fov * .7;
  }), 'actual iron ADS, original camera FOV, no illuminated dot/scope');
  await capture('iron-ads');
  await page.evaluate(() => { window.m4Review.w.debugMode = 'idle'; });
  await pump(40);
  assert(await page.evaluate(() => { const { w } = window.m4Review; w.state.mag = 8; return w.reload(); }));
  await pump(43); await capture('reload-tactical');
  await pump(47); await checkVisibleSpare(); await capture('spare-tactical'); await pump(53);
  assert.equal(await page.evaluate(() => window.m4Review.w.state.mag), 30);
  assert(await page.evaluate(() => { const { w } = window.m4Review; w.state.mag = 0; w.state.chambered = false; return w.reload(); }));
  await pump(90); await checkVisibleSpare(); await capture('spare-empty');
  await pump(66); await capture('charging'); await pump(40);
  assert.equal(await page.evaluate(() => window.m4Review.w.state.mag), 29);
  assert(await page.evaluate(() => { window.m4Review.w.debugMode = null; return window.m4Review.w.inspect(); }));
  await pump(54); await capture('inspect');
  assert(await page.evaluate(() => window.m4Review.w.tryFire()), 'shot interrupts inspect'); await pump(12);
  const before = await page.evaluate(() => ({ shots: window.m4Review.shots, shells: window.m4Review.shells }));
  for (let i = 0; i < 8; i++) {
    assert(await page.evaluate(() => window.m4Review.w.tryFire()));
    await pump(6);
  }
  await capture('fire');
  const after = await page.evaluate(() => ({ shots: window.m4Review.shots, shells: window.m4Review.shells }));
  assert.equal(after.shots - before.shots, 8); assert.equal(after.shells - before.shells, 8);
  assert(await page.evaluate(() => {
    const a = window.m4Review.w.viewmodel.active.animation;
    return !a.reviewCase.visible && a.cover.quaternion.angleTo(a.openCover) < 1e-6;
  }), 'one physical casing; cover remains open');
  await page.evaluate(() => { const { w } = window.m4Review; w.setWeaponImmediate('pistol'); }); await pump(15);
  await page.evaluate(() => { window.m4Review.w.setWeaponImmediate('rifle'); }); await pump(15);
  assert(await page.evaluate(() => {
    const a = window.m4Review.w.viewmodel.active.animation;
    return a.cover.quaternion.angleTo(a.openCover) < 1e-6;
  }), 'cover does not reset shut on switch');
  assert(await page.evaluate(() => {
    const { w } = window.m4Review; w.state.mag = 0; w.state.chambered = true; return w.tryFire();
  }));
  await pump(12); await capture('lockback');
  assert(await page.evaluate(() => {
    const a = window.m4Review.w.viewmodel.active.animation;
    return a.bolt.position.z - a.boltRest.z > .061 && !a.magazineRound.visible;
  }));
  assert(await page.evaluate(() => window.m4Review.w.reload())); await pump(28);
  await page.evaluate(() => { window.m4Review.w._onPlayerDeath(); }); await pump(8);
  assert(await page.evaluate(() => {
    const a = window.m4Review.w.viewmodel.active.animation;
    return !a.spare.visible && a.magazine.visible;
  }), 'interrupted reload has no duplicate held magazine');
  assert.deepEqual(errors, []);
  const report = { ok: true, out, shots: await page.evaluate(() => window.m4Review.shots),
    shells: await page.evaluate(() => window.m4Review.shells), render: await page.evaluate(() => window.__RENDER_INFO__), errors };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close(); stopViteServer(server);
}
