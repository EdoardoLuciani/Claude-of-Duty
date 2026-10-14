// Selected production filter only: seeded signal, depth edge, contact and sky.
import assert from 'node:assert/strict';
import { RedFormat, UnsignedByteType } from 'three';
import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from './lib/browser-harness.mjs';
const args = parseArgs(),
  port = Number(args.port ?? 5398);
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const negatives = {
    sky: ['return center.lessThanEqual(0).select(1, value);', 'return value;'],
    noise: ['depthAwareBlur(input, rawDepth, step, camera, 2, radius)', 'input.sample(screenUV).r'],
    contact: ['direction.mul(1.65)', 'direction.mul(8)'],
  };
  if (args.negative) {
    assert(Object.hasOwn(negatives, args.negative));
    await page.route('**/src/render/ao-blur-webgpu.ts*', async (route) => {
      const response = await route.fetch(),
        body = await response.text(),
        [before, after] = negatives[args.negative];
      assert.equal(body.split(before).length, 2, 'AO negative must execute exactly once');
      await route.fulfill({ response, body: body.replace(before, after) });
    });
  }
  await page.route('**/ao-fixture', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<link rel="icon" href="data:,"><canvas></canvas>',
    })
  );
  await page.goto(`http://127.0.0.1:${port}/ao-fixture`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.ts');
    const { createAoBilateralBlur } = await import('/src/render/ao-blur-webgpu.ts');
    const renderer = await createWebGpuRenderer(document.querySelector('canvas'));
    const info = renderer.backend.device.adapterInfo;
    if (info.isFallbackAdapter) throw Error('native nonfallback GPU required');
    const w = 320,
      h = 192,
      camera = new T.PerspectiveCamera(60, w / h, 0.1, 100);
    const depth = new Float32Array(w * h),
      hardware = new Float32Array(w * h),
      truth = new Float32Array(w * h);
    const noisy = new Uint8Array(((w / 2) * h) / 2);
    const signal = (x, y) =>
      x >= 280 ? 1 : x >= 160 ? 0.9 : 0.7 - 0.32 * Math.exp(-0.5 * ((y - 108) / 3) ** 2);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x,
          z = x >= 280 ? 0 : x >= 160 ? 9 : 3;
        truth[i] = signal(x, y);
        depth[i] = z;
        hardware[i] = z ? (camera.far * (1 - camera.near / z)) / (camera.far - camera.near) : 1;
      }
    let seed = 42;
    for (let y = 0; y < h / 2; y++)
      for (let x = 0; x < w / 2; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const value = signal(x * 2 + 0.5, y * 2 + 0.5);
        noisy[(y * w) / 2 + x] = Math.round(
          255 *
            Math.max(0, Math.min(1, value === 1 ? 1 : value + 0.18 * ((seed / 4294967296) * 2 - 1)))
        );
      }
    const texture = (data, width, height, type, filter) => {
      const t = new T.DataTexture(data, width, height, T.RedFormat, type);
      t.minFilter = t.magFilter = filter;
      t.needsUpdate = true;
      return t;
    };
    const ao = texture(noisy, w / 2, h / 2, T.UnsignedByteType, T.LinearFilter);
    const linear = texture(depth, w, h, T.FloatType, T.NearestFilter),
      raw = texture(hardware, w, h, T.FloatType, T.NearestFilter);
    const target = new T.RenderTarget(w, h, { depthBuffer: false });
    renderer.setSize(w, h);
    const filter = createAoBilateralBlur(N.texture(ao), N.texture(linear), N.texture(raw), camera);
    const pipeline = new T.RenderPipeline(
      renderer,
      N.vec4(filter.textureNode.sample(N.screenUV).rrr, 1)
    );
    pipeline.outputColorTransform = false;
    try {
      renderer.setRenderTarget(target);
      pipeline.render();
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h);
      const rt = filter.textureNode.renderTarget;
      let flatMse = 0,
        flatCount = 0,
        edgeError = 0,
        edgeCount = 0,
        skyMin = 1,
        contact = 0,
        flank = 0,
        contactCount = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x,
            value = pixels[i * 4] / 255,
            error = value - truth[i];
          if (!depth[i]) {
            skyMin = Math.min(skyMin, value);
            continue;
          }
          if ((x < 150 || (x > 170 && x < 270)) && Math.abs(y - 108) > 15) {
            flatMse += error * error;
            flatCount++;
          }
          if (x >= 157 && x <= 162 && Math.abs(y - 108) > 15) {
            edgeError += Math.abs(error);
            edgeCount++;
          }
          if (x >= 10 && x < 150 && y === 108) {
            contact += value;
            flank += (pixels[((y - 12) * w + x) * 4] + pixels[((y + 12) * w + x) * 4]) / 510;
            contactCount++;
          }
        }
      return {
        flatRmse: Math.sqrt(flatMse / flatCount),
        depthEdgeMae: edgeError / edgeCount,
        skyMin,
        contactContrast: (flank - contact) / contactCount,
        size: [rt.width, rt.height],
        format: rt.texture.format,
        type: rt.texture.type,
      };
    } finally {
      renderer.setRenderTarget(null);
      pipeline.dispose();
      filter.dispose();
      target.dispose();
      ao.dispose();
      linear.dispose();
      raw.dispose();
      await renderer.dispose();
    }
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(result.size, [320, 192]);
  assert.equal(result.format, RedFormat);
  assert.equal(result.type, UnsignedByteType);
  assert.equal(result.skyMin, 1, 'chosen filter must keep cleared sky neutral');
  // Frozen legacy metrics/original tolerances: https://gist.github.com/EdoardoLuciani/79403cb0d0ee026325e5f97f1837ddcc
  assert(result.flatRmse <= 0.03129 * 1.05, 'synthetic noise rejection regressed');
  assert(result.depthEdgeMae <= 0.02998 * 1.05, 'synthetic boundary leakage regressed');
  assert(Math.abs(result.contactContrast - 0.25826) < 0.01, 'synthetic contact contrast changed');
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  stopViteServer(server);
}
