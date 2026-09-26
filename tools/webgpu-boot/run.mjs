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
  const context = await browser.newContext({ viewport: { width: 160, height: 96 } });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    window.__WEBGL_REQUESTS__ = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind.startsWith('webgl')) window.__WEBGL_REQUESTS__++;
      return getContext.call(this, kind, ...args);
    };
  });
  const unsupported = await context.newPage();
  await unsupported.goto(url);
  await unsupported.waitForFunction(() => window.__WEBGPU_BOOT__ !== undefined);
  const result = await unsupported.evaluate(() => ({ ...window.__WEBGPU_BOOT__,
    webglRequests: window.__WEBGL_REQUESTS__ }));
  assert.equal(result.ok, false, 'no navigator.gpu must fail before rendering');
  assert.match(result.error, /WebGPU is required/);
  assert.equal(result.webglRequests, 0, 'no WebGL context even on unsupported devices');
  await context.close();

  // navigator.gpu exists, but no adapter can be acquired: Three's usual
  // automatic WebGL2 fallback must still never be constructed.
  const noAdapterContext = await browser.newContext();
  await noAdapterContext.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      value: { requestAdapter: async () => null }, configurable: true,
    });
    window.__WEBGL_REQUESTS__ = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind.startsWith('webgl')) window.__WEBGL_REQUESTS__++;
      return getContext.call(this, kind, ...args);
    };
  });
  const noAdapter = await noAdapterContext.newPage();
  await noAdapter.goto(url);
  await noAdapter.waitForFunction(() => window.__WEBGPU_BOOT__ !== undefined);
  const rejected = await noAdapter.evaluate(() => ({ ...window.__WEBGPU_BOOT__,
    webglRequests: window.__WEBGL_REQUESTS__ }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Unable to create WebGPU adapter/);
  assert.equal(rejected.webglRequests, 0, 'adapter rejection must not try WebGL');
  await noAdapterContext.close();

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
