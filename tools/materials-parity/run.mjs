#!/usr/bin/env node
/** Compare authored GLSL and TSL texture bakes on the same hardware. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureViteServer, launchChromium, stopViteServer } from '../lib/browser-harness.mjs';

const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(cache) ?
  readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .map((name) => join(cache, name, 'chrome-linux64/chrome')).find(existsSync) : null);
if (!executablePath) throw new Error('Full Chromium required for material GPU parity');
const port = 5200;
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({ executablePath, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/tools/materials-parity/index.html`);
  await page.waitForFunction(() => window.__MATERIAL_PARITY__ !== undefined, null, { timeout: 120000 });
  const result = await page.evaluate(() => window.__MATERIAL_PARITY__);
  assert.equal(result.ok, true, result.error ?? result.stack);
  for (const [name, maps] of Object.entries(result.results)) {
    for (const key of ['albedo', 'orm']) {
      assert.ok(maps[key].mean.every((x) => x < 1) && maps[key].peak.every((x) => x <= 3),
        `${name} ${key} not faithful to authored GLSL: ${JSON.stringify(maps[key])}`);
    }
    assert.ok(maps.normal.mean.every((x) => x < 4) && maps.normal.peak.every((x) => x < 80),
      `${name} normal map diverged: ${JSON.stringify(maps.normal)}`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
