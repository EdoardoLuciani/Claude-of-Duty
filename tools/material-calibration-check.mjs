/** Shader/readback regressions for finish anchoring, dry weather and bake keys. */
import assert from 'node:assert/strict';
import { ensureViteServer, stopViteServer, launchChromium, parseArgs } from './lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5397);
const server = await ensureViteServer({ port }); let browser;
try {
  browser = await launchChromium({ headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    args: ['--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-unsafe-webgpu'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/material-calibration.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><link rel="icon" href="data:,"><canvas id="game"></canvas>' }));
  if (args.negative) await page.route(args.negative === 'cache'
    ? '**/src/materials/index.js' : '**/src/materials/shader-tsl.js', async route => {
    const response = await route.fetch(); let body = await response.text();
    if (args.negative === 'cache') {
      const needle = '|${bake.worldSize}|${bake.relief}';
      assert.equal(body.split(needle).length - 1, 1); body = body.replace(needle, '');
    } else if (args.negative === 'rain') {
      const needle = 'streak.mulAssign(step(0.0001, weather.y));';
      assert.equal(body.split(needle).length - 1, 1); body = body.replace(needle, '');
    } else if (args.negative === 'local') {
      const needle = '.select(surfP.xz, vec2(surfP.x.add(surfP.z.mul(0.63)), surfP.y));';
      assert.equal(body.split(needle).length - 1, 1);
      body = body.replace(needle, '.select(worldP.xz, vec2(worldP.x.add(worldP.z.mul(0.63)), worldP.y));');
    } else throw new Error('unknown negative control');
    await route.fulfill({ response, body });
  });
  await page.goto(`http://localhost:${port}/material-calibration.html`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const { createSurfaceNodeMaterial } = await import('/src/materials/shader-tsl.js');
    const { DEFAULT_PARAMS } = await import('/src/materials/params.js');
    const { MaterialSystemNode } = await import('/src/materials/index.js');
    const { glassSurface } = await import('/src/materials/tsl/glass.js');
    const renderer = await createWebGpuRenderer(document.querySelector('#game'));
    const resources = [], scene = new T.Scene(), camera = new T.PerspectiveCamera(55, 1, .1, 1000);
    const target = new T.RenderTarget(16, 16, { type: T.FloatType, depthBuffer: false });
    const geometry = new T.PlaneGeometry(2, 2), mesh = new T.Mesh(geometry, null);
    const masks = new Float32Array(geometry.attributes.position.count * 4);
    for (let i = 0; i < masks.length; i += 4) masks[i + 1] = 1;
    geometry.setAttribute('color', new T.BufferAttribute(masks, 4)); scene.add(mesh);
    const data = (rgba, size = 1) => {
      const texture = new T.DataTexture(new Float32Array(rgba), size, size, T.RGBAFormat, T.FloatType);
      texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.needsUpdate = true;
      resources.push(texture); return texture;
    };
    const flatAlbedo = data([.3, .4, .5, 1]), normal = data([.5, .5, 1, 1]);
    const set = { albedo: flatAlbedo, normal, orm: data([1, .5, 1, 1]) };
    const noise = [];
    for (let i = 0; i < 8 * 8; i++) noise.push(((i * 17) % 61) / 60, ((i * 13) % 59) / 58, ((i * 11) % 53) / 52, .5);
    const shared = { macro: data(noise, 8), detailAlbedo: data([.5, .5, .5, .5]), detailNormal: normal };
    const p = { ...DEFAULT_PARAMS, scale: 1, uvMode: 'triplanar', detail: [1, 0, 0, 1],
      wear: [0, 0, 0, 0], vertexMasks: true, weather: [0, 0, 0, 0], macro: [1, 0, 0, 0] };
    const read = async () => {
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      return Array.from(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 16, 16));
    };
    const material = opts => {
      const m = createSurfaceNodeMaterial(set, { ...p, ...opts }, shared, { toneMapped: false });
      m.setupOutput = function () { return N.vec4(this.colorNode, 1); };
      resources.push(m); mesh.material = m;
    };
    const move = (x, angle = 0) => {
      mesh.position.set(x, 0, 0); mesh.rotation.y = angle;
      camera.position.set(x + Math.sin(angle) * 3, 0, Math.cos(angle) * 3);
      camera.lookAt(mesh.position);
    };
    const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    let library;
    try {
      check(renderer.backend.isWebGPUBackend && !renderer.backend.device.adapterInfo.isFallbackAdapter, 'native nonfallback GPU required');
      renderer.setSize(16, 16); renderer.setClearColor(0, 1);
      move(0); material({ weather: [0, 0, 0, 0] }); const clear = await read();
      material({ weather: [0, 0, 0, .62] }); const dry = await read();
      const dryDifference = maxDiff(clear, dry);
      check(dryDifference < 1e-6, 'zero rain must disable vertex-seeded runoff');
      material({ weather: [0, .5, 0, .62] }); const wet = await read();
      const wetDifference = maxDiff(dry, wet);
      check(wetDifference > .01, 'rain positive control must execute runoff');
      const anchoring = {};
      for (const localSpace of [true, false]) {
        material({ localSpace, macro: [1, .8, .1, .1], macroBig: [1.8, .1, .11, 0] });
        move(0); const origin = await read(); move(11); const translated = await read();
        move(11, .7); const rotated = await read();
        anchoring[localSpace ? 'local' : 'world'] = { translation: maxDiff(origin, translated), rotation: maxDiff(origin, rotated) };
      }
      check(anchoring.local.translation < 1e-5 && anchoring.local.rotation < 1e-5, 'local finish must stay anchored through translation/rotation');
      check(anchoring.world.translation > .01, 'world projection positive control must change');
      move(0);
      const glass = new T.MeshBasicNodeMaterial({ toneMapped: false }); resources.push(glass);
      glass.colorNode = glassSurface(N.uv(), N.float(3)).get('albedo'); mesh.material = glass;
      const glassPixels = await read();
      check(glassPixels.some((v, i) => i % 4 < 3 && v < .019), 'clean glass must retain dark linear pigment below .02');
      library = new MaterialSystemNode({ renderer });
      await library.init({ config: { quality: 'low', q: { anisotropy: 2 } } });
      const opts = { bake: { size: 256, seed: 997, relief: .02, worldSize: .5 } };
      const first = library.getTextureSet('rubber', opts);
      const relief = library.getTextureSet('rubber', { bake: { ...opts.bake, relief: .1 } });
      const scale = library.getTextureSet('rubber', { bake: { ...opts.bake, worldSize: 2 } });
      check(first === library.getTextureSet('rubber', opts), 'same bake must reuse textures');
      check(first !== relief && first !== scale && relief !== scale, 'relief/worldSize must distinguish baked texture sets');
      const normals = [];
      for (const s of [first, relief, scale]) {
        const m = new T.MeshBasicNodeMaterial({ toneMapped: false }); resources.push(m);
        m.colorNode = N.texture(s.normal).rgb; mesh.material = m; normals.push(await read());
      }
      const bakeDifferences = { relief: maxDiff(normals[0], normals[1]), worldSize: maxDiff(normals[0], normals[2]) };
      check(bakeDifferences.relief > .001 && bakeDifferences.worldSize > .001, `bake-key changes must affect actual normal maps: ${JSON.stringify(bakeDifferences)}`);
      const a = renderer.backend.device.adapterInfo;
      return { device: { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter },
        dryDifference, wetDifference, anchoring, bakeDifferences };
    } finally {
      renderer.setRenderTarget(null); library?.dispose(); target.dispose(); geometry.dispose();
      for (const resource of resources) resource.dispose(); await renderer.dispose();
    }
  });
  assert.deepEqual(errors, []); console.log(JSON.stringify(result, null, 2));
  await page.close();
} finally { await browser?.close(); stopViteServer(server); }
