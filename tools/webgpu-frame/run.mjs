#!/usr/bin/env node
/** Two-GPU WebGPU frame graph: world motion/velocity, SSR, TAA, AgX and display LUT. */
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
if (!executablePath) throw new Error('Full Chromium with hardware WebGPU is required');
const port = 5196;
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({ executablePath, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  let healthyEdge = null;
  for (const query of ['?grade=1', '?ssr=1', '?taa=1&ssr=1&grade=1',
    '?low=1&grade=1']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('404 (Not Found)')) errors.push(m.text());
    });
    await page.goto(`http://127.0.0.1:${port}/tools/webgpu-frame/index.html${query}`);
    await page.waitForFunction(() => window.__CASE_RESULT__ !== undefined, null, { timeout: 120000 });
    const result = await page.evaluate(() => window.__CASE_RESULT__);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(errors, [], `frame graph GPU errors: ${query}`);
    assert.ok(result.world[0] > 0, 'world HDR pass should draw');
    assert.ok(result.pixel[0] > (query.includes('low') ? 30 : 50) &&
      result.pixel[3] === 255,
      `final pass should survive camera motion: ${result.pixel}`);
    if (query === '?grade=1') healthyEdge = result.edge;
    if (query.includes('low'))
      assert.ok(result.edge[0] > healthyEdge[0] + 40 &&
        result.edge[0] > result.edge[1] * 6,
        `low-health rim must be redder than the healthy edge: ${result.edge}`);
    if (query.includes('taa')) {
      assert.ok(result.velocity, 'TAA requires a velocity MRT');
      const vx = DataUtils.fromHalfFloat(result.velocity[0]);
      assert.ok(Math.abs(vx) > 0.001, `camera-motion velocity is missing: ${vx}`);
    }
    console.log(JSON.stringify({ query, output: result.pixel, edge: result.edge,
      velocity: result.velocity }));
    await page.close();
  }
} finally {
  await browser.close();
  stopViteServer(server);
}
