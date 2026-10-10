#!/usr/bin/env node
// Compare filter algorithms separately from the existing filter's compute port.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
import { captureNative, waitForGame } from './lib/native-render.mjs';

const args = parseArgs(), filter = args.filter ?? 'current', phase = args.phase ?? 'gpu';
assert(['current', 'compute', 'depth', 'depth-tuned', 'color', 'color-default'].includes(filter));
assert(['gpu', 'profile', 'quality', 'captures'].includes(phase));
const negative = args.negative ?? null;
assert(negative === null || phase === 'quality' && negative === 'sky');
const port = Number(args.port ?? 5452), out = resolve(args.out ?? `/tmp/ao-filter-${filter}`);
// Browser-response mutations only; no runtime algorithm selector is committed.
async function routeFilters(page, filter, negative = null) {
await page.route('**/src/render/ao-blur-webgpu.js', async route => {
  const response = await route.fetch(); let body = await response.text();
  const marker = 'export function createAoBilateralBlur(';
  assert.equal(body.split(marker).length, 2);
  body = body.replace(marker, 'function createProductionAoBlur(');
  if (negative === 'sky') {
    const guard = 'return center.lessThanEqual(0).select(1, value);';
    assert.equal(body.split(guard).length, 2); body = body.replace(guard, 'return value;');
  }
  body = "import { createAoFilter } from '/tools/ao-filter-fixture.js';\n" +
    "import { createAoBilateralBlur as createOriginalAoBlur } from '/tools/ao-filter-current.js';\n" + body +
    '\nexport { createOriginalAoBlur, createProductionAoBlur };\nexport function createAoBilateralBlur(source, depth, rawDepth, camera) {' +
    ` return createAoFilter(${JSON.stringify(filter)}, source, depth, { rawDepth, camera }, createOriginalAoBlur, createProductionAoBlur); }`;
  await route.fulfill({ response, body });
});
await page.route('**/src/render/webgpu-pipeline.js', async route => {
  const response = await route.fetch(); let body = await response.text();
  const marker = '    if (aoBlur) aoBlur.textureNode.sample(screenUV).toVar();';
  assert.equal(body.split(marker).length, 2);
  body = body.replace(marker, `    if (aoBlur) {
      aoPass.getTextureNode().sample(screenUV).toVar();
      for (const node of aoBlur.computeNodes) node.toStack();
      if (!aoBlur.computeNodes.length) aoBlur.textureNode.sample(screenUV).toVar();
    }`);
  await route.fulfill({ response, body });
});
}

if (phase === 'gpu' || phase === 'profile') {
  const file = phase === 'gpu' ? 'tools/webgpu-graph-audit.mjs' : 'tools/profile.mjs';
  let source = readFileSync(file, 'utf8').replaceAll("'./lib/", `'file://${process.cwd()}/tools/lib/`);
  const marker = phase === 'gpu' ? '  const errors = [];' : '  page.setDefaultTimeout(180000);';
  assert.equal(source.split(marker).length, 2);
  source = source.replace(marker, `${marker}\n${phase === 'gpu' ? "page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });" : ''}\nawait (${routeFilters.toString()})(page, ${JSON.stringify(filter)});`);
  process.argv = ['node', file, `--port=${port}`, `--out=${out}`, '--w=1280', '--h=720',
    ...(phase === 'gpu' ? ['--verify=1'] : []), '--warmup=120', `--frames=${phase === 'gpu' ? 24 : 1800}`];
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  if (phase === 'gpu') {
    const report = JSON.parse(readFileSync(out, 'utf8'));
    const blurPasses = report.passes.filter(p =>
      ['AO bilateral', 'Three depth-aware', 'Bilateral Blur'].some(s => p.stage?.name.includes(s)));
    if (filter !== 'compute') {
      assert.equal(blurPasses.length, 48, 'two blur draws per measured frame');
      for (const p of blurPasses) assert.deepEqual([p.stage.width, p.stage.height], [1280, 720],
        'comparison must use full-resolution blur outputs');
    }
  }
} else {
  mkdirSync(out, { recursive: true });
  const server = await ensureViteServer({ port });
  let browser;
  try {
    browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await routeFilters(page, filter, negative);
    await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&q=high`);
    await waitForGame(page);
    for (const shot of ['hero', 'interior', 'night']) {
      await page.evaluate(async shot => {
        const r = window.__ENGINE__.ctx.get('render');
        r.settings.autoExposure = false; r._exposure = 1;
        window.__APPLY_SHOT__(shot, { grabFrame: 120 }); await window.__PUMP__(120);
      }, shot);
      await captureNative(page, `${out}/${shot}-final.png`);
      if (phase === 'captures') continue;
      const report = await page.evaluate(async () => {
        const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
        const { createAoFilter, ao } = await import('/tools/ao-filter-fixture.js');
        const { createOriginalAoBlur, createProductionAoBlur } = await import('/src/render/ao-blur-webgpu.js');
        const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer, g = r._graph;
        // Capture the projection used to produce the frozen G-buffer, before TRAA
        // clears its view offset. Reference AO must reconstruct the same positions.
        let cameraSnapshot;
        const nativeCompute = renderer.compute;
        renderer.compute = function(node, ...rest) {
          if (node.name === 'Volumetric fog') cameraSnapshot = e.camera.clone();
          return nativeCompute.call(this, node, ...rest);
        };
        try { await window.__PUMP__(1); } finally { renderer.compute = nativeCompute; }
        if (!cameraSnapshot) throw Error('missing jittered camera snapshot');
        const source = N.texture(g.aoPass.getTextureNode().value);
        const linearDepth = N.texture(g.linearDepth.value), rawDepth = N.texture(g.prePass.getTextureNode('depth').value);
        const originalTarget = renderer.getRenderTarget(), target = new T.RenderTarget(1280, 720, { depthBuffer: false });
        const baselineTextures = renderer.info.memory.textures, results = {};
        const frozenFrame = e.time.frame, frozenTime = e.time.elapsed;
        const image = pixels => {
          const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
          canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), 1280, 720), 0, 0);
          return canvas.toDataURL('image/png').split(',')[1];
        };
        const read = async () => {
          const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1280, 720);
          if (data.length !== 1280 * 720 * 4) throw Error('unexpected RGBA8 layout');
          return data;
        };
        let pixels;
        try {
          const depthPipeline = new T.RenderPipeline(renderer, N.vec4(linearDepth.r, 0, 0, 1));
          depthPipeline.outputColorTransform = false;
          const depthTarget = new T.RenderTarget(1280, 720, { depthBuffer: false, type: T.FloatType });
          renderer.setRenderTarget(depthTarget); depthPipeline.render();
          const depth = await renderer.readRenderTargetPixelsAsync(depthTarget, 0, 0, 1280, 720);
          depthPipeline.dispose(); depthTarget.dispose();
          const rawPipeline = new T.RenderPipeline(renderer, N.vec4(source.rrr, 1));
          rawPipeline.outputColorTransform = false;
          renderer.setRenderTarget(target); rawPipeline.render();
          const raw = await read(); rawPipeline.dispose();
          results.raw = { png: image(raw) };
          // Higher-sample proxy, not physical ground truth. Preserve GTAO's
          // radius/thickness/strength and half resolution; change samples only.
          const reference = ao(rawDepth, N.texture(g.prePass.getTextureNode().value), cameraSnapshot);
          reference.resolutionScale = g.aoPass.resolutionScale;
          for (const key of ['radius', 'thickness', 'scale']) reference[key].value = g.aoPass[key].value;
          reference.samples.value = 128;
          const referencePipeline = new T.RenderPipeline(renderer, N.vec4(reference.getTextureNode().sample(N.screenUV).rrr, 1));
          referencePipeline.outputColorTransform = false;
          let referencePixels;
          try {
            await new Promise(requestAnimationFrame); renderer.setRenderTarget(target); referencePipeline.render();
            referencePixels = await read(); results.reference128 = { png: image(referencePixels) };
          } finally { referencePipeline.dispose(); reference.dispose(); }
          for (const name of ['current', 'depth', 'depth-tuned', 'color', 'color-default', 'compute']) {
            const f = createAoFilter(name, source, linearDepth, { camera: e.camera, rawDepth }, createOriginalAoBlur, createProductionAoBlur);
            const p = new T.RenderPipeline(renderer, N.Fn(() => {
              for (const node of f.computeNodes) node.toStack();
              return N.vec4(f.textureNode.sample(N.screenUV).rrr, 1);
            })());
            p.outputColorTransform = false;
            try {
              await new Promise(requestAnimationFrame); renderer.setRenderTarget(target); p.render();
              const data = await read();
              let curvature = 0, rawCurvature = 0, pairs = 0, sky = 0, skySum = 0, skyMin = 1;
              let sum = 0, min = 1, errorSum = 0, maxError = 0, referenceMse = 0;
              let contactError = 0, contactCount = 0;
              for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) {
                const k = (y * 1280 + x) * 4, d = depth[k], value = data[k] / 255;
                if (d <= 0) { sky++; skySum += value; skyMin = Math.min(skyMin, value); continue; }
                sum += value; min = Math.min(min, value);
                const referenceError = value - referencePixels[k] / 255;
                referenceMse += referenceError * referenceError;
                if (referencePixels[k] < 204) { contactError += Math.abs(referenceError); contactCount++; }
                if (pixels) { const error = Math.abs(data[k] - pixels[k]); errorSum += error; maxError = Math.max(maxError, error); }
                if (x + 2 >= 1280) continue;
                const a = depth[k + 4], b = depth[k + 8];
                if (a <= 0 || b <= 0 || Math.max(Math.abs(d - a), Math.abs(d - b)) > .03 * Math.max(1, d)) continue;
                curvature += Math.abs(data[k] - 2 * data[k + 4] + data[k + 8]);
                rawCurvature += Math.abs(raw[k] - 2 * raw[k + 4] + raw[k + 8]); pairs++;
              }
              results[name] = { png: image(data), size: [f.textureNode.value.image.width, f.textureNode.value.image.height],
                curvature: curvature / pairs, rawCurvature: rawCurvature / pairs,
                skyMean: sky ? skySum / sky : null, skyMin: sky ? skyMin : null,
                opaqueMean: sum / (1280 * 720 - sky), opaqueMin: min,
                meanDifferenceFromCurrent: errorSum / (1280 * 720 - sky), maxDifferenceFromCurrent: maxError,
                reference128Rmse: Math.sqrt(referenceMse / (1280 * 720 - sky)),
                reference128ContactMae: contactError / contactCount };
              if (name === 'current') pixels = data;
            } finally { p.dispose(); f.dispose(); }
          }
        } finally { renderer.setRenderTarget(originalTarget); target.dispose(); }
        if (e.time.frame !== frozenFrame || e.time.elapsed !== frozenTime)
          throw Error('quality probes advanced simulation');
        const textureDelta = renderer.info.memory.textures - baselineTextures;
        if (textureDelta !== 0) throw Error(`quality probes leaked ${textureDelta} textures`);
        return { results, textureDelta, frozenFrame, frozenTime };
      });
      const base = report.results.current, selected = report.results['depth-tuned'];
      assert.deepEqual(selected.size, [1280, 720]);
      assert.equal(selected.skyMin, 1, 'chosen filter must keep cleared sky neutral');
      assert.ok(selected.curvature <= base.curvature * 1.1, 'chosen filter introduced excessive same-depth variation');
      assert.ok(selected.reference128Rmse <= base.reference128Rmse * 1.02, 'chosen filter worsened reference error');
      for (const [name, result] of Object.entries(report.results)) {
        writeFileSync(`${out}/${shot}-${name}.png`, Buffer.from(result.png, 'base64')); delete result.png;
      }
      writeFileSync(`${out}/${shot}.json`, JSON.stringify(report, null, 2));
      console.log(shot, JSON.stringify(report));
    }
    if (phase === 'quality') {
      const synthetic = await page.evaluate(async () => {
        const { reviewSyntheticAo } = await import('/tools/ao-filter-synthetic.js');
        const { createOriginalAoBlur, createProductionAoBlur } = await import('/src/render/ao-blur-webgpu.js');
        const e = window.__ENGINE__;
        return reviewSyntheticAo(e.ctx.get('render').renderer, e.camera, createOriginalAoBlur, createProductionAoBlur);
      });
      for (const [name, png] of Object.entries(synthetic.pictures))
        writeFileSync(`${out}/synthetic-${name}.png`, Buffer.from(png, 'base64'));
      delete synthetic.pictures;
      const base = synthetic.results.current, selected = synthetic.results['depth-tuned'];
      assert.equal(selected.skyMin, 1);
      assert.ok(selected.flatRmse <= base.flatRmse * 1.05, 'synthetic noise rejection regressed');
      assert.ok(selected.depthEdgeMae <= base.depthEdgeMae * 1.05, 'synthetic boundary leakage regressed');
      assert.ok(Math.abs(selected.contactContrast - base.contactContrast) < .01, 'synthetic contact contrast changed');
      writeFileSync(`${out}/synthetic.json`, JSON.stringify(synthetic, null, 2));
      console.log('synthetic', JSON.stringify(synthetic));
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); stopViteServer(server); }
}
