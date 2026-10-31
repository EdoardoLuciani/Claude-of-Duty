// Isolate the existing separate-canvas HUD slice; no runtime/quality changes.
// node tests/e2e/pixi-cost.mjs --out=/tmp/pixi-cost --rounds=4
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  collectBrowserErrors,
  stopViteServer,
  parseArgs,
} from '../../tools/lib/browser-harness.mjs';
import { combatLane } from '../../tools/lib/combat-fixture.js';
import { waitForGame } from '../../tools/lib/native-render.mjs';
import { createCombatProfile, validateCombatProfile } from '../../tools/lib/profile-combat.js';
import { measurePixiGpu } from '../lib/pixi-gpu-timing.mjs';

const args = parseArgs(),
  port = Number(args.port ?? 5203),
  rounds = Number(args.rounds ?? 4);
const out = resolve(String(args.out ?? '/tmp/pixi-cost'));
await mkdir(out, { recursive: true });
const server = await ensureViteServer({ port, preview: !!args.preview });
const browser = await launchChromium({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const orders = [
  ['none', 'update', 'hidden', 'full'],
  ['full', 'hidden', 'update', 'none'],
  ['update', 'none', 'full', 'hidden'],
  ['hidden', 'full', 'none', 'update'],
];
const results = [];
try {
  for (let round = 0; round < rounds; round++)
    for (const mode of orders[round % orders.length]) {
      const run = results.length;
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });
      if (args.preview) {
        await page.goto(`http://localhost:${port}/LICENSE.txt`);
        await page.waitForFunction(
          async () =>
            (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }))?.info
              .isFallbackAdapter === false,
          null,
          { timeout: 15000 }
        );
      }
      const errors = [];
      collectBrowserErrors(page, errors, { validationMessages: true });
      await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&q=high&pixi=hud`);
      const device = await waitForGame(page);
      errors.splice(
        0,
        errors.length,
        ...errors.filter((s) => !/THREE.TSL: Return statement used/.test(s))
      );
      await page.addScriptTag({
        content: `window.__PIXICOST_API__={lane:${combatLane.toString()},create:${createCombatProfile.toString()},gpu:${measurePixiGpu.toString()}};`,
      });
      const setup = await page.evaluate(async (mode) => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui'),
          p = ui.pixiHud,
          r = e.ctx.get('render');
        if (!p || p.sameCanvas || !p.enabled) throw Error('live separate-canvas HUD required');
        r.settings.autoExposure = false;
        window.__COST_FIXTURE__ = window.__PIXICOST_API__.create(e, window.__PIXICOST_API__.lane);
        // All four conditions initialize and warm the FULL presenter/renderer.
        // This measures active work, not cold initialization or memory residency.
        for (let i = 0; i < 180; i++) {
          window.__COST_FIXTURE__.before(-1);
          await window.__PUMP__(1);
        }
        const update = p.update,
          render = p.renderer.render;
        const stats = { updateMs: [], renderMs: [], updates: 0, drawAttempts: 0, draws: 0 };
        window.__PIXICOST_STATS__ = stats;
        if (mode !== 'full') p.canvas.style.setProperty('visibility', 'hidden', 'important');
        p.renderer.render = function (...a) {
          stats.drawAttempts++;
          if (mode === 'update') return;
          const at = performance.now();
          try {
            stats.draws++;
            return render.apply(this, a);
          } finally {
            stats.renderMs.push(performance.now() - at);
          }
        };
        p.update = function (...a) {
          if (mode === 'none') return;
          const at = performance.now();
          try {
            stats.updates++;
            return update.apply(this, a);
          } finally {
            stats.updateMs.push(performance.now() - at);
          }
        };
        window.__PIXICOST_RESTORE__ = () => {
          p.update = update;
          p.renderer.render = render;
          p.canvas.style.removeProperty('visibility');
          p.canvas.style.visibility = '';
        };
        return {
          buffer: [e.canvas.width, e.canvas.height],
          hud: [p.canvas.width, p.canvas.height],
          nativeUnderlays: [
            getComputedStyle(ui.hurtLayer).display,
            getComputedStyle(ui.worldLayer).display,
          ],
          canvasVisible: p.canvas.checkVisibility({ visibilityProperty: true }),
          shared: p.renderer.gpu.device === r.renderer.backend.device,
          nativeAmmo: ui.ammo.presentReadout,
          nativeMapVisible: getComputedStyle(ui.minimap.root).display !== 'none',
          resolution: p.renderer.resolution,
        };
      }, mode);
      assert(setup.shared);
      assert.equal(setup.nativeAmmo, false);
      assert.equal(setup.nativeMapVisible, false);
      assert.deepEqual(setup.buffer, [1920, 1080]);
      assert.deepEqual(setup.hud, [1920, 1080]);
      assert.equal(setup.canvasVisible, mode === 'full');
      assert(setup.nativeUnderlays.every((v) => v !== 'none'));
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const before = (await cdp.send('Performance.getMetrics')).metrics;
      const measured = await page.evaluate(async () => {
        const e = window.__ENGINE__,
          f = window.__COST_FIXTURE__,
          stats = window.__PIXICOST_STATS__;
        const steps = [],
          intervals = [];
        let previous;
        for (let i = 0; i < 900; i++) {
          await new Promise(requestAnimationFrame);
          const now = performance.now();
          if (previous !== undefined) intervals.push(now - previous);
          previous = now;
          f.before(i);
          const at = performance.now();
          e.step();
          steps.push(performance.now() - at);
          f.after();
        }
        const summary = (a) => {
          if (!a.length) return { samples: 0, mean: 0, median: 0, p95: 0 };
          a.sort((a, b) => a - b);
          return {
            samples: a.length,
            mean: a.reduce((s, v) => s + v, 0) / a.length,
            median: a[Math.floor(a.length / 2)],
            p95: a[Math.floor(a.length * 0.95)],
          };
        };
        return {
          stepMs: summary(steps),
          intervalMs: summary(intervals),
          pixiUpdateMs: summary(stats.updateMs),
          pixiRenderCpuMs: summary(stats.renderMs),
          updates: stats.updates,
          drawAttempts: stats.drawAttempts,
          draws: stats.draws,
          report: JSON.parse(JSON.stringify(f.report)),
        };
      });
      validateCombatProfile(measured.report);
      assert.equal(measured.updates, mode === 'none' ? 0 : 900);
      assert.equal(measured.drawAttempts, mode === 'none' ? 0 : 900);
      assert.equal(measured.draws, mode === 'none' || mode === 'update' ? 0 : 900);
      const after = (await cdp.send('Performance.getMetrics')).metrics,
        metrics = {};
      for (const key of ['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'])
        metrics[key] =
          (1000 *
            (after.find((v) => v.name === key).value - before.find((v) => v.name === key).value)) /
          900;
      await page.evaluate(() => {
        window.__COST_FIXTURE__.dispose();
        window.__PIXICOST_RESTORE__();
      });
      let gpu = null;
      // Separate 900-frame diagnostic on one full run; no query/readback in timings.
      if (mode === 'full' && round === 0) {
        gpu = await page.evaluate(() =>
          window.__PIXICOST_API__.gpu(
            window.__ENGINE__,
            window.__PIXICOST_API__.create,
            window.__PIXICOST_API__.lane,
            900
          )
        );
        if (gpu.supported) {
          validateCombatProfile(gpu.report);
          assert.equal(gpu.samples, 150);
        }
      }
      await page.evaluate(() => window.__ENGINE__.dispose());
      assert.deepEqual(errors, []);
      const result = {
        run,
        round,
        mode,
        browser: browser.version(),
        device,
        setup,
        measured,
        metrics,
        gpu,
      };
      results.push(result);
      await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
      console.log(
        JSON.stringify({
          run,
          round,
          mode,
          interval: measured.intervalMs,
          step: measured.stepMs,
          update: measured.pixiUpdateMs,
          renderCpu: measured.pixiRenderCpuMs,
          metrics,
          gpu: gpu
            ? {
                supported: gpu.supported,
                samples: gpu.samples,
                ms: gpu.gpuPassMs,
                passes: gpu.passesPerFrame,
                draws: gpu.drawCalls,
                uploads: gpu.sampledTextureUploads,
              }
            : null,
        })
      );
      await page.close();
    }
} finally {
  await browser.close();
  stopViteServer(server);
}
