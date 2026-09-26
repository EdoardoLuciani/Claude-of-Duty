#!/usr/bin/env node
/** GPU-backed WebGPU-only boot / world-view compositing integration check. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Color, DataUtils } from 'three';
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
  assert.equal(boot.weaponSamples, 0);

  // WebGPU's output target is HalfFloat; compare raw positive half-float
  // channels rather than relying on headless Chromium's black swapchain grabs.
  const pixel = (x, y) => page.evaluate(([px, py]) => window.__WEBGPU_BOOT__.probe(px, py), [x, y]);
  const background = await pixel(20, 20);
  const weapon = await pixel(80, 48);
  if (errors.length) console.error('WebGPU boot console:', errors);
  assert.ok(background[2] > background[0] + 1000, `world missing: ${background}`);
  assert.ok(weapon[0] > weapon[2] + 1000, `weapon missing: ${weapon}`);
  const opacity = DataUtils.fromHalfFloat(await page.evaluate(() => window.__WEBGPU_BOOT__.viewAlpha(128, 48)));
  assert.equal(opacity, 0.25, 'optic layer must exercise partial alpha');
  const blend = (await pixel(128, 48)).map(DataUtils.fromHalfFloat);
  const expected = new Color(0x246eb1).lerp(new Color(0xf06442), opacity)
    .convertLinearToSRGB().toArray();
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(blend[i] - expected[i]) < 0.015,
      `view-layer blend channel ${i}: ${blend[i]} expected ${expected[i]}`);
  }
  assert.ok(Math.abs(blend[3] - 1) < 0.01, `opaque world must leave blend opaque: ${blend}`);
  const normal = (await page.evaluate(() => window.__WEBGPU_BOOT__.probeNormal()))
    .map(DataUtils.fromHalfFloat);
  const slopeX = 16 / 45, slopeY = 32 / 45;
  const length = Math.hypot(slopeX, slopeY, 1);
  const expectedNormal = [0.5 - slopeX / (2 * length), 0.5 - slopeY / (2 * length),
    0.5 + 1 / (2 * length), 1];
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(normal[i] - expectedNormal[i]) < 0.005,
      `TSL Sobel channel ${i}: ${normal[i]} expected ${expectedNormal[i]}`);
  }
  const macro = await page.evaluate(() => window.__WEBGPU_BOOT__.probeMacro());
  const a = macro.center.map(DataUtils.fromHalfFloat);
  const tiled = macro.adjacent.map(DataUtils.fromHalfFloat);
  const other = macro.other.map(DataUtils.fromHalfFloat);
  for (let i = 0; i < 4; i++) {
    assert.ok(a[i] >= 0 && a[i] <= 1, `TSL macro channel ${i}: ${a}`);
    assert.ok(Math.abs(a[i] - tiled[i]) < 0.005,
      `TSL macro tile seam channel ${i}: ${a} vs ${tiled}`);
  }
  assert.ok(a.some((v, i) => Math.abs(v - other[i]) > 0.005),
    `TSL macro should vary across the surface: ${a} vs ${other}`);
  assert.ok(a[3] > 0.05 && a[3] < 0.95 && Math.abs(a[3] - other[3]) > 0.005,
    `TSL macro fine band must be packed in alpha: ${a} vs ${other}`);
  const baked = macro.baked.map((v) => v / 255);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(a[i] - baked[i]) < 0.015,
      `WebGPU macro bake must preserve RGBA channel ${i}: ${a} vs ${baked}`);
  }
  const detail = macro.detail.map(DataUtils.fromHalfFloat);
  const detailAdjacent = macro.detailAdjacent.map(DataUtils.fromHalfFloat);
  const detailBaked = macro.detailBaked.map((v) => v / 255);
  const detailNormal = macro.detailNormal.map((v) => v / 255);
  for (let i = 0; i < 4; i++) {
    assert.ok(detail[i] >= 0 && detail[i] <= 1, `TSL detail channel ${i}: ${detail}`);
    assert.ok(Math.abs(detail[i] - detailAdjacent[i]) < 0.02,
      `TSL detail tile seam channel ${i}: ${detail} vs ${detailAdjacent}`);
    assert.ok(Math.abs(detail[i] - detailBaked[i]) < 0.015,
      `WebGPU detail bake channel ${i}: ${detail} vs ${detailBaked}`);
  }
  assert.ok(detailNormal[2] > 0.5 && detailNormal[2] <= 1 &&
    Math.abs(detailNormal[0] - 0.5) + Math.abs(detailNormal[1] - 0.5) > 0.002,
  `WebGPU detail normal must have resolved slopes: ${detailNormal}`);
  const resized = await page.evaluate(() => window.__WEBGPU_BOOT__.resize(200, 120));
  await page.setViewportSize({ width: 200, height: 120 });
  assert.deepEqual(resized, { canvas: [200, 120], target: [200, 120] });
  const resizedWeapon = await pixel(100, 60);
  assert.ok(resizedWeapon[0] > resizedWeapon[2] + 1000,
    `resize lost weapon pass: ${resizedWeapon}`);
  await page.evaluate(() => window.__WEBGPU_BOOT__.dispose());
  assert.equal(await page.evaluate(() => window.__WEBGPU_BOOT__.disposed), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, backend: boot.backend, background, weapon, blend, normal,
    macro: { center: a, tiled, other, baked }, detail: { surface: detail, baked: detailBaked,
      normal: detailNormal }, samples: [boot.worldSamples, boot.weaponSamples], unsupported: result,
    noAdapter: rejected }, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
