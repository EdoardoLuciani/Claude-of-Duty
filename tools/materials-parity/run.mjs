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
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
const measureOnly = process.argv.includes('--measure');
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({ executablePath, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/tools/materials-parity/index.html${only ? `?only=${encodeURIComponent(only)}` : ''}`);
  await page.waitForFunction(() => window.__MATERIAL_PARITY__ !== undefined, null, { timeout: 600000 });
  const result = await page.evaluate(() => window.__MATERIAL_PARITY__);
  assert.equal(result.ok, true, result.error ?? result.stack);
  const dense = new Set(['asphalt', 'dirt', 'gravel', 'brick']);
  const generated = new Set(['asphalt', 'dirt', 'gravel', 'concrete', 'concrete_floor',
    'brick', 'plaster', 'tile', 'metal_rust', 'metal_painted', 'corrugated',
    'wood', 'fabric', 'burlap']);
  for (const [name, maps] of Object.entries(result.results)) {
    if (measureOnly) continue; // Diagnostics, never a parity pass.
    if (generated.has(name)) {
      for (const key of ['albedo', 'orm']) {
        assert.ok(maps[key].mean.every((x) => x < 1) && maps[key].peak.every((x) => x < 50),
          `${name} ${key} channel drift: ${JSON.stringify(maps[key])}`);
      }
      const normalBound = name === 'burlap' ? 20 : dense.has(name) ? 7 : 6;
      assert.ok(maps.normal.mean.every((x) => x < normalBound) &&
        maps.normal.peak.every((x) => x < 80),
      `${name} normal drift: ${JSON.stringify(maps.normal)}`);
    } else if (name === 'rubber' || name === 'weapon_anodised') {
      // Its combined Worley/FBM shader is sensitive to instruction ordering
      // across backends. Bound the measured per-pixel drift, including AO and
      // height; these still need representative in-game visual comparison.
      for (const [key, bounds] of Object.entries({
        albedo: [2, 2, 2, 9], orm: [16, 6, 0.01, 0.01], normal: [5, 5, 1, 0.01],
      })) {
        assert.ok(maps[key].mean.every((x, i) => x < bounds[i]),
          `${name} ${key} drift: ${JSON.stringify(maps[key])}`);
      }
      assert.ok(maps.orm.peak[0] < 55 && maps.albedo.peak[3] < 30,
        `${name} cavity/height outliers: ${JSON.stringify(maps)}`);
    } else if (name === 'sand') {
      // A 64px diagnostic tile undersamples the 1K sand grain/ripple bake;
      // accept the measured backend normal-gradient drift, not flat maps.
      assert.ok(maps.albedo.mean.every((x) => x < 2) && maps.albedo.peak.every((x) => x < 7),
        `sand albedo drift: ${JSON.stringify(maps.albedo)}`);
      assert.ok(maps.orm.mean.every((x) => x < 3) && maps.orm.peak.every((x) => x < 12),
        `sand ORM drift: ${JSON.stringify(maps.orm)}`);
      assert.ok(maps.normal.mean[0] < 8 && maps.normal.mean[1] < 15 &&
        maps.normal.peak[0] < 40 && maps.normal.peak[1] < 70,
      `sand normal drift: ${JSON.stringify(maps.normal)}`);
    } else {
      for (const key of ['albedo', 'orm']) {
        assert.ok(maps[key].mean.every((x) => x < 1) && maps[key].peak.every((x) => x <= 3),
          `${name} ${key} not faithful to authored GLSL: ${JSON.stringify(maps[key])}`);
      }
    }
    if (name !== 'sand' && !generated.has(name)) {
      assert.ok(maps.normal.mean.every((x) => x < 5) && maps.normal.peak.every((x) => x < 80),
        `${name} normal map diverged: ${JSON.stringify(maps.normal)}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
