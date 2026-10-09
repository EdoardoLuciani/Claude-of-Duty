import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
import { captureNative, waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs(), port = Number(args.port ?? 5392);
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true,
    ...(args.executable ? { executablePath: String(args.executable) } : {}),
    args: ['--ignore-gpu-blocklist', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // Reference captures use exactly the same graph, with only the dispatch disabled.
  if (args.raster) await page.route('**/src/render/index-webgpu.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'fogCompute: this.q.volumetrics,';
    assert.equal(body.split(marker).length, 2);
    await route.fulfill({ response, body: body.replace(marker, 'fogCompute: false,') });
  });
  if (args.negative) await page.route('**/src/render/fog-compute-webgpu.js', async route => {
    const response = await route.fetch(); let body = await response.text();
    const callbacks = args.negative === 'callbacks', disposal = args.negative === 'dispose';
    const marker = callbacks ? '    inputs.color.build(builder);' :
      disposal ? 'output.dispose();' : '.toVec2().add(0.5)';
    assert.equal(body.split(marker).length, 2);
    body = body.replace(marker, callbacks || disposal ? '' : '.toVec2().add(0)');
    if (callbacks) {
      const hidden = 'color: texture(inputs.color.value)';
      assert.equal(body.split(hidden).length, 2);
      body = body.replace(hidden, 'color: inputs.color');
    }
    await route.fulfill({ response, body });
  });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=${args.quality ?? 'high'}`);
  await waitForGame(page);
  const scheduling = await page.evaluate(async () => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), taa = r._graph.taaPass;
    const phase = taa?._jitterIndex;
    await window.__PUMP__(1);
    return { taa: !!taa, phase, next: taa?._jitterIndex, offsetCleared: !e.camera.view?.enabled };
  });
  if (scheduling.taa) assert.equal(scheduling.next, (scheduling.phase + 1) % 32,
    'compute dependency must retain TRAA pipeline callbacks');
  assert.equal(scheduling.offsetCleared, true);
  console.log('scheduling', JSON.stringify(scheduling));
  if (args.out) mkdirSync(String(args.out), { recursive: true });
  for (const shot of ['hero', 'interior', 'night']) {
    await page.evaluate(async shot => {
      const r = window.__ENGINE__.ctx.get('render');
      r.settings.autoExposure = false; r._exposure = 1;
      await window.__APPLY_SHOT__(shot, { grabFrame: 20 });
      await window.__PUMP__(20);
    }, shot);
    if (args.out) await captureNative(page, join(String(args.out), `${shot}.png`));
    const report = await page.evaluate(async () => {
      const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
      const { createFogCompute } = await import('/src/render/fog-compute-webgpu.js');
      const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer;
      const graph = r._graph, sky = e.ctx.get('sky');
      // Borrow already-evaluated world/depth: neither path advances TAA or sim.
      const inputs = { color: N.texture((graph.taaPass?.getTextureNode() ?? graph.worldPass.getTextureNode()).value),
        depth: N.texture(graph.linearDepth.value),
        invProj: N.uniform(e.camera.projectionMatrixInverse), camWorld: N.uniform(e.camera.matrixWorld),
        camPos: N.uniform(e.camera.position), frame: N.uniform(e.time.frame),
        visibility: r._volumeShadow?.visibility };
      const fog = inputs => sky.createFogNode(inputs);
      const raster = N.rtt(fog(inputs), null, null, { depthBuffer: false });
      const compute = createFogCompute(fog, inputs);
      const target = new T.RenderTarget(1, 1, { type: T.HalfFloatType, depthBuffer: false });
      const pipelines = [raster, compute].map(node => {
        const p = new T.RenderPipeline(renderer, node.sample(N.screenUV));
        p.outputColorTransform = false; return p;
      });
      const previous = renderer.getRenderTarget(), size = renderer.getDrawingBufferSize(new T.Vector2());
      const before = renderer.info.memory.textures, cases = [];
      let borrowedDisposals = 0;
      const borrowed = [inputs.color.value, inputs.depth.value];
      const onDispose = () => borrowedDisposals++;
      for (const t of borrowed) t.addEventListener('dispose', onDispose);
      try {
        // Odd edges exercise ceil dispatch and its bounds guard; reuse the same
        // texture/node through downsize, portrait and return to full resolution.
        for (const [w, h] of [[1280, 720], [127, 73], [65, 129], [1280, 720]]) {
          renderer.setSize(w, h, false); target.setSize(w, h);
          const read = async p => {
            await new Promise(requestAnimationFrame);
            renderer.setRenderTarget(target); p.render();
            const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h);
            const stride = (pixels.length - w * 4) / (h - 1);
            if (!Number.isInteger(stride)) throw Error('invalid RGBA16F stride');
            return { pixels, stride };
          };
          const reference = await read(pipelines[0]), actual = await read(pipelines[1]);
          let maxError = 0, sumError = 0, bad = 0;
          for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) {
            const a = T.DataUtils.fromHalfFloat(reference.pixels[y * reference.stride + x]);
            const b = T.DataUtils.fromHalfFloat(actual.pixels[y * actual.stride + x]);
            const error = Math.abs(a - b);
            if (!Number.isFinite(error)) throw Error('nonfinite fog pixel');
            maxError = Math.max(maxError, error); sumError += error;
            if (error > Math.max(.002, Math.abs(a) * .002)) bad++;
          }
          cases.push({ size: [w, h], output: [compute.value.image.width, compute.value.image.height],
            maxError, meanError: sumError / (w * h * 4), bad });
        }
      } finally {
        renderer.setSize(size.x, size.y, false); renderer.setRenderTarget(previous);
        for (const p of pipelines) p.dispose();
        raster.dispose(); compute.dispose(); target.dispose();
        for (const t of borrowed) t.removeEventListener('dispose', onDispose);
      }
      return { cases, borrowedDisposals, textureDelta: renderer.info.memory.textures - before };
    });
    console.log(shot, JSON.stringify(report));
    for (const c of report.cases) {
      assert.deepEqual(c.output, c.size);
      assert.equal(c.bad, 0, `${shot}: compute fog differs from raster`);
    }
    assert.equal(report.borrowedDisposals, 0);
    assert.equal(report.textureDelta, 0, 'compute/raster probes leaked textures after resizing');
  }
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.__ENGINE__.dispose());
} finally {
  try { await browser?.close(); } finally { stopViteServer(server); }
}
