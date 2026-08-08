#!/usr/bin/env node
/**
 * Focused verification of the two slow paths (feature/player-grenades):
 *   C. overcook -> in-hand detonation -> player dies (friendly fire)
 *   D. dying while cooking -> live grenade drops and detonates
 *
 * G is held for real (the release branch would otherwise fire first), agents
 * are disposed so AI grenades cannot contaminate boom counts, the render pass
 * is disabled so sim frames run at rAF speed, and every boom position is
 * checked against the player.
 */
import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';

const PORT = 8085;
const server = await ensureViteServer({ port: PORT, attempts: 120 });
const browser = await launchChromium({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__ === true', null, { timeout: 60000 });
await page.waitForTimeout(6000); // boot settle

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.__gc_explosion = 0;
  e.__gc_lastBoom = null;
  e.events.on('explosion', (ev) => {
    e.__gc_explosion++;
    e.__gc_lastBoom = ev?.position ? [ev.position.x, ev.position.y, ev.position.z] : null;
  });
  e.input.enabled = true;
  e.input.frozen = false;
  e.ctx.peek('player')?.setControlEnabled?.(true);
  // No AI grenade noise: dispose every agent.
  for (const a of e.ctx.peek('ai')?.agents ?? []) a.dispose();
  e.ctx.peek('ai').agents.length = 0;
  // Sim-only: skip the WebGL pass so frames advance at rAF speed.
  const r = e.ctx.peek('render');
  if (r && typeof r.render === 'function') r.render = () => {};
});

const until = (pred, timeoutMs = 20000) =>
  page.evaluate(([predSrc, timeoutMs]) => new Promise((resolve) => {
    const t0 = performance.now();
    const pred = new Function('E', `with (E) { return (${predSrc}); }`);
    const E = {
      get w() { return window.__ENGINE__.ctx.peek('weapons'); },
      get pl() { return window.__ENGINE__.ctx.peek('player'); },
      get e() { return window.__ENGINE__; },
      get boomDist() {
        const b = window.__ENGINE__.__gc_lastBoom;
        const pl = window.__ENGINE__.ctx.peek('player');
        if (!b || !pl) return null;
        return Math.hypot(b[0] - pl.feetPosition.x, b[2] - pl.feetPosition.z);
      },
      get eyeY() {
        const pl = window.__ENGINE__.ctx.peek('player');
        return pl?.eyePosition?.y ?? null;
      },
    };
    const poll = () => {
      let v = false;
      try { v = pred(E); } catch { /* keep polling */ }
      if (v) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }), [pred, timeoutMs]);

const snap = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('weapons');
    const pl = e.ctx.peek('player');
    const b = e.__gc_lastBoom;
    return {
      frame: e.time.frame,
      cooking: w?.cooking,
      grenades: w?.grenades,
      live: w?._grenades?.length,
      health: Math.round(pl?.health?.value ?? -1),
      alive: pl?.dead !== true,
      explosion: e.__gc_explosion,
      boom: b ? [b.map((v) => +v.toFixed(1)), 'eyeY=' + (pl?.eyePosition?.y ?? -1).toFixed(2)] : null,
    };
  });

const out = {};
out.s0 = await snap();

// ---- C: hold G, force a long cook -> in-hand detonation -> death ----
await page.keyboard.down('g');
await until('w.cooking === true', 5000);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('weapons');
  w._cookTime = 2.2; // 0.15 s of fuse left
});
out.cBoom = await until('e.__gc_explosion >= 1', 15000);
out.c1 = await snap(); // boom position should be at the eye
out.cDead = await until('pl.dead === true', 8000);
await page.keyboard.up('g');
out.cAfter = await snap();

// ---- D: respawn, hold G, force a short cook, die -> grenade drops ----
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.peek('player')?.respawn?.(0); // refills grenades via player:respawn
});
out.dRespawn = await until('pl.dead === false && pl.health?.value > 0 && w.grenades === 2', 8000);
await page.keyboard.down('g');
await until('w.cooking === true', 5000);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.peek('weapons')._cookTime = 0.4; // ~1.95 s of fuse left
  e.ctx.peek('player')?.applyDamage?.(500, { x: 0, y: 1, z: 0 });
});
out.dDrop = await until('w._grenades.length >= 1 && pl.dead === true', 8000);
out.d1 = await snap();
out.dBoom = await until('e.__gc_explosion >= 2', 20000); // C's boom + dropped one
out.dAfter = await snap();

console.log(JSON.stringify({ ...out, errors: errs.slice(0, 10) }, null, 2));
await browser.close().catch(() => {});
await stopViteServer(server);
