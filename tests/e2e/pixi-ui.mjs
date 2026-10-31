// Opt-in library experiment; timings are observations, not CI thresholds.
// node tests/e2e/pixi-ui.mjs --out=/tmp/pixi-ui
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
import { capturePixi } from '../lib/pixi-capture.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5195);
const out = resolve(String(args.out ?? '/tmp/pixi-ui'));
await mkdir(out, { recursive: true });
const server = await ensureViteServer({ port, preview: Boolean(args.preview) });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist'] });
const results = [];
try {
  for (const variant of ['default', 'pixi', 'retina', 'unavailable']) {
    const enabled = variant !== 'default';
    const isRetina = variant === 'retina';
    const page = await browser.newPage({
      viewport: isRetina ? { width: 960, height: 900 } : { width: 1920, height: 1080 },
      deviceScaleFactor: isRetina ? 2 : 1,
    });
    // Cold headless Chromium can return null before its Vulkan process is ready;
    // a minified build reaches requestAdapter much sooner than Vite source mode.
    // Warm only adapter metadata, not a device, before installing test counters.
    if (args.preview) {
      await page.goto(`http://localhost:${port}/LICENSE.txt`);
      await page.waitForFunction(
        async () => {
          const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance',
          });
          return adapter?.info.isFallbackAdapter === false;
        },
        null,
        { timeout: 15000 }
      );
    }
    const errors = [],
      pixiRequests = [];
    collectBrowserErrors(page, errors, { validationMessages: true });
    page.on('request', (request) => {
      if (/pixi|tweedle/.test(request.url())) pixiRequests.push(request.url());
    });
    await page.addInitScript((failMetadata) => {
      const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
      let adapters = 0;
      navigator.gpu.requestAdapter = (...args) =>
        failMetadata && ++adapters > 1 ? Promise.resolve(null) : requestAdapter(...args);
      window.__GPU_PROBE__ = { devices: 0, destroys: 0, webgl: 0 };
      const request = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = function (...args) {
        window.__GPU_PROBE__.devices++;
        return request.apply(this, args);
      };
      const destroy = GPUDevice.prototype.destroy;
      GPUDevice.prototype.destroy = function () {
        window.__GPU_PROBE__.destroys++;
        return destroy.call(this);
      };
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (/^(webgl2?|experimental-webgl)$/.test(type)) window.__GPU_PROBE__.webgl++;
        return getContext.call(this, type, ...args);
      };
    }, variant === 'unavailable');
    await page.goto(
      `http://localhost:${port}/?capture=1&lockstep=1&q=low${enabled ? '&pixi=1' : ''}`
    );
    const device = await waitForGame(page);
    // Known upstream boot warnings only; the library must introduce no new ones.
    errors.splice(
      0,
      errors.length,
      ...errors.filter((s) => !/THREE.TSL: Return statement used/.test(s))
    );
    const initial = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        p = ui.pixiExperiment;
      ui.menu.show();
      await window.__PUMP__(30);
      return {
        ...window.__GPU_PROBE__,
        panel: !!p,
        shared: p ? p.renderer.gpu.device === e.ctx.get('render').renderer.backend.device : null,
        worldSize: [e.canvas.width, e.canvas.height],
        panelSize: p ? [p.canvas.width, p.canvas.height] : null,
        draws: p?.draws ?? 0,
      };
    });
    console.log({ variant, device, initial, pixiRequests: pixiRequests.length });
    assert.equal(initial.panel, variant === 'pixi' || isRetina);
    assert.equal(initial.devices, 1, 'no second GPUDevice');
    assert.equal(initial.webgl, 0, 'strict WebGPU, not a WebGL fallback');
    assert.equal(initial.destroys, 0);
    if (!enabled) {
      assert.deepEqual(pixiRequests, [], 'default path must not load Pixi');
      await captureNative(page, resolve(out, 'before-native.png'));
      assert.deepEqual(errors, [], 'default browser errors');
      results.push({ variant, device, initial });
      await page.close();
      continue;
    }
    if (variant === 'unavailable') {
      assert(
        await page
          .getByRole('status')
          .filter({ hasText: 'Pixi experiment unavailable' })
          .isVisible()
      );
      assert(await page.getByRole('button', { name: 'Resume', exact: true }).isVisible());
      assert.deepEqual(errors, [], 'failure must be isolated from gameplay');
      results.push({ variant, device, initial });
      await page.close();
      continue;
    }
    assert.equal(initial.shared, true);
    assert.equal(initial.draws, 1, 'idle panel is demand-rendered');
    await page.locator('.ow-pixi-experiment').scrollIntoViewIfNeeded();
    const rect = await page.locator('.ow-pixi-experiment canvas').boundingBox();
    assert(rect);
    const point = (x, y) => ({
      x: rect.x + (x * rect.width) / 480,
      y: rect.y + (y * rect.height) / 360,
    });
    const state = () =>
      page.evaluate(() => {
        const p = window.__ENGINE__.ctx.get('ui').pixiExperiment;
        return {
          state: p.stage.children.find((c) => c.onPress && c.x === 248).state,
          draws: p.draws,
        };
      });
    const reset = point(320, 295),
      outside = { x: rect.x - 10, y: rect.y + 10 };
    const beforeHover = await state();
    await page.mouse.move(reset.x, reset.y);
    await page.evaluate(() => window.__PUMP__(1));
    const hover = await state();
    assert.equal(hover.state, 'hover');
    assert(hover.draws > beforeHover.draws, 'hover must actually redraw');
    await page.mouse.down();
    await page.evaluate(() => window.__PUMP__(1));
    const pressed = await state();
    assert.equal(pressed.state, 'pressed');
    assert(pressed.draws > hover.draws, 'pressed skin must actually redraw');
    await page.mouse.move(outside.x, outside.y);
    await page.mouse.up();
    await page.evaluate(() => window.__PUMP__(1));
    const released = await state();
    assert.equal(released.state, 'default');
    assert(released.draws > pressed.draws, 'release outside must redraw');
    await page.mouse.move(reset.x, reset.y);
    await page.mouse.down();
    await page.evaluate(() => window.__PUMP__(1));
    const beforeCancel = await state();
    await page.locator('.ow-pixi-experiment canvas').dispatchEvent('pointercancel');
    await page.evaluate(() => window.__PUMP__(1));
    const cancelled = await state();
    assert.notEqual(cancelled.state, 'pressed');
    assert(cancelled.draws > beforeCancel.draws, 'cancellation must redraw');
    await page.mouse.move(outside.x, outside.y);
    await page.mouse.up();
    const press = point(110, 295);
    await page.mouse.click(press.x, press.y);
    await page.evaluate(() => window.__PUMP__(30));
    assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').pixiExperiment.hits), 1);
    const start = point(240, 240),
      end = point(370, 240);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await page.evaluate(() => window.__PUMP__(2));
    const dragged = await page.evaluate(
      () => window.__ENGINE__.ctx.get('ui').pixiExperiment.slider.value
    );
    assert(dragged > 65, `pointer slider: ${dragged}`);
    await page.locator('.ow-pixi-experiment canvas').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await page.evaluate(() => window.__ENGINE__.ctx.get('ui').pixiExperiment.slider.value),
      dragged + 1
    );
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').pixiExperiment.hits), 2);
    await page.keyboard.press('r');
    await page.evaluate(async () => {
      await window.__PUMP__(30);
      window.__ENGINE__.input.enabled = true;
      window.__ENGINE__.input.frozen = false;
    });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__PUMP__(1));
    assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').menu.open), false);
    await page.evaluate(async () => {
      const e = window.__ENGINE__;
      e.input.enabled = false;
      e.input.frozen = true;
      e.ctx.get('ui').menu.show();
      await window.__PUMP__(30);
    });
    const measurements = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        p = e.ctx.get('ui').pixiExperiment;
      const times = { unchanged: [], changingText: [] },
        drawCounts = [];
      const original = p.renderer.render;
      let draws = 0,
        inPixi = false,
        phase = 'unchanged';
      const prototype = GPURenderPassEncoder.prototype;
      const native = { draw: prototype.draw, drawIndexed: prototype.drawIndexed };
      for (const key of ['draw', 'drawIndexed'])
        prototype[key] = function (...args) {
          if (inPixi) draws++;
          return native[key].apply(this, args);
        };
      p.renderer.render = function (...args) {
        const start = performance.now(),
          before = draws;
        inPixi = true;
        try {
          return original.apply(this, args);
        } finally {
          inPixi = false;
          times[phase].push(performance.now() - start);
          drawCounts.push(draws - before);
        }
      };
      const texturesBefore = p.renderer.texture.managedTextures.length;
      try {
        // Force dirty redraws to isolate retained, unchanged content submission.
        for (let i = 0; i < 60; i++) {
          p.dirty = true;
          await window.__PUMP__(1);
        }
        phase = 'changingText';
        for (let i = 0; i < 120; i++) {
          p.slider.value = i % 101;
          p.slider.onUpdate.emit(p.slider.value);
          await window.__PUMP__(1);
        }
      } finally {
        p.renderer.render = original;
        Object.assign(prototype, native);
      }
      const before = p.draws;
      await window.__PUMP__(30);
      const idleDraws = p.draws - before;
      e.ctx.get('ui').menu.close();
      const closedAt = p.draws;
      await window.__PUMP__(30);
      const closedDraws = p.draws - closedAt;
      e.ctx.get('ui').menu.show();
      await window.__PUMP__(30);
      const summary = (values) => {
        values.sort((a, b) => a - b);
        return {
          median: values[Math.floor(values.length / 2)],
          p95: values[Math.floor(values.length * 0.95)],
          mean: values.reduce((a, b) => a + b, 0) / values.length,
        };
      };
      return {
        redrawCpuMs: {
          unchanged: summary(times.unchanged),
          changingText: summary(times.changingText),
        },
        drawsPerRedraw: [...new Set(drawCounts)],
        texturesBefore,
        texturesAfter: p.renderer.texture.managedTextures.length,
        idleDraws,
        closedDraws,
        paused: e.time.scale === 0,
        gameError: e.error,
        probe: window.__GPU_PROBE__,
      };
    });
    console.log(measurements);
    assert.equal(measurements.idleDraws, 0);
    assert.equal(measurements.closedDraws, 0);
    assert.equal(measurements.paused, true);
    assert.equal(measurements.gameError, null);
    assert(
      measurements.drawsPerRedraw.every((n) => n > 0),
      'count actual native draw commands'
    );
    assert.equal(
      measurements.texturesBefore,
      measurements.texturesAfter,
      'settled text resource count'
    );
    const screenshot = (name) => capturePixi(page, resolve(out, name));
    await page.locator('.ow-pixi-experiment').scrollIntoViewIfNeeded();
    const retina = await page.evaluate(() => {
      const p = window.__ENGINE__.ctx.get('ui').pixiExperiment;
      return {
        width: p.canvas.width,
        cssWidth: p.canvas.clientWidth,
        resolution: p.renderer.resolution,
      };
    });
    assert.equal(retina.resolution, isRetina ? 2 : 1);
    assert.equal(retina.width, retina.cssWidth * retina.resolution);
    await screenshot(isRetina ? 'pixi-dpr2.png' : 'after-pixi.png');
    const lifetime = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        p = ui.pixiExperiment;
      p.dispose();
      ui.pixiExperiment = null;
      const afterPanel = { ...window.__GPU_PROBE__ };
      await window.__PUMP__(3); // shared device and gameplay rendering still work
      await e.dispose();
      return {
        afterPanel,
        afterEngine: { ...window.__GPU_PROBE__ },
        detached: !document.querySelector('.ow-pixi-experiment'),
      };
    });
    assert.equal(lifetime.afterPanel.destroys, 0, 'Pixi teardown must not destroy Three device');
    assert.equal(lifetime.afterEngine.destroys, 1, 'Three remains sole device owner');
    assert.equal(lifetime.detached, true);
    assert.deepEqual(errors, [], 'browser/WebGPU errors');
    results.push({ variant, device, initial, dragged, measurements, retina, lifetime });
    await page.close();
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
} finally {
  await browser.close();
  stopViteServer(server);
}
