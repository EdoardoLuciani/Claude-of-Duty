#!/usr/bin/env node
/** Native star branches must not gate diffuse night-sky extinction.
 * MESA_VK_DEVICE_SELECT=1002:7550! node tools/sky-stars-check.mjs
 * --negative=1 restores the lazy shared expressions and must fail the oracle.
 */
import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5322);
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: [
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist',
] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/star-check.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Star extinction oracle</title>' }));
  if (args.negative) {
    await page.route('**/src/sky/stars.js', async route => {
      const response = await route.fetch();
      let body = await response.text();
      for (const expression of [
        'uCelestial.mul(dir)', 'skAirmass(dir.y)',
        'exp(pow(abs(mw).div(0.16), 1.4).negate())',
        'uStarParams.y.mul(clamp(am.sub(1).mul(0.16), 0, 0.85))',
      ]) {
        assert.equal(body.split(`${expression}.toVar()`).length, 2);
        body = body.replace(`${expression}.toVar()`, expression);
      }
      return route.fulfill({ response, body });
    });
  }
  await page.goto(`http://localhost:${port}/star-check.html`);
  const report = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createNightSkyNodes } = await import('/src/sky/stars.js');
    const { skHash33 } = await import('/src/sky/noise.js');
    const r = new T.WebGPURenderer({ forceWebGL: false });
    await r.init();
    const adapter = r.backend.device.adapterInfo;
    if (adapter.vendor !== 'amd' || adapter.architecture !== 'rdna-4' || adapter.isFallbackAdapter) throw new Error('RX 9070 XT required');
    const size = 128, target = new T.RenderTarget(size, size, { type: T.FloatType, depthBuffer: false });
    const shared = { uStarParams: N.uniform(new T.Vector4(0.07, 0.55, 0.7, 0)), uCelestial: N.uniform(new T.Matrix3()) };
    const cases = [];
    try {
      for (const points of [false, true]) {
        const night = createNightSkyNodes(shared, { points });
        const material = new T.NodeMaterial();
        material.fragmentNode = N.Fn(() => {
          const dir = N.normalize(N.vec3(N.screenUV.x.mul(2).sub(1), N.screenUV.y.mul(0.9).add(0.05), 1)).toVar();
          // Independent eligibility mask: only compare the analytic airglow
          // where all three star cells are empty. No CPU/GPU hash comparison.
          let empty = N.bool(true);
          for (const [scale, seed, keep] of [[21, 0, 0.3], [43, 13, 0.2], [87, 47, 0.1]]) {
            empty = empty.and(skHash33(N.floor(dir.mul(scale)).add(seed)).x.lessThan(1 - keep));
          }
          return N.vec4(night(dir), empty.select(1, 0));
        })();
        const quad = new T.QuadMesh(material);
        r.setRenderTarget(target); quad.render(r);
        const pixels = await r.readRenderTargetPixelsAsync(target, 0, 0, size, size);
        let count = 0, maxError = 0;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          for (let c = 0; c < 4; c++) if (!Number.isFinite(pixels[i + c])) throw new Error('non-finite star output');
          if (points && pixels[i + 3] < 0.5) continue;
          const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 0.9 + 0.05;
          const elevation = dy / Math.hypot(dx, dy, 1);
          const zenith = Math.acos(elevation) * 180 / Math.PI;
          const airmass = 1 / (elevation + 0.50572 * Math.max(0, 96.07995 - zenith) ** -1.6364);
          const t = Math.max(0, Math.min(1, (elevation + 0.03) / 0.13));
          const factor = 0.00030 * 0.07 * Math.exp(-airmass * 0.145) * t * t * (3 - 2 * t);
          for (let c = 0; c < 3; c++) maxError = Math.max(maxError, Math.abs(pixels[i + c] - [0.55, 1, 0.78][c] * factor));
          count++;
        }
        cases.push({ points, count, maxError });
        material.dispose();
      }
    } finally { r.setRenderTarget(null); target.dispose(); r.dispose(); }
    return { device: { vendor: adapter.vendor, architecture: adapter.architecture, fallback: adapter.isFallbackAdapter }, cases };
  });
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  for (const row of report.cases) {
    assert(row.count > 4000, 'enough independent airglow samples');
    assert(row.maxError < 2e-8, 'star-cell branches changed analytic airglow extinction');
  }
} finally { await browser.close(); await stopViteServer(server); }
