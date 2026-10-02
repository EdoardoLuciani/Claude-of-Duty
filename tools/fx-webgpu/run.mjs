#!/usr/bin/env node
/**
 * Strict-WebGPU FX probe on a real GPU.
 *
 * Builds only `src/fx` node materials — particles (additive/lit/anchored),
 * decals and haze — against a strict `WebGPUBackend` and reads the passes back.
 * Runs on the discrete and integrated GPU; no WebGL context is ever created.
 *
 * Usage:
 *   node tools/fx-webgpu/run.mjs           # both GPUs
 *   FX_GPU=dgpu node tools/fx-webgpu/run.mjs
 *   CAPTURE_DIR=/tmp/fx-webgpu node tools/fx-webgpu/run.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureViteServer, launchChromium, stopViteServer } from '../lib/browser-harness.mjs';

const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(cache) ?
  readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .map((name) => join(cache, name, 'chrome-linux64/chrome')).find(existsSync) : null);
if (!executablePath) throw new Error('Full Chromium required for the FX WebGPU probe');

const port = 5201;
const server = await ensureViteServer({ port, root: process.cwd() });
const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
  '--ignore-gpu-blocklist', '--mute-audio'];

const only = process.env.FX_GPU;
const gpus = [
  { name: 'dgpu', env: {} },
  { name: 'igpu', env: { MESA_VK_DEVICE_SELECT: '1002:13c0!' } },
].filter((gpu) => !only || gpu.name === only);

const runs = [];
try {
  for (const gpu of gpus) {
    const browser = await launchChromium({
      executablePath,
      headless: true,
      env: { ...process.env, ...gpu.env },
      args,
    });
    try {
      const page = await browser.newPage({ viewport: { width: 160, height: 96 } });
      if (process.env.FX_CONTROL === 'unversioned') {
        await page.route('**/src/fx/particles.js*', async route => {
          const response = await route.fetch(), body = await response.text();
          assert.ok(body.includes('this.ibuf.needsUpdate = true;'));
          await route.fulfill({ response, body: body.replace('this.ibuf.needsUpdate = true;', '') });
        });
      }
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().includes('404 (Not Found)')) errors.push(m.text());
      });
      await page.goto(`http://127.0.0.1:${port}/tools/fx-webgpu/index.html`);
      await page.waitForFunction(() => window.__FX_WEBGPU__ !== undefined, null,
        { timeout: 300000 });
      const result = await page.evaluate(() => window.__FX_WEBGPU__);
      assert.equal(result.ok, true, result.error ?? result.stack);

      assert.equal(result.backend, 'WebGPUBackend');
      if (gpu.name === 'dgpu') {
        assert.equal(result.adapter.vendor, 'amd');
        assert.equal(result.adapter.architecture, 'rdna-4');
        assert.equal(result.adapter.isFallbackAdapter, false);
      }
      assert.deepEqual(result.lifetime, [0, 1].map(restart => ({ restart, quietUploads: 0,
        expiryUploads: 0, wrapPublished: true, resized: true })));
      assert.equal(errors.length, 0, `console/page errors: ${JSON.stringify(errors)}`);

      // Additive: the flash core reads bright and red-dominant at frame centre.
      assert.ok(result.additive.bright > 30,
        `${gpu.name}: additive layer barely covered the frame: ${JSON.stringify(result.additive)}`);
      assert.ok(result.additive.center[0] > 0.35 && result.additive.center[0] > result.additive.center[2],
        `${gpu.name}: additive core not red-dominant: ${JSON.stringify(result.additive.center)}`);

      // Soft depth: a 1 m depth plane fades a 2 m sprite to nothing.
      assert.ok(result.soft.center[0] < result.additive.center[0] * 0.15,
        `${gpu.name}: soft depth did not fade the occluded sprite: ${JSON.stringify(result.soft.center)}`);

      // Anchored velocity-aligned streak (tracer flag bit 1) still draws.
      assert.ok(Math.max(...result.anchored.center) > 0.02,
        `${gpu.name}: anchored tracer drew nothing: ${JSON.stringify(result.anchored.center)}`);

      // Lit: the shaded smoke puff draws and shades.
      assert.ok(result.lit.bright > 20 && Math.max(...result.lit.center) > 0.01,
        `${gpu.name}: lit particles did not draw: ${JSON.stringify(result.lit)}`);

      // Decals: project, fade with time, hide when expired.
      assert.equal(result.decal.placed, true, `${gpu.name}: decal projection failed`);
      assert.ok(result.decal.bright > 10,
        `${gpu.name}: decal did not draw: ${JSON.stringify(result.decal)}`);
      assert.equal(result.decal.faded, 0, `${gpu.name}: expired decal still drew`);

      // Brass casings: opaque PBR node material on an InstancedMesh.
      assert.ok(result.shells.bright > 10,
        `${gpu.name}: shell casing did not draw: ${JSON.stringify(result.shells)}`);

      // Haze: the offset target carries a distortion and the warp shifts colour.
      assert.equal(result.haze.rendered, true, `${gpu.name}: haze render pass failed`);
      assert.ok(result.haze.max > 0.001,
        `${gpu.name}: haze offset target empty: ${JSON.stringify(result.haze)}`);
      assert.ok(result.haze.warpMax > 0.005,
        `${gpu.name}: haze warp did not shift colour: ${JSON.stringify(result.haze)}`);
      assert.equal(result.haze.idleRendered, false,
        `${gpu.name}: idle haze should not draw a new offset target`);
      assert.ok(result.haze.idleMax < 0.002,
        `${gpu.name}: expired offsets still warped the frame: ${JSON.stringify(result.haze)}`);

      // The anchored trail relies on column-major P[0][0]/P[1][1] access.
      assert.ok(Math.abs(result.projection.p00 - result.projection.expected00) < 1e-5 &&
        Math.abs(result.projection.p11 - result.projection.expected11) < 1e-5,
        `${gpu.name}: projection matrix element access wrong: ${JSON.stringify(result.projection)}`);

      if (process.env.CAPTURE_DIR) {
        mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
        writeFileSync(join(process.env.CAPTURE_DIR, `${gpu.name}.json`), JSON.stringify(result, null, 2));
      }
      runs.push({ gpu: gpu.name, adapter: result.adapter, additive: result.additive,
        soft: result.soft, anchored: result.anchored, lit: result.lit,
        decal: result.decal, shells: result.shells, haze: result.haze, projection: result.projection,
        lifetime: result.lifetime });
    } finally {
      await browser.close();
    }
  }
  console.log(JSON.stringify({ ok: true, runs }, null, 2));
} finally {
  stopViteServer(server);
}
