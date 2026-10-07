#!/usr/bin/env node
/** Exercise the actual WebGPU render owner, not a separate test-only renderer. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataUtils } from 'three';
import { ensureViteServer, launchChromium, stopViteServer } from '../lib/browser-harness.mjs';

const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(cache) ?
  readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .map((name) => join(cache, name, 'chrome-linux64/chrome')).find(existsSync) : null);
if (!executablePath) throw new Error('Full Chromium required for WebGPU owner probe');
const port = 5195;
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({ executablePath, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const url = `http://127.0.0.1:${port}/tools/webgpu-owner/index.html`;
  const unsupported = await browser.newContext();
  await unsupported.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    window.__WEBGL_CALLS__ = 0;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type.startsWith('webgl')) window.__WEBGL_CALLS__++;
      return original.call(this, type, ...args);
    };
  });
  const noGpu = await unsupported.newPage();
  await noGpu.goto(url);
  await noGpu.waitForFunction(() => window.__OWNER_PROBE__ !== undefined);
  const rejected = await noGpu.evaluate(() => ({ ...window.__OWNER_PROBE__, webgl: window.__WEBGL_CALLS__ }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /WebGPU is required/);
  assert.equal(rejected.webgl, 0);
  await unsupported.close();

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404 (Not Found)')) errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__OWNER_PROBE__ !== undefined, null, { timeout: 120000 });
  const result = await page.evaluate(() => window.__OWNER_PROBE__);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(errors, []);
  assert.equal(result.backend, 'WebGPUBackend');
  assert.equal(result.worldSamples, 0);
  assert.equal(result.weaponSamples, 0);
  const metres = DataUtils.fromHalfFloat(result.linearDepth[0]);
  assert.ok(metres > 2 && metres < 4, `soft-FX depth must be view metres: ${metres}`);
  assert.ok(result.pixel[0] > 0 && result.resized[0] > 0 &&
    result.width === 112 && result.height === 72,
    `world pass or resize failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  stopViteServer(server);
}
