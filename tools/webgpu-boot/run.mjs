#!/usr/bin/env node
/** GPU-backed WebGPU-only boot / world-view compositing integration check. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureViteServer, launchChromium, stopViteServer } from '../lib/browser-harness.mjs';

const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(cache) ?
  readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .map((name) => join(cache, name, 'chrome-linux64/chrome')).find(existsSync) : null);
if (!executablePath) throw new Error('Full Chromium required for hardware WebGPU testing');
const port = 5198;
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({
  executablePath, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'],
});
try {
  const url = `http://127.0.0.1:${port}/tools/webgpu-boot/index.html`;
  async function rejectWithoutWebGL(noAdapter) {
    const context = await browser.newContext({ viewport: { width: 160, height: 96 } });
    try {
      await context.addInitScript((refuseAdapter) => {
        Object.defineProperty(navigator, 'gpu', {
          value: refuseAdapter ? { requestAdapter: async () => null } : undefined,
          configurable: true,
        });
        window.__WEBGL_REQUESTS__ = 0;
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          if (kind.startsWith('webgl')) window.__WEBGL_REQUESTS__++;
          return getContext.call(this, kind, ...args);
        };
      }, noAdapter);
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForFunction(() => window.__WEBGPU_BOOT__ !== undefined);
      const result = await page.evaluate(() => ({ ...window.__WEBGPU_BOOT__,
        webglRequests: window.__WEBGL_REQUESTS__ }));
      assert.equal(result.ok, false);
      assert.equal(result.webglRequests, 0, 'unsupported devices must not try WebGL');
      return result;
    } finally {
      await context.close();
    }
  }
  const result = await rejectWithoutWebGL(false);
  assert.match(result.error, /WebGPU is required/);
  // navigator.gpu exists, but adapter acquisition fails: still no fallback.
  const rejected = await rejectWithoutWebGL(true);
  assert.match(rejected.error, /Unable to create WebGPU adapter/);

  const page = await browser.newPage({ viewport: { width: 160, height: 96 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__WEBGPU_BOOT__ !== undefined);
  const boot = await page.evaluate(() => ({ ok: window.__WEBGPU_BOOT__.ok,
    error: window.__WEBGPU_BOOT__.error, backend: window.__WEBGPU_BOOT__.backend,
    worldSamples: window.__WEBGPU_BOOT__.worldSamples,
    weaponSamples: window.__WEBGPU_BOOT__.weaponSamples }));
  assert.equal(boot.ok, true, boot.error);
  assert.equal(boot.backend, 'WebGPUBackend');
  assert.equal(boot.worldSamples, 0);
  assert.equal(boot.weaponSamples, 4);

  // WebGPU's output target is HalfFloat; compare raw positive half-float
  // channels rather than relying on headless Chromium's black swapchain grabs.
  const pixel = (x, y) => page.evaluate(([px, py]) => window.__WEBGPU_BOOT__.probe(px, py), [x, y]);
  const background = await pixel(20, 20);
  const weapon = await pixel(80, 48);
  if (errors.length) console.error('WebGPU boot console:', errors);
  assert.ok(background[2] > background[0] + 1000, `world missing: ${background}`);
  assert.ok(weapon[0] > weapon[2] + 1000, `weapon missing: ${weapon}`);
  await page.evaluate(() => window.__WEBGPU_BOOT__.resize(200, 120));
  await page.setViewportSize({ width: 200, height: 120 });
  assert.ok((await pixel(100, 60))[0] > 1000, 'resize lost weapon pass');
  await page.evaluate(() => window.__WEBGPU_BOOT__.dispose());
  assert.equal(await page.evaluate(() => window.__WEBGPU_BOOT__.disposed), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, backend: boot.backend, background, weapon,
    samples: [boot.worldSamples, boot.weaponSamples], unsupported: result,
    noAdapter: rejected }, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
