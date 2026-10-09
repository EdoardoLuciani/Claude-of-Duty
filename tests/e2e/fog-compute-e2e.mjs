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
  // Reference captures change only fog materialization from compute to raster.
  if (args.raster) await page.route('**/src/render/index-webgpu.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'fogCompute: this.q.volumetrics,';
    assert.equal(body.split(marker).length, 2);
    await route.fulfill({ response, body: body.replace(marker, 'fogCompute: false,') });
  });
  if (args.negative === 'callbacks') await page.route('**/*TRAANode*.js*', async route => {
    const response = await route.fetch(), body = await response.text();
    const guard = /builder\.renderPipeline\s*&&\s*!\s*builder\.context\.renderPipelineState\.viewOffsetOwner/g;
    assert.equal([...body.matchAll(guard)].length, 1);
    await route.fulfill({ response, body: body.replace(guard,
      '((globalThis.__FOG_CALLBACK_NEGATIVE__ = true), false)') });
  });
  else if (args.negative) await page.route('**/src/render/fog-compute-webgpu.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const disposal = args.negative === 'dispose';
    const marker = disposal ? 'output.dispose();' : '.toVec2().add(0.5)';
    assert.equal(body.split(marker).length, 2);
    await route.fulfill({ response, body: body.replace(marker, disposal ? '' : '.toVec2().add(0)') });
  });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=${args.quality ?? 'high'}`);
  await waitForGame(page);
  if (args.negative === 'callbacks') assert.equal(await page.evaluate(() =>
    window.__FOG_CALLBACK_NEGATIVE__), true, 'callback mutation must execute');
  const scheduling = await page.evaluate(async () => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), taa = r._graph.taaPass;
    const phase = taa?._jitterIndex, before = r.renderer.info.compute.calls;
    const prePass = r._graph.prePass, update = prePass.updateBefore;
    let depthDraws = 0;
    prePass.updateBefore = function (frame) { depthDraws++; return update.call(this, frame); };
    try { await window.__PUMP__(1); } finally { prePass.updateBefore = update; }
    return { taa: !!taa, phase, next: taa?._jitterIndex, offsetCleared: !e.camera.view?.enabled,
      computeCalls: r.renderer.info.compute.calls - before, marched: e.config.q.volumetrics, depthDraws };
  });
  if (scheduling.taa) assert.equal(scheduling.next, (scheduling.phase + 1) % 32,
    'compute dependency must retain TRAA pipeline callbacks');
  assert.equal(scheduling.offsetCleared, true);
  assert.equal(scheduling.computeCalls, scheduling.marched && !args.raster ? 1 : 0,
    'native compute must dispatch exactly once per frame');
  assert.equal(scheduling.depthDraws, 1, 'upstream depth must render exactly once');
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
        const p = new T.RenderPipeline(renderer, N.Fn(() => {
          if (node.computeNode) node.computeNode.toStack();
          return (node.textureNode ?? node).sample(N.screenUV);
        })());
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
          cases.push({ size: [w, h], output: [compute.textureNode.value.image.width, compute.textureNode.value.image.height],
            dispatch: [...compute.computeNode.dispatchSize],
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
      assert.deepEqual(c.dispatch, [Math.ceil(c.size[0] / 8), Math.ceil(c.size[1] / 8), 1]);
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
