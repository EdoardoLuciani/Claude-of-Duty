#!/usr/bin/env node
// Display-transform and visible FX regressions; run native GPU jobs sequentially.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
import { capturePreview } from './lib/webgpu-preview-shot.mjs';
import { waitForGame } from './lib/native-render.mjs';
const args = parseArgs(), out = resolve(args.out ?? '/tmp/cod-preview-check');
const port = Number(args.port ?? 5495), url = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
let browser;
const report = { swatches: [], previews: [], fx: [] }, errors = [];
const pixels = path => PNG.sync.read(readFileSync(path)).data;
const difference = (a, b) => {
  let changed = 0, max = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) {
    const delta = Math.abs(a[i] - b[i]); if (delta) changed++; max = Math.max(max, delta);
  }
  return { changed, max };
};
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' || /GPUValidationError|validation error|THREE\.TSL|Error while parsing WGSL/i.test(m.text())) errors.push(m.text());
  });
  await page.route('**/__preview_fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  if (!args.only || args.only === 'swatches') {
    await page.goto(`${url}/__preview_fixture`);
    await page.evaluate(async negative => {
      const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
      const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
      const r = await createWebGpuRenderer(document.querySelector('canvas'));
      const a = r.backend.device.adapterInfo;
      if (a.vendor !== 'amd' || a.architecture !== 'rdna-4' || a.isFallbackAdapter) throw Error('Wrong GPU');
      r.setSize(65, 7); r.toneMapping = T.AgXToneMapping; r.outputColorSpace = T.SRGBColorSpace;
      const color = N.uniform(new T.Vector3()), material = new T.MeshBasicNodeMaterial(); material.colorNode = color;
      const scene = new T.Scene(), mesh = new T.Mesh(new T.PlaneGeometry(2, 2), material);
      mesh.position.z = -1; scene.add(mesh);
      const camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10);
      const savedTarget = new T.RenderTarget(2, 2), savedOutput = new T.RenderTarget(3, 3);
      r.setRenderTarget(savedTarget); r.setOutputRenderTarget(savedOutput);
      window.__PREVIEW_RENDERER__ = r;
      window.__PREVIEW_DRAW__ = () => r.render(scene, camera);
      window.fixture = { T, N, r, color, scene, camera, savedTarget, savedOutput };
      if (negative === 'display') {
        const setOutput = r.setOutputRenderTarget.bind(r);
        r.setOutputRenderTarget = target => target ? r.setRenderTarget(target) : setOutput(target);
      }
    }, args.negative);
    for (const rgb of [[.18,.18,.18], [4,.2,.02], [8,4,1]]) for (const exposure of [.5,1,2]) {
      await page.evaluate(({ rgb, exposure }) => {
        const f = window.fixture; f.color.value.fromArray(rgb); f.r.toneMappingExposure = exposure;
      }, { rgb, exposure });
      const path = `${out}/swatch-${report.swatches.length}.png`;
      await capturePreview(page, path);
      const actual = [...pixels(path).subarray((3 * 65 + 32) * 4, (3 * 65 + 32) * 4 + 3)];
      const reference = await page.evaluate(async () => {
        const { T, N, r, color, savedTarget, savedOutput } = window.fixture;
        if (r.getRenderTarget() !== savedTarget || r.getOutputRenderTarget() !== savedOutput) throw Error('capture lost target state');
        const target = new T.RenderTarget(1, 1);
        const pipeline = new T.RenderPipeline(r, N.renderOutput(N.vec4(color, 1), T.AgXToneMapping, T.SRGBColorSpace));
        pipeline.outputColorTransform = false;
        try {
          r.setRenderTarget(target); pipeline.render();
          return Array.from(await r.readRenderTargetPixelsAsync(target, 0, 0, 1, 1)).slice(0, 3);
        } finally { r.setRenderTarget(savedTarget); pipeline.dispose(); target.dispose(); }
      });
      assert(actual.every((v, i) => Math.abs(v - reference[i]) <= 1), `HDR/exposure mismatch: ${actual} vs ${reference}`);
      report.swatches.push({ rgb, exposure, actual, reference });
    }
    await page.evaluate(() => {
      const f = window.fixture; f.r.setRenderTarget(f.savedTarget, 3, 2);
      window.__PREVIEW_DRAW__ = () => { throw Error('injected preview draw failure'); };
    });
    await assert.rejects(capturePreview(page, `${out}/failure.png`), /injected preview draw failure/);
    assert.equal(await page.evaluate(() => {
      const f = window.fixture;
      return f.r.getRenderTarget() === f.savedTarget && f.r.getOutputRenderTarget() === f.savedOutput &&
        f.r.getActiveCubeFace() === 3 && f.r.getActiveMipmapLevel() === 2;
    }), true);
    report.graphLifetime = await page.evaluate(async () => {
      const { T, r, scene, camera } = window.fixture;
      const { createWorldViewPipeline } = await import('/src/render/webgpu-pipeline.js');
      r.setRenderTarget(window.fixture.savedTarget, 0, 0);
      r.render(scene, camera); // Initialize the borrowed destination before counting.
      const baseline = r.info.memory.textures, remaining = [];
      for (let i = 0; i < 3; i++) {
        const graph = createWorldViewPipeline(r, scene, camera, new T.Scene(), camera,
          { gtao: false, bloomStrength: .16 });
        await new Promise(requestAnimationFrame); graph.render();
        await r.backend.device.queue.onSubmittedWorkDone();
        graph.dispose(); remaining.push(r.info.memory.textures - baseline);
      }
      await r.dispose(); return remaining;
    });
    assert.deepEqual(report.graphLifetime, [0, 0, 0], 'bloom graph rebuild must release owned input targets');
    await page.setContent('<dialog id="engine-failure">Unable to create WebGPU adapter</dialog>');
    await assert.rejects(waitForGame(page, { timeout: 1000 }), /Unable to create WebGPU adapter/);
  }
  if (!args.only || args.only === 'previews') for (const kind of ['weapons', 'ai', 'materials']) {
    await page.goto(`${url}/src/${kind}/preview.html?grab=4`);
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
    await capturePreview(page, `${out}/${kind}.png`);
    const settings = await page.evaluate(() => {
      const r = window.__PREVIEW_RENDERER__, a = r.backend.device.adapterInfo;
      return { vendor: a.vendor, fallback: a.isFallbackAdapter, exposure: r.toneMappingExposure, toneMapping: r.toneMapping };
    });
    assert.equal(settings.vendor, 'amd'); assert.equal(settings.fallback, false);
    report.previews.push({ kind, ...settings });
  }
  if (!args.only || args.only === 'fx') for (const kind of ['muzzle', 'explosion']) {
    await page.goto(`${url}/src/fx/preview.html?kind=${kind}&lockstep=1`);
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
    await page.evaluate(negative => {
      const f = window.__FX__, r = window.__PREVIEW_RENDERER__, a = r.backend.device.adapterInfo;
      if (a.vendor !== 'amd' || a.architecture !== 'rdna-4' || a.isFallbackAdapter) throw Error('Wrong GPU');
      window.draws = { view: 0, haze: 0 };
      const draw = window.__PREVIEW_DRAW__;
      window.__PREVIEW_DRAW__ = () => {
        if (negative === 'view') window.__PREVIEW_CTX__.viewScene.visible = false;
        if (negative === 'haze') f.hazeSys.uActive.value = 0;
        draw();
      };
      for (const layer of [f.viewAdd, f.viewLit]) layer.mesh.onBeforeRender = () => window.draws.view++;
      const render = f.hazeSys.render.bind(f.hazeSys);
      window.draws.hazeDraws = 0;
      f.hazeSys.layer.mesh.onBeforeRender = () => window.draws.hazeDraws++;
      f.hazeSys.render = (...args) => { const drawn = render(...args); if (drawn) window.draws.haze++; return drawn; };
    }, args.negative);
    const deltas = [];
    for (let frame = 0; frame < 60; frame++) {
      await page.evaluate(async () => { await new Promise(requestAnimationFrame); window.__PREVIEW_STEP__(); window.__PREVIEW_DRAW__(); });
      if (![2,10,20,35,55].includes(frame)) continue;
      const base = `${out}/${kind}-${frame}`;
      await capturePreview(page, `${base}.png`);
      const normal = pixels(`${base}.png`);
      await page.evaluate(async () => { window.__PREVIEW_CTX__.viewScene.visible = false; await new Promise(requestAnimationFrame); });
      await capturePreview(page, `${base}-no-view.png`);
      const noView = pixels(`${base}-no-view.png`);
      await page.evaluate(async () => {
        window.__PREVIEW_CTX__.viewScene.visible = true;
        window.savedActive = window.__FX__.hazeSys.uActive.value; window.__FX__.hazeSys.uActive.value = 0;
        await new Promise(requestAnimationFrame);
      });
      await capturePreview(page, `${base}-no-haze.png`);
      const hazeState = await page.evaluate(async () => {
        const h = window.__FX__.hazeSys, r = window.__PREVIEW_RENDERER__;
        const raw = await r.readRenderTargetPixelsAsync(h.rt, 0, 0, h.rt.width, h.rt.height);
        const row = h.rt.width * 2, stride = h.rt.height > 1 ? (raw.length - row) / (h.rt.height - 1) : row;
        let nonzero = 0;
        for (let y = 0; y < h.rt.height; y++) for (let x = 0; x < row; x++)
          if ((raw[y * stride + x] & 0x7fff) !== 0) nonzero++;
        return { active: window.savedActive, live: h._live, instances: h.layer.geometry.instanceCount, nonzero };
      });
      deltas.push({ frame, view: difference(normal, noView), haze: difference(normal, pixels(`${base}-no-haze.png`)), hazeState });
      await page.evaluate(() => { window.__FX__.hazeSys.uActive.value = window.savedActive; });
    }
    const stats = await page.evaluate(() => ({ ...window.draws,
      viewSpawned: window.__FX__.viewAdd.spawned + window.__FX__.viewLit.spawned }));
    assert(stats.haze > 0 && deltas.some(d => d.haze.changed > 20), `${kind}: haze must contribute visible output`);
    if (kind === 'muzzle') assert(stats.view > 0 && deltas.some(d => d.view.changed > 20), 'muzzle: first-person particles must contribute visible output');
    await page.setViewportSize({ width: 400, height: 220 });
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); window.__PREVIEW_STEP__(); window.__PREVIEW_DRAW__(); });
    const resize = await page.evaluate(() => ({ viewAspect: window.__PREVIEW_CTX__.viewCamera.aspect,
      hazeWidth: window.__FX__.hazeSys.rt.width, viewWidth: window.__PREVIEW_GRAPH__().viewPass.renderTarget.width }));
    assert.deepEqual(resize, { viewAspect: 400 / 220, hazeWidth: 200, viewWidth: 400 });
    const disposal = await page.evaluate(async () => {
      const fx = window.__FX__, graph = window.__PREVIEW_GRAPH__();
      const owned = [fx.hazeSys.rt, graph.worldPass.renderTarget, graph.viewPass.renderTarget, fx._atlas.texture];
      const released = owned.map(() => 0);
      owned.forEach((object, i) => object.addEventListener('dispose', () => released[i]++));
      await window.__PREVIEW_DISPOSE__();
      return { released, ready: window.__READY__ };
    });
    assert.deepEqual(disposal, { released: [1, 1, 1, 1], ready: false });
    report.fx.push({ kind, stats, deltas, resize, disposal });
    await page.setViewportSize({ width: 320, height: 180 });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify({ ...report, errors }, null, 2));
  try { await browser?.close(); } finally { stopViteServer(server); }
}
