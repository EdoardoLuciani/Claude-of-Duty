#!/usr/bin/env node
/** Compare reusable noise functions with the same authored, inline TSL on GPU. */
import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';

const args = parseArgs(), port = Number(args.port ?? 5392);
assert.ok(!args.negative || args.negative === 'period', 'negative must be period');
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage(), errors = [], references = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/noise-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
  await page.route('**/*noise*.js?inline', async route => {
    const response = await route.fetch();
    let count = 0;
    const body = (await response.text()).replace(/\.setLayout\(\{[\s\S]*?\}\)/g, () => { count++; return ''; });
    const expected = route.request().url().includes('/materials/') ? 5 : 6;
    assert.equal(count, expected, 'reference must remove every explicit layout');
    references.push(count);
    await route.fulfill({ response, body });
  });
  let mutated = false;
  if (args.negative) await page.route('**/src/materials/noise-tsl.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const vector = "{ name: 'period', type: 'vec2' }";
    assert.equal(body.split(vector).length - 1, 2);
    mutated = true;
    await route.fulfill({ response, body: body.replaceAll(vector, "{ name: 'period', type: 'float' }") });
  });
  await page.goto(`http://localhost:${port}/noise-probe`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const modules = await Promise.all([
      import('/src/materials/noise-tsl.js'), import('/src/materials/noise-tsl.js?inline'),
      import('/src/sky/noise.js'), import('/src/sky/noise.js?inline'),
    ]);
    const renderer = await createWebGpuRenderer(document.querySelector('canvas'), error => { throw error; });
    const adapter = renderer.backend.device.adapterInfo;
    const size = 64, target = new T.RenderTarget(size, size, { type: T.FloatType, depthBuffer: false });
    const p = N.screenCoordinate.xy.sub(size / 2).mul(0.371);
    const p3 = N.vec3(p, p.x.mul(0.73).add(p.y.mul(1.31)));
    const period = N.vec2(4, 8), gain = N.float(0.5), jitter = N.float(0.8);
    const cases = [
      [0, 'hash42', 4, [p]], [0, 'hash12', 1, [p]],
      [0, 'periodicNoise', 1, [p, period]],
      [0, 'fbm4', 1, [p, period, gain]], [0, 'fbm5', 1, [p, period, gain]],
      [0, 'ridged4', 1, [p, period, gain]],
      [0, 'worley', 4, [p, period, jitter]], [0, 'voronoiEdge', 1, [p, period, jitter]],
      [2, 'skHash12', 1, [p]], [2, 'skHash13', 1, [p3]], [2, 'skHash33', 3, [p3]],
      [2, 'skIGN', 1, [p]], [2, 'skVal2', 1, [p]], [2, 'skVal3', 1, [p3]],
      [2, 'fbm2', 1, [p], 5], [2, 'ridge2', 1, [p], 5], [2, 'fbm3', 1, [p3], 4],
    ];
    const pack = (node, width) => width === 4 ? node : width === 3 ? N.vec4(node, 0) :
      width === 2 ? N.vec4(node, 0, 0) : N.vec4(node, 0, 0, 0);
    const measurements = [];
    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0, 0);
      for (const [index, name, width, inputs, octaves] of cases) {
        const functions = [modules[index][name], modules[index + 1][name]];
        const values = functions.map(fn => pack((octaves ? fn(octaves) : fn)(...inputs), width));
        const material = new T.NodeMaterial();
        material.toneMapped = false;
        const delta = values[0].sub(values[1]).abs(), sentinel = measurements.length + 1;
        material.fragmentNode = N.vec4(delta.xyz, delta.w.add(sentinel));
        try {
          new T.QuadMesh(material).render(renderer);
          const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
          if (pixels.length !== size * size * 4) throw new Error(`${name}: incomplete readback`);
          let maxError = 0;
          for (let i = 0; i < pixels.length; i++) {
            const value = pixels[i];
            if (!Number.isFinite(value)) throw new Error(`${name}: nonfinite noise`);
            if (i % 4 === 3 && value < sentinel) throw new Error(`${name}: missing probe draw`);
            maxError = Math.max(maxError, i % 4 === 3 ? value - sentinel : value);
          }
          measurements.push({ name, maxError, samples: size * size });
        } finally { material.dispose(); }
      }
      return { adapter: { vendor: adapter.vendor, architecture: adapter.architecture,
        fallback: adapter.isFallbackAdapter }, measurements };
    } finally { renderer.setRenderTarget(null); target.dispose(); renderer.dispose(); }
  });
  if (args.negative) assert.equal(mutated, true, 'period-layout mutation must execute');
  assert.deepEqual(references.sort(), [5, 6]);
  assert.deepEqual(errors, []);
  assert.equal(result.measurements.length, 17);
  for (const row of result.measurements) assert.ok(row.maxError <= 1e-5,
    `${row.name}: reusable/inline noise differ by ${row.maxError}`);
  console.log(JSON.stringify(result, null, 2));
} finally { try { await browser?.close(); } finally { stopViteServer(server); } }
