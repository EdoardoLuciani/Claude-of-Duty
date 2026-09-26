#!/usr/bin/env node
/** Strict-WebGPU all-palette world GLB material compilation, no WebGL fallback. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { ensureViteServer, launchChromium, stopViteServer } from '../lib/browser-harness.mjs';

const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(cache) ?
  readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .map((name) => join(cache, name, 'chrome-linux64/chrome')).find(existsSync) : null);
if (!executablePath) throw new Error('Full Chromium required for world material probe');
const port = 5200;
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({ executablePath, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404 (Not Found)')) errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/tools/material-node/full.html${process.env.CAPTURE_DIR ? '?capture=1' : ''}`);
  await page.waitForFunction(() => window.__MATERIAL_WORLD__ !== undefined, null, { timeout: 600000 });
  const result = await page.evaluate(() => window.__MATERIAL_WORLD__);
  assert.equal(result.ok, true, result.stack ?? result.error);
  assert.deepEqual(errors, []);
  assert.equal(result.meshes, 211);
  assert.equal(result.instances, 7806);
  assert.equal(result.names, 19);
  assert.ok(result.palettes > 35 && result.changed > 5000 && result.colorBins > 40,
    `world material scene failed to draw: ${JSON.stringify({ ...result, pixels: null })}`);
  if (process.env.CAPTURE_DIR) {
    mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
    const png = new PNG({ width: 480, height: 270 });
    png.data = Buffer.from(result.pixels);
    writeFileSync(join(process.env.CAPTURE_DIR, 'world.png'), PNG.sync.write(png));
  }
  delete result.pixels;
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
