#!/usr/bin/env node
// Diagnostic stage/input isolation. Additional renders advance history, not
// simulation: stage images are not matched-history final-frame comparisons.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5324);
const out = resolve(args.out ?? '/tmp/cod-parity-isolate'), shot = args.shot ?? 'ads';
const material = args.material ?? 'stock', quality = args.quality ?? 'high';
const controls = { stock: '', 'no-parallax': 'parallax: 0', 'no-detile': 'detile: 0',
  'no-detail': 'detail: [1, 0, 0, 1]', 'no-macro': 'macroRelief: 0',
  'no-normal': 'normalAmpNode: null, normalStrength: 0, detail: [1, 0, 0, 1], macroRelief: 0' };
assert(Object.hasOwn(controls, material));
mkdirSync(out, { recursive: true });
const root = resolve(args.root ?? '.');
const server = await ensureViteServer({ port, root });
const browser = await launchChromium({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--force-color-profile=srgb'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (material !== 'stock') await page.route('**/src/materials/shader-tsl.js', async route => {
    const response = await route.fetch(); let body = await response.text();
    const marker = '  const { physical, ...props } = threeProps;';
    assert.equal(body.split(marker).length, 2);
    body = body.replace(marker, `  p = { ...p, ${controls[material]} };\n${marker}`);
    await route.fulfill({ response, body });
  });
  if (args.shadow) await page.route('**/src/render/index-webgpu.js', async route => {
    const response = await route.fetch(); let body = await response.text();
    const before = args.shadow === 'off' ? '    light.castShadow = true;' : '    light.shadow.bias = -0.00008;';
    const after = args.shadow === 'off' ? '    light.castShadow = false; return;' : `    light.shadow.bias = ${Number(args.shadow)};`;
    assert.equal(body.split(before).length, 2);
    await route.fulfill({ response, body: body.replace(before, after) });
  });
  await page.route('**/src/render/webgpu-pipeline.js', async route => {
    const response = await route.fetch(); let body = await response.text();
    const marker = '    pipeline, worldPass, viewPass, prePass, aoPass, aoBlur, ssrPass, taaPass, exposure,';
    assert.equal(body.split(marker).length, 2);
    body = body.replace(marker, `${marker}\n    diagnostic: { world, composite, exposed, lit, glow },`);
    for (const [on, before, after] of [
      [args['no-ao'], '  if (gtao) {', '  if (false) {'],
      [args['no-fog'], '  if (fog) world = fog(', '  if (false) world = fog('],
      [args['no-bloom'], 'const glow = bloomStrength > 0 ?', 'const glow = false ?'],
    ]) if (on) { assert.equal(body.split(before).length, 2); body = body.replace(before, after); }
    await route.fulfill({ response, body });
  });
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&q=${quality}`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 120000 });
  const setup = await page.evaluate(async ({ shot, exposure }) => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), a = r.renderer.backend.device.adapterInfo;
    if (a.vendor !== 'amd' || a.architecture !== 'rdna-4' || a.isFallbackAdapter) throw new Error('RX 9070 XT required');
    window.__APPLY_SHOT__(shot, { grabFrame: 180 }); await window.__PUMP__(180);
    await r._meterTask; r.settings.autoExposure = false;
    if (exposure !== null) r._exposure = exposure;
    r._graph.exposure.value = r._exposure * 2 ** -r.settings.exposureBias;
    const fx = e.ctx.get('fx');
    const hash = array => {
      let value = 2166136261;
      for (const byte of new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) value = Math.imul(value ^ byte, 16777619);
      return { bytes: array.byteLength, fnv1a: value >>> 0 };
    };
    const buffers = [fx.lit, fx.add, fx.motes, fx.viewLit, fx.viewAdd, fx.hazeSys.layer, fx.shells].map(layer => ({
      count: layer.geometry.instanceCount ?? layer.mesh.count, visible: layer.mesh.visible,
      attributes: Object.fromEntries(Object.entries(layer.geometry.attributes).map(([name, attribute]) => [name, hash(attribute.array)])),
      instances: layer.mesh.instanceMatrix ? hash(layer.mesh.instanceMatrix.array) : null,
    }));
    const rng = object => object ? [object.s0, object.s1, object.s2, object.s3] : null;
    const lights = [fx.lights, fx.viewLights].map(pool => pool?.lights.map(({ light, age, peak, duration }) => ({
      position: light.position.toArray(), color: light.color.toArray(), intensity: light.intensity, age, peak, duration,
    })));
    const weapons = e.ctx.get('weapons');
    return { inputs: { buffers, lights, rng: rng(e.rng), viewRng: rng(weapons.viewmodel.rng),
      fov: [e.camera.fov, e.ctx.viewCamera.fov],
      weapon: { id: weapons.activeId, clip: weapons.viewmodel.clipName, time: weapons.viewmodel.clipT, ads: weapons.viewmodel.adsT },
      actors: e.ctx.get('ai').agents.map(a => ({ id: a.id, position: a.position.toArray(), alive: a.alive, state: a.state })),
      streams: Object.fromEntries(
      ['player', 'weapons', 'fx', 'ai'].map(id => [id, rng(e.ctx.get(id).rng)])) }, device: { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter },
      exposure: r._exposure, frame: e.time.frame, elapsed: e.time.elapsed, camera: e.camera.position.toArray(), rotation: e.camera.quaternion.toArray() };
  }, { shot, exposure: args.exposure === undefined ? null : Number(args.exposure) });
  const stages = (args.stages ?? 'final,world,normal,depth,ao,taa,fog,composite,bloom').split(',');
  for (const stage of stages) {
    const result = await page.evaluate(async ({ stage }) => {
      const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
      const e = window.__ENGINE__, r = e.ctx.get('render'), g = r._graph;
      const renderer = r.renderer, output = g.pipeline.outputNode;
      let node = null, hdr = false;
      if (stage === 'world') { node = g.worldPass.getTextureNode(); hdr = true; }
      if (stage === 'normal') node = N.vec4(g.prePass.getTextureNode().rgb.mul(0.5).add(0.5), 1);
      if (stage === 'depth') node = N.vec4(g.prePass.getTextureNode('linearDepth').rrr.div(80), 1);
      if (stage === 'ao') node = N.vec4(g.aoBlur ? N.texture(g.aoBlur.textureNode.value).rrr : N.vec3(1), 1);
      if (stage === 'taa') { node = g.taaPass?.getTextureNode() ?? g.worldPass.getTextureNode(); hdr = true; }
      if (stage === 'fog') { node = g.diagnostic.world; hdr = true; }
      if (stage === 'composite') { node = g.diagnostic.composite; hdr = true; }
      if (stage === 'bloom') node = N.renderOutput(g.diagnostic.glow ?? N.vec4(0), T.AgXToneMapping, T.SRGBColorSpace);
      if (node) g.pipeline.outputNode = hdr ? N.renderOutput(node.mul(g.exposure), T.AgXToneMapping, T.SRGBColorSpace) : node;
      g.pipeline.needsUpdate = true;
      const target = new T.RenderTarget(1280, 720, { depthBuffer: false });
      const original = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target); g.render();
        const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1280, 720);
        const { packedReadback } = await import('/tools/lib/native-readback.js');
        const pixels = new Uint8ClampedArray(packedReadback(data, 1280, 720));
        const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
        canvas.getContext('2d').putImageData(new ImageData(pixels, 1280, 720), 0, 0);
        return { png: canvas.toDataURL('image/png').split(',')[1], frame: e.time.frame, elapsed: e.time.elapsed };
      } finally { renderer.setRenderTarget(original); target.dispose(); g.pipeline.outputNode = output; g.pipeline.needsUpdate = true; }
    }, { stage });
    assert.equal(result.frame, setup.frame); assert.equal(result.elapsed, setup.elapsed);
    writeFileSync(`${out}/${stage}.png`, Buffer.from(result.png, 'base64'));
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/report.json`, JSON.stringify({ root, material, shot, quality, controls: args, ...setup, errors }, null, 2));
  console.log(JSON.stringify({ out, material, shot, ...setup }));
  await page.evaluate(() => window.__ENGINE__.dispose());
} finally { await browser.close(); stopViteServer(server); }
