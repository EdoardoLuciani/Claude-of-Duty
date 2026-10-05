#!/usr/bin/env node
// CPU world-ray + analytic homogeneous-fog oracle. --negative=1 restores the
// mirrored reconstruction and must fail, without changing the sampled depth UV.
import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5328);
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/fog-check.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fog ray oracle</title>' }));
  if (args.negative) await page.route('**/src/sky/volumetrics.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'uv.mul(2).sub(1).mul(vec2(1, -1))'; assert.equal(body.split(marker).length, 2);
    await route.fulfill({ response, body: body.replace(marker, 'uv.mul(2).sub(1)') });
  });
  await page.goto(`http://localhost:${port}/fog-check.html`);
  const rows = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const { createVolumetricNodes } = await import('/src/sky/volumetrics.js');
    const r = await createWebGpuRenderer(document.createElement('canvas')), a = r.backend.device.adapterInfo;
    if (a.vendor !== 'amd' || a.architecture !== 'rdna-4' || a.isFallbackAdapter) throw new Error('RX 9070 XT required');
    const w = 128, h = 64, target = new T.RenderTarget(w, h, { type: T.FloatType, depthBuffer: false });
    const ambient = new T.DataTexture(new Float32Array(8), 2, 1, T.RGBAFormat, T.FloatType); ambient.needsUpdate = true;
    const key = new T.Vector3(-.5, .7, -.3).normalize();
    const shared = { uFog: N.uniform(new T.Vector4(.004, 0, 0, 200)), uFog2: N.uniform(new T.Vector4(.02, 1, 0, 0)),
      uFogExt: N.uniform(new T.Vector3(.02, .02, .02)), uPhase: N.uniform(new T.Vector4(.76, -.36, .34, 1)),
      uKeyDir: N.uniform(key), uKeyIrr: N.uniform(new T.Vector3(1, 1, 1)), uFogDrift: N.uniform(new T.Vector3()), ambientTex: ambient };
    const fog = createVolumetricNodes(shared, { march: false });
    const camera = new T.PerspectiveCamera(75, w / h, .1, 300);
    const direction = new T.Vector3(), view = new T.Vector3(), rows = [];
    const hg = (cosine, g) => (1 - g * g) / (4 * Math.PI * Math.max(1e-4, 1 + g * g - 2 * cosine * g) ** 1.5);
    try {
      for (const pitch of [-.4, 0, .4]) for (const yaw of [0, .8]) {
        camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.updateMatrixWorld(true);
        const material = new T.NodeMaterial();
        material.fragmentNode = N.vec4(fog.createNode({ color: N.vec3(0), depth: N.float(20),
          invProj: N.uniform(camera.projectionMatrixInverse), camWorld: N.uniform(camera.matrixWorld), camPos: N.uniform(camera.position) }), 1);
        r.setRenderTarget(target); new T.QuadMesh(material).render(r);
        const pixels = await r.readRenderTargetPixelsAsync(target, 0, 0, w, h);
        let maxError = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          view.set((x + .5) / w * 2 - 1, 1 - (y + .5) / h * 2, 1).applyMatrix4(camera.projectionMatrixInverse);
          view.divideScalar(-view.z);
          const distance = 20 * view.length();
          direction.copy(view).transformDirection(camera.matrixWorld);
          const cosine = direction.dot(key), phase = hg(cosine, .76) * .66 + hg(cosine, -.36) * .34;
          const expected = phase * .55 * (.004 / .02) * (1 - Math.exp(-.02 * (distance - 6)));
          const actual = pixels[(y * w + x) * 4];
          if (!Number.isFinite(actual)) throw new Error('non-finite fog');
          maxError = Math.max(maxError, Math.abs(actual - expected));
        }
        rows.push({ pitch, yaw, samples: w * h, maxError }); material.dispose();
      }
    } finally { r.setRenderTarget(null); ambient.dispose(); target.dispose(); r.dispose(); }
    return rows;
  });
  console.log(JSON.stringify(rows, null, 2)); assert.deepEqual(errors, []);
  for (const row of rows) assert(row.maxError < 2e-6, 'fog ray disagrees with top-left pixel CPU reconstruction');
} finally { await browser.close(); await stopViteServer(server); }
