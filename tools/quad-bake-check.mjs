import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';
const port = 5362, server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: [
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist',
] });
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/__fixture', r => r.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  if (process.env.QUAD_NEGATIVE) await page.route('**/src/materials/forge-tsl.js', async route => {
    const response = await route.fetch(); let body = await response.text();
    assert(body.includes('new QuadMesh(material)'));
    body = body.replace('QuadMesh, RenderTarget', 'QuadMesh, Mesh, Scene, PlaneGeometry, OrthographicCamera, RenderTarget')
      .replaceAll('new QuadMesh(material)', 'legacyQuad(material)');
    body += `\nfunction legacyQuad(material) {
      const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .1, 10);
      camera.position.z = 2;
      const mesh = new Mesh(new PlaneGeometry(2, 2), material); mesh.frustumCulled = false;
      scene.add(mesh); return { render(renderer) { renderer.render(scene, camera); } };
    }`;
    await route.fulfill({ response, body });
  });
  await page.goto(`http://127.0.0.1:${port}/__fixture`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const { bakeSurface, bakeMacro, bakeDetail } = await import('/src/materials/forge-tsl.js');
    const { BakePass, floatTarget } = await import('/src/sky/bake.js');
    const r = await createWebGpuRenderer(document.querySelector('canvas'));
    const info = r.backend.device.adapterInfo;
    if (info.vendor !== 'amd' || info.architecture !== 'rdna-4' || info.isFallbackAdapter) throw Error('Wrong GPU');
    const size = 64, u = N.uv(); // RGBA8 rows satisfy WebGPU's 256-byte readback alignment.
    const fields = { albedo: N.vec3(u, .25), height: u.x.pow2().mul(.2).add(u.y.pow2().mul(.3)),
      ao: N.float(1), rough: N.float(.5), metal: N.float(0) };
    const sentinel = new T.RenderTarget(8, 8); r.setRenderTarget(sentinel);
    let geometryDisposals = 0;
    const geometry = new T.QuadMesh().geometry, onDispose = () => geometryDisposals++;
    geometry.addEventListener('dispose', onDispose);
    const maps = bakeSurface(r, { size, worldSize: 1, relief: 1, surface: { get: name => fields[name] } });
    let restored = r.getRenderTarget() === sentinel;
    const pixels = {};
    for (const [name, target] of Object.entries(maps)) pixels[name] = await r.readRenderTargetPixelsAsync(target, 0, 0, size, size);
    const macro = bakeMacro(r, size), detail = bakeDetail(r, size);
    restored &&= r.getRenderTarget() === sentinel;
    const skyTarget = floatTarget(size, size), sky = new BakePass('uv-oracle', N.vec3(u, .25));
    sky.render(r, skyTarget); restored &&= r.getRenderTarget() === sentinel;
    const skyPixels = await r.readRenderTargetPixelsAsync(skyTarget, 0, 0, size, size);
    let normalError = 0, uvError = 0, colorError = 0, heightError = 0, ormError = 0;
    const srgb = x => x <= .0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - .055;
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const a = (x + .5) / size, b = (y + .5) / size, i = (y * size + x) * 4;
      const n = [-.4 * a, -.6 * b, 1], length = Math.hypot(...n);
      for (let c = 0; c < 3; c++) {
        normalError = Math.max(normalError, Math.abs(pixels.normal[i + c] / 255 - (.5 + .5 * n[c] / length)));
        colorError = Math.max(colorError, Math.abs(pixels.albedo[i + c] / 255 - srgb([a, b, .25][c])));
        ormError = Math.max(ormError, Math.abs(pixels.orm[i + c] / 255 - [1, .5, 0][c]));
        uvError = Math.max(uvError, Math.abs(skyPixels[i + c] - [a, b, .25][c]));
      }
      heightError = Math.max(heightError, Math.abs(pixels.albedo[i + 3] / 255 - (.2 * a * a + .3 * b * b)));
    }
    sky.dispose(); skyTarget.dispose(); macro.dispose();
    for (const target of [...Object.values(maps), ...Object.values(detail)]) target.dispose();
    geometry.removeEventListener('dispose', onDispose);
    r.setRenderTarget(null); sentinel.dispose(); await r.dispose();
    return { normalError, uvError, colorError, heightError, ormError, restored, geometryDisposals };
  });
  console.log(JSON.stringify(result));
  assert.deepEqual(errors, []);
  assert(result.normalError < .008, 'baked normal disagrees with height gradient');
  assert(result.uvError < 1e-6, 'sky bake must use native top-left texture UVs');
  assert(result.colorError < .003 && result.heightError < .003 && result.ormError < .003);
  assert.equal(result.restored, true); assert.equal(result.geometryDisposals, 0);
} finally { await browser.close(); stopViteServer(server); }
