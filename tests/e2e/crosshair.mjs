// Opt-in experiment and measurement, not a timing-threshold CI test.
// node tests/e2e/crosshair.mjs --out=/tmp/crosshair-experiment --frames=120
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
import { waitForGame, captureNative } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5194);
const frames = Number(args.frames ?? 120);
const quality = String(args.q ?? 'high');
const out = resolve(String(args.out ?? '/tmp/crosshair-experiment'));
await mkdir(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist'] });
const results = [];
try {
  for (const mode of ['dom', 'gpu']) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    collectBrowserErrors(page, errors, { validationMessages: true });
    await page.goto(
      `http://localhost:${port}/?capture=1&lockstep=1&shot=hero&q=${quality}&crosshair=${mode}`
    );
    const device = await waitForGame(page);
    // Two known upstream TSL inline-Fn warnings during boot are unrelated.
    const bootWarnings = errors.filter((s) => /THREE.TSL: Return statement used/.test(s));
    errors.splice(0, errors.length, ...errors.filter((s) => !bootWarnings.includes(s)));
    await page.evaluate(async () => {
      const e = window.__ENGINE__;
      e.ctx.get('render').settings.autoExposure = false;
      await window.__PUMP__(20);
    });
    const result = await page.evaluate(
      async ({ frames, mode }) => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui'),
          render = e.ctx.get('render');
        const cross = ui.crosshair,
          renderer = render.renderer;
        if (Boolean(cross.gpu) !== (mode === 'gpu')) throw new Error('wrong presenter');
        if (document.querySelectorAll('.ow-cross').length !== (mode === 'dom' ? 1 : 0))
          throw new Error('duplicate or missing DOM crosshair');
        const summarize = (samples) => {
          samples.sort((a, b) => a - b);
          return {
            mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
            median: samples[Math.floor(samples.length / 2)],
            p95: samples[Math.floor(samples.length * 0.95)],
          };
        };
        // Identical animated inputs; batch timing avoids timer resolution dominating
        // a tiny update. This excludes deferred browser style/paint/compositing work.
        const input = { move: 0.5, baseSpread: 6, ads: false, hidden: false };
        const updateSamples = [];
        for (let round = -2; round < 9; round++) {
          const start = performance.now();
          for (let i = 0; i < 20000; i++) {
            input.move = (i % 120) / 120;
            input.ads = i % 300 > 240;
            if (i % 10 === 0) cross.onFire();
            if (i % 53 === 0) cross.onHit();
            cross.update(1 / 60, input);
          }
          if (round >= 0) updateSamples.push((performance.now() - start) / 20000);
        }
        await window.__PUMP__(30);
        let writes = 0;
        const observer = new MutationObserver((records) => {
          writes += records.length;
        });
        if (cross.root)
          observer.observe(cross.root, {
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
          });
        const originalUpdate = cross.update;
        cross.update = function (dt, state) {
          if (e.time.frame % 10 === 0) this.onFire(0.7);
          return originalUpdate.call(this, dt, state);
        };
        const steps = [],
          drawCpu = [],
          drawCalls = [],
          gpuTimes = [];
        const originalHud = render.hudDraw;
        const timestamps = renderer.backend.device.features.has('timestamp-query');
        const oldTrack = renderer.backend.trackTimestamp;
        renderer.backend.trackTimestamp = false;
        if (originalHud)
          render.hudDraw = (r) => {
            const start = performance.now(),
              draws = r.info.render.drawCalls;
            originalHud(r);
            drawCpu.push(performance.now() - start);
            drawCalls.push(r.info.render.drawCalls - draws);
          };
        const originalStep = e.step;
        e.step = function (...a) {
          const start = performance.now();
          originalStep.apply(this, a);
          steps.push(performance.now() - start);
        };
        const resources = () => ({
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          programs: renderer.info.memory.programs,
        });
        const before = resources();
        try {
          await window.__PUMP__(frames);
        } finally {
          e.step = originalStep;
          cross.update = originalUpdate;
          render.hudDraw = originalHud;
          renderer.backend.trackTimestamp = oldTrack;
          observer.disconnect();
        }
        const animatedWrites = writes;
        await window.__PUMP__(120); // let the final recoil settle
        writes = 0;
        if (cross.root)
          observer.observe(cross.root, {
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
          });
        await window.__PUMP__(30);
        observer.disconnect();
        const stationaryWrites = writes;
        // Separate diagnostic phase: only the HUD pass is timestamped. Query
        // readback changes pacing, so these frames are excluded from CPU samples.
        if (originalHud && timestamps) {
          render.hudDraw = (r) => {
            r.backend.trackTimestamp = true;
            try {
              originalHud(r);
            } finally {
              r.backend.trackTimestamp = false;
            }
          };
          try {
            for (let i = 0; i < 60; i++) {
              await window.__PUMP__(1);
              renderer.backend.trackTimestamp = true;
              const ms = await renderer.resolveTimestampsAsync('render');
              renderer.backend.trackTimestamp = false;
              if (!Number.isFinite(ms)) throw new Error('missing GPU timestamp sample');
              gpuTimes.push(ms);
            }
          } finally {
            render.hudDraw = originalHud;
            renderer.backend.trackTimestamp = oldTrack;
          }
        }
        return {
          mode,
          frames,
          updateMs: summarize(updateSamples),
          engineStepMs: summarize(steps),
          hudSubmitMs: drawCpu.length ? summarize(drawCpu) : null,
          hudGpuPassMs: gpuTimes.length ? summarize(gpuTimes) : null,
          extraDraws: [...new Set(drawCalls)],
          styleMutations: animatedWrites,
          stationaryStyleMutations: stationaryWrites,
          resourcesBefore: before,
          resourcesAfter: resources(),
          cssSize: [render.displaySize.width, render.displaySize.height],
          bufferSize: [render.screenSize.width, render.screenSize.height],
        };
      },
      { frames, mode }
    );
    // Native capture helper normally draws just the world graph. Extend only this
    // test's capture invocation to include the experimental post-world HUD slot.
    if (mode === 'gpu')
      await page.evaluate(() => {
        const r = window.__ENGINE__.ctx.get('render');
        const original = r._graph.render;
        r._graph.render = function () {
          original.call(this);
          r.hudDraw?.(r.renderer);
        };
        window.__RESTORE_CROSSHAIR_CAPTURE__ = () => {
          r._graph.render = original;
        };
      });
    for (const scale of [1, 0.8, 0.72]) {
      await page.evaluate(
        ({ scale }) => {
          const e = window.__ENGINE__,
            r = e.ctx.get('render'),
            ui = e.ctx.get('ui');
          r.q = { ...r.q, renderScale: scale };
          r.resize(innerWidth, innerHeight);
          ui.crosshair.kick =
            ui.crosshair.kickVel =
            ui.crosshair.moveSpread =
            ui.crosshair.adsBlend =
            ui.crosshair.hitPulse =
              0;
          ui.crosshair.visible = ui.hudVisible = 1;
          ui.crosshair.update(0, { baseSpread: 6 });
        },
        { scale }
      );
      await captureNative(page, resolve(out, `${mode}-${scale}.png`));
    }
    await page.evaluate(() => {
      const e = window.__ENGINE__,
        r = e.ctx.get('render');
      r.q = { ...r.q, renderScale: 1 };
      r.resize(innerWidth, innerHeight);
      e.ctx.camera.rotateX(0.6);
      e.ctx.camera.updateMatrixWorld(true);
    });
    await captureNative(page, resolve(out, `${mode}-bright.png`));
    await page.evaluate(() => {
      const e = window.__ENGINE__;
      e.ctx.camera.rotateX(-0.6);
      e.ctx.camera.updateMatrixWorld(true);
      const ui = e.ctx.get('ui');
      ui.health.onDamage(1);
      ui.health.update(0.02, ui.state);
    });
    await captureNative(page, resolve(out, `${mode}-damage.png`));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 960,
      height: 540,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await page.evaluate(() => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui');
      e.resize();
      ui.crosshair.update(0, { baseSpread: 6 });
    });
    await captureNative(page, resolve(out, `${mode}-narrow-dpr2.png`));
    await cdp.detach();
    await page.evaluate(() => window.__RESTORE_CROSSHAIR_CAPTURE__?.());
    // Exercise native visibility/fade paths without changing the player/loadout.
    const checks = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        c = ui.crosshair;
      ui.setHudVisible(false);
      await window.__PUMP__(90);
      const hidden = ui.hudVisible < 0.004;
      ui.setHudVisible(true);
      await window.__PUMP__(60);
      ui.menu.show();
      await window.__PUMP__(60);
      const paused = e.time.scale === 0 && ui.hudVisible < 0.16;
      ui.menu.close();
      await window.__PUMP__(60);
      const resumed = ui.hudVisible > 0.99;
      c.update(1 / 60, { ads: true });
      for (let i = 0; i < 90; i++) c.update(1 / 60, { ads: true });
      const adsHidden = c.visible < 0.004;
      e.ctx.get('player').applyDamage(1000, null);
      await window.__PUMP__(90);
      const deathHidden = ui.hudTarget === 0 && ui.hudVisible < 0.004;
      e.ctx.events.emit('game:restart', { source: 'crosshair-test' });
      await window.__PUMP__(90);
      const restarted = ui.hudTarget === 1 && ui.hudVisible > 0.99;
      return { hidden, paused, resumed, adsHidden, deathHidden, restarted, engineError: e.error };
    });
    assert.deepEqual(checks, {
      hidden: true,
      paused: true,
      resumed: true,
      adsHidden: true,
      deathHidden: true,
      restarted: true,
      engineError: null,
    });
    assert.deepEqual(errors, [], `${mode}: browser/WebGPU errors`);
    if (mode === 'gpu') assert.deepEqual(result.extraDraws, [1]);
    assert.deepEqual(result.resourcesBefore, result.resourcesAfter, `${mode}: resource growth`);
    const lifetime = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        r = e.ctx.get('render');
      const gpu = ui.crosshair.gpu;
      ui.installStartGate();
      await window.__PUMP__(2);
      const waitingHidden = !gpu || !gpu.enabled;
      await e.dispose();
      return { waitingHidden, detached: r.hudDraw === null, disposed: !gpu || !gpu.enabled };
    });
    assert.deepEqual(lifetime, { waitingHidden: true, detached: true, disposed: true });
    assert.deepEqual(errors, [], `${mode}: teardown errors`);
    results.push({ device, quality, ...result, checks, lifetime });
    console.log(JSON.stringify(results.at(-1), null, 2));
    await page.close();
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
} finally {
  await browser.close();
  stopViteServer(server);
}
