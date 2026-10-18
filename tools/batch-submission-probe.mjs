#!/usr/bin/env node
/** Isolated library API probe, NOT game throughput or an application batch. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  REPO_ROOT,
  stopViteServer,
} from './lib/browser-harness.mjs';
import { pristineHashes } from './lib/cpu-submission-trials.mjs';
import { installDevicePolicy } from './lib/native-render.mjs';

const args = parseArgs();
assert(['mesh', 'batch'].includes(args.mode) && args.out, '--mode=mesh|batch and --out required');
const out = resolve(args.out);
assert(
  out !== REPO_ROOT && !out.startsWith(REPO_ROOT + '/'),
  'raw evidence belongs outside checkout'
);
writeFileSync(out, JSON.stringify({ failure: 'probe incomplete' }));
for (const [path, hash] of Object.entries(pristineHashes))
  assert.equal(
    createHash('sha256')
      .update(readFileSync(`${REPO_ROOT}/${path}`))
      .digest('hex'),
    hash,
    'use pristine merged pin, no concurrent source trials'
  );
const server = await ensureViteServer({ port: 5396 });
let browser;
try {
  browser = await launchChromium({
    headless: true,
    args: [
      '--ignore-gpu-blocklist',
      '--mute-audio',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
    ],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await installDevicePolicy(page);
  await page.route('**/batch-probe', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' })
  );
  await page.goto('http://localhost:5396/batch-probe');
  if (args['cpu-core'] !== undefined) {
    const core = Number(args['cpu-core']);
    assert(Number.isInteger(core) && core >= 0 && process.platform === 'linux');
    const cdp = await browser.newBrowserCDPSession();
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    for (const p of processInfo.filter((p) => p.type === 'renderer'))
      execFileSync('taskset', ['-pc', String(core), String(p.id)]);
    await cdp.detach();
  }
  const result = await page.evaluate(async (mode) => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.ts');
    const renderer = await createWebGpuRenderer(document.querySelector('canvas'), (e) => {
      throw e;
    });
    const a = renderer.backend.device.adapterInfo;
    window.__ASSERT_HARDWARE_DEVICE__({
      vendor: a.vendor,
      architecture: a.architecture,
      fallback: a.isFallbackAdapter,
    });
    renderer.info.autoReset = false;
    const target = new T.RenderTarget(512, 256, { type: T.FloatType });
    const camera = new T.OrthographicCamera(-8, 8, 4, -4, 0.1, 10);
    camera.position.z = 2;
    const texture = new T.DataTexture(new Uint8Array([40, 100, 160, 255]), 1, 1);
    texture.needsUpdate = true;
    const material = new T.MeshBasicNodeMaterial({ toneMapped: false });
    material.colorNode = N.texture(texture).rgb.mul(0.75).add(0.05);
    const geometries = Array.from(
      { length: 16 },
      (_, i) => new T.PlaneGeometry(0.3 + i * 0.006, 0.3 + i * 0.004)
    );
    const plain = new T.Scene();
    const batched = new T.Scene();
    const batch = new T.BatchedMesh(512, 16 * 4, 16 * 6, material);
    const ids = geometries.map((g) => batch.addGeometry(g));
    const matrix = new T.Matrix4();
    for (let i = 0; i < 512; i++) {
      matrix.makeTranslation((i % 32) * 0.5 - 7.75, Math.floor(i / 32) * 0.5 - 3.75, 0);
      const mesh = new T.Mesh(geometries[i % 16], material);
      mesh.matrix.copy(matrix);
      mesh.matrixAutoUpdate = false;
      plain.add(mesh);
      batch.setMatrixAt(batch.addInstance(ids[i % 16]), matrix);
    }
    batched.add(batch);
    let builds = 0;
    renderer.debug.onNodeBuilderCreated = () => builds++;
    const samples = [];
    const tick = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('batch probe rAF timeout')), 30000);
        requestAnimationFrame(() => {
          clearTimeout(timer);
          resolve(performance.now());
        });
      });
    const read = async (scene) => {
      renderer.render(scene, camera);
      return renderer.readRenderTargetPixelsAsync(target, 0, 0, 512, 256);
    };
    let maxPixelDelta = 0;
    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0, 0);
      const reference = await read(plain);
      const actual = await read(batched);
      for (let i = 0; i < reference.length; i++)
        maxPixelDelta = Math.max(maxPixelDelta, Math.abs(reference[i] - actual[i]));
      if (maxPixelDelta > 1e-6) throw new Error(`batch probe readback mismatch ${maxPixelDelta}`);
      const scene = mode === 'mesh' ? plain : batched;
      let last = null;
      const initialBuilds = builds;
      const deadline = performance.now() + 120000;
      for (let i = -120; i <= 1800; i++) {
        const now = await tick();
        if (performance.now() > deadline) throw new Error('batch probe timeout');
        if (last) last.intervalMs = now - last.at;
        if (i === 1800) break;
        const draws = renderer.info.render.drawCalls;
        const start = performance.now();
        renderer.render(scene, camera);
        const cpuMs = performance.now() - start;
        if (i >= 0) {
          last = {
            at: now,
            cpuMs,
            intervalMs: null,
            draws: renderer.info.render.drawCalls - draws,
          };
          samples.push(last);
        }
      }
      if (builds !== initialBuilds || !samples.every((s) => s.draws === 512))
        throw new Error('unexpected shader build or draw count');
      return {
        mode,
        api: 'Three.js BatchedMesh vs ordinary Mesh',
        instances: 512,
        geometries: 16,
        materialCount: 1,
        perObjectFrustumCulled: batch.perObjectFrustumCulled,
        maxPixelDelta,
        newBuilders: builds - initialBuilds,
        adapter: { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter },
        samples,
      };
    } finally {
      renderer.setRenderTarget(null);
      batch.dispose();
      for (const g of geometries) g.dispose();
      material.dispose();
      texture.dispose();
      target.dispose();
      await renderer.dispose();
    }
  }, args.mode);
  assert.deepEqual(errors, []);
  const distribution = (field) => {
    const v = result.samples.map((s) => s[field]).sort((a, b) => a - b);
    return Object.fromEntries(
      [
        ['p50', 0.5],
        ['p95', 0.95],
        ['p99', 0.99],
      ].map(([name, p]) => [name, +v[Math.floor(v.length * p)].toFixed(3)])
    );
  };
  const report = {
    note: 'Isolated static, all-visible library API probe, development module build and default managed headless browser. rAF can remain paced despite requested launch flags: inspect actual intervals; no throughput/FPS claim. Not living combat, no game identity/culling/prewarm integration attempted. Both scenes use the same material object; 512 native draw commands in each mode. Only benchmark scene differs.',
    cpuCore: args['cpu-core'] ?? null,
    ...result,
    summary: {
      cpuRenderSubmitMs: distribution('cpuMs'),
      callbackIntervalMs: distribution('intervalMs'),
    },
  };
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, samples: `${result.samples.length} frames` }, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
