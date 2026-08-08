#!/usr/bin/env node
/**
 * Headless smoke test for player grenades (feature/player-grenades).
 *
 *   node tools/dbg-grenade.mjs
 *
 * The game free-runs; every wait is a POLL on game-time state (engine dt is
 * clamped to 0.1 s, so wall-clock waits lie whenever the headless GPU crawls).
 * Gameplay facts are read from the live engine each poll.
 *
 * Verifies:
 *   A. arm+cook+release throws a live grenade that detonates on its fuse
 *   B. explosion kills credit the thrower via damage:dealt (kill feed/score)
 *   C. overcooking detonates in hand (friendly fire: player dies)
 *   D. dying while cooking drops the live grenade at your feet
 *   E. HUD lethal count + cooking flag feed through getHudState
 */
import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';

const PORT = 8081;
const log = (...a) => console.log('[dbg]', ...a);

const server = await ensureViteServer({ port: PORT, attempts: 120 });
const browser = await launchChromium({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errs = [];
let crashed = false;
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errs.push(`console: ${m.text()}`));
page.on('crash', () => { crashed = true; errs.push('PAGE CRASHED'); });
browser.on('disconnected', () => errs.push('BROWSER DISCONNECTED'));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__ === true', null, { timeout: 60000 });
log('ready');

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.enabled = true;
  e.input.frozen = false;
  e.ctx.peek('player')?.setControlEnabled?.(true);
  e.__gc_explosion = 0; e.__gc_thrown = 0; e.__gc_dealt = 0; e.__gc_deaths = 0;
  e.__gc_lastBoom = null;
  e.events.on('explosion', (ev) => { e.__gc_explosion++; e.__gc_lastBoom = ev?.position ? [ev.position.x, ev.position.y, ev.position.z] : null; });
  e.events.on('damage:dealt', (ev) => { if (ev?.explosion) e.__gc_dealt++; });
  e.events.on('actor:death', () => e.__gc_deaths++);
});

/** Poll a predicate every ~60 ms of wall time until it holds or timeout. */
const until = (label, pred, timeoutMs = 20000) =>
  page.evaluate(([label, predSrc, timeoutMs]) => new Promise((resolve) => {
    const t0 = performance.now();
    const pred = new Function('E', `with (E) { return (${predSrc}); }`);
    const E = {
      get w() { return window.__ENGINE__.ctx.peek('weapons'); },
      get pl() { return window.__ENGINE__.ctx.peek('player'); },
      get e() { return window.__ENGINE__; },
      get counts() { return {
        explosion: window.__ENGINE__.__gc_explosion,
        dealt: window.__ENGINE__.__gc_dealt,
        deaths: window.__ENGINE__.__gc_deaths,
        kills: window.__ENGINE__.ctx.peek('game')?.kills ?? -1,
      }; },
    };
    const poll = () => {
      let v = null;
      try { v = pred(E); } catch { v = false; }
      if (v) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }), [label, pred, timeoutMs]);

const snap = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('weapons');
    const pl = e.ctx.peek('player');
    return {
      frame: e.time.frame,
      cooking: w?.cooking,
      grenades: w?.grenades,
      live: w?._grenades?.length,
      hudLethal: w?._hudState?.lethalCount,
      hudCooking: w?._hudState?.cooking,
      health: Math.round(pl?.health?.value ?? -1),
      alive: pl?.dead !== true,
      explosion: e.__gc_explosion,
      boomDist: e.__gc_lastBoom
        ? Math.hypot(e.__gc_lastBoom[0] - pl.feetPosition.x, e.__gc_lastBoom[2] - pl.feetPosition.z).toFixed(1)
        : null,
      dealt: e.__gc_dealt,
      kills: e.ctx.peek('game')?.kills ?? -1,
      agents: e.ctx.peek('ai')?.agents?.filter((a) => a.alive)?.length ?? -1,
    };
  });

const out = {};
const step = async (name, fn) => {
  if (crashed) { out[name] = 'SKIPPED (crashed)'; return; }
  try { out[name] = await fn(); log(name, 'ok'); }
  catch (e) { out[name] = `FAILED: ${e.message}`; errs.push(`${name}: ${e.message}`); log(name, 'FAILED', e.message); }
};

// Boot settle: let shader compile + world streaming finish before gameplay.
await page.waitForTimeout(8000);
out.settle = await snap();

// ---- A: arm, cook ~0.35 s (game time), release -> throw -> detonate ----
out.a0 = await snap();
await page.keyboard.down('g');
out.a1 = await until('cooking', 'w.cooking === true');
await until('cooked-0.4s', 'w._cookTime >= 0.4');
out.aCook = await snap();
await page.keyboard.up('g');
out.a2 = await until('thrown', 'w._grenades.length === 1');
out.aThrown = await snap();
out.a3 = await until('detonated', 'e.__gc_explosion >= 1', 25000);
out.aAfter = await snap();

// ---- B: kill credit — fatal blast on an agent via the event bus ----
const bBefore = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const a = ai?.agents?.find((x) => x.alive);
  if (!a) return { skipped: true };
  const p = a.position;
  const pt = { x: p.x, y: p.y + 0.25, z: p.z };
  e.events.emit('explosion', { position: pt, radius: 6.5, damage: 120, source: e.ctx.peek('player') });
  return { at: [pt.x.toFixed(1), pt.y.toFixed(1), pt.z.toFixed(1)], killsBefore: e.ctx.peek('game')?.kills ?? -1 };
});
await step('b', async () => {
  if (bBefore?.skipped) return { skipped: true };
  const ok = await until('blast processed', 'e.__gc_dealt >= 1 || e.__gc_deaths >= 1', 8000);
  return { blastAt: bBefore.at, killsBefore: bBefore.killsBefore, processed: ok, after: await snap() };
});

// ---- C: overcook — hold past the fuse, expect in-hand detonation ----
await page.keyboard.down('g');
out.c0 = await until('armed', 'w.cooking === true');
out.c1 = await until('in-hand detonation', 'pl.dead === true || (pl.health?.value ?? 0) < 100', 30000);
await page.keyboard.up('g');
out.cAfter = await snap();

// ---- D: die while cooking -> grenade drops and detonates ----
out.dRespawn = await until('respawned', 'pl.dead === false && pl.health?.value > 0', 15000);
await page.keyboard.down('g');
out.d0 = await until('armed again', 'w.cooking === true');
await until('cooked-0.4s', 'w._cookTime >= 0.4');
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.peek('player')?.applyDamage?.(500, { x: 0, y: 1, z: 0 });
});
out.d1 = await until('dead', 'pl.dead === true', 8000);
out.dDrop = await until('dropped live grenade', 'w._grenades.length >= 1', 8000);
out.d2 = await until('dropped grenade detonates', 'e.__gc_explosion >= 1', 20000);
out.dAfter = await snap();

out.finalCounts = await snap();
console.log(JSON.stringify({ ...out, errors: errs.slice(0, 12) }, null, 2));
await browser.close().catch(() => {});
await stopViteServer(server);
