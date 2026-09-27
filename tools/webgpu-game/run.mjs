import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataUtils } from 'three/webgpu';
import { PNG } from 'pngjs';
import { ensureViteServer, stopViteServer, launchChromium } from '../lib/browser-harness.mjs';

const port = 5193;
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({ headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'] });
const shot = process.env.SHOT ?? 'hero';
const quality = process.env.QUALITY ?? 'high';
const width = Number(process.env.WIDTH ?? 480), height = Number(process.env.HEIGHT ?? 270);
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404 (Not Found)')) errors.push(m.text());
  });
  await page.addInitScript(() => {
    window.__WEBGL_REQUESTS__ = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).toLowerCase().startsWith('webgl') || type === 'experimental-webgl')
        window.__WEBGL_REQUESTS__++;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=${shot}&q=${quality}${process.env.NO_PREWARM ? '&prewarm=0' : ''}`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  const settle = process.env.RELOAD ? 90 : 6;
  await page.evaluate(([name, count]) => window.__APPLY_SHOT__(name, { grabFrame: count }),
    [shot, settle]);
  await page.evaluate((n) => window.__PUMP__(n), settle);
  if (process.env.RELOAD) {
    await page.evaluate(() => {
      const engine = window.__ENGINE__, weapon = engine.ctx.get('weapons');
      weapon.state.mag = 5;
      if (!weapon.reload()) throw new Error('reload test did not start');
      const original = engine.step;
      engine.step = function (...args) {
        this.camera.rotation.y += 0.002;
        return original.apply(this, args);
      };
    });
    await page.evaluate(() => window.__PUMP__(95));
  }
  if (process.env.RESIZE) {
    await page.setViewportSize({ width: width + 64, height: height + 36 });
    await page.evaluate(() => window.__PUMP__(4));
  }
  const result = await page.evaluate(async () => {
    const engine = window.__ENGINE__, owner = engine.ctx.get('render');
    const renderer = owner.renderer, target = owner.hdrRt;
    const w = owner.screenSize.width, h = owner.screenSize.height;
    const x = Math.max(0, (w >> 1) - 16), y = Math.max(0, (h >> 1) - 16);
    const samples = await renderer.readRenderTargetPixelsAsync(target, x, y, 32, 32);
    const view = await renderer.readRenderTargetPixelsAsync(owner.viewRt, 10, h - 10, 1, 1);
    return { backend: renderer.backend.constructor.name, frame: engine.time.frame,
      worldMeshes: engine.ctx.get('world').meshes.length, w, h,
      webglRequests: window.__WEBGL_REQUESTS__, viewCorner: [...view],
      pixels: Array.from(samples) };
  });
  assert.deepEqual(errors, [], `game errors: ${errors.slice(0, 5).join('\n')}`);
  assert.equal(result.backend, 'WebGPUBackend');
  assert.equal(result.webglRequests, 0);
  assert.equal(result.worldMeshes, 211);
  if (process.env.RESIZE) assert.ok(result.w > width && result.h > height,
    'gameplay resize must update the world and view targets');
  assert.equal(DataUtils.fromHalfFloat(result.viewCorner[3]), 0,
    'empty view pixel must be transparent; opaque clear hides the world');
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < result.pixels.length; i += 4) {
    const n = DataUtils.fromHalfFloat(result.pixels[i]);
    min = Math.min(min, n); max = Math.max(max, n);
  }
  assert.ok(max > 0.01 && max - min > 0.002,
    `world HDR pass is blank: min=${min}, max=${max}`);
  delete result.pixels;
  console.log(JSON.stringify({ ...result, min, max }));
  if (process.env.CAPTURE_DIR) {
    // Headless Chromium can screenshot a black WebGPU swapchain; read back the
    // actual final pipeline into an offscreen LDR target instead.
    const readback = await page.evaluate(async () => {
      const r = window.__ENGINE__.ctx.get('render');
      const { RenderTarget } = await import('/node_modules/.vite/deps/three_webgpu.js');
      const rt = new RenderTarget(r.screenSize.width, r.screenSize.height);
      try {
        r.renderer.setRenderTarget(rt);
        r._graph.render();
        const data = await r.renderer.readRenderTargetPixelsAsync(
          rt, 0, 0, r.screenSize.width, r.screenSize.height);
        return { pixels: Array.from(data), width: r.screenSize.width, height: r.screenSize.height };
      } finally {
        r.renderer.setRenderTarget(null);
        rt.dispose();
      }
    });
    const row = (readback.pixels.length - readback.width * 4) / (readback.height - 1);
    assert.ok(Number.isInteger(row) && row >= readback.width * 4);
    const png = new PNG({ width: readback.width, height: readback.height });
    let lit = 0;
    for (let y = 0; y < readback.height; y++)
      for (let i = 0; i < readback.width * 4; i++) {
        const value = readback.pixels[y * row + i];
        png.data[y * readback.width * 4 + i] = value;
        if (i % 4 !== 3 && value > 20) lit++;
      }
    assert.ok(lit > readback.width * readback.height * 0.1,
      `final composition is blank: ${lit} lit channels`);
    if (process.env.RELOAD) {
      let white = 0;
      for (let y = (readback.height * .45) | 0; y < readback.height * .82; y++)
        for (let x = (readback.width * .35) | 0; x < readback.width * .65; x++) {
          const i = (y * readback.width + x) * 4;
          if (png.data[i] > 235 && png.data[i + 1] > 220 && png.data[i + 2] > 220) white++;
        }
      assert.ok(white < readback.width * readback.height * .004,
        `two saturated view glints bloomed into ${white} white reload pixels`);
    }
    mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
    writeFileSync(join(process.env.CAPTURE_DIR, `${shot}.png`), PNG.sync.write(png));
  }
  await page.evaluate(() => window.__ENGINE__.dispose());
  assert.deepEqual(errors, [], `disposal errors: ${errors.slice(0, 5).join('\n')}`);
} finally {
  await browser.close();
  await stopViteServer(server);
}
