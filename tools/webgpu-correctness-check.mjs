#!/usr/bin/env node
// Analytic coverage/surface/depth oracles plus the real AI shadow owner.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
import { verifyNative } from './lib/native-render.mjs';
const args = parseArgs(), port = Number(args.port ?? 5391);
const server = await ensureViteServer({ port });
const browser = await launchChromium({ webgpu: true, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.error(m.text()); } });
  // Each negative restores one diagnosed regression, without a runtime toggle.
  const negatives = {
    alpha: ['src/fx/particles.js', 'material.blendSrcAlpha = additive || distort ? THREE.ZeroFactor : THREE.OneFactor;', 'material.blendSrcAlpha = null;'],
    optics: ['src/weapons/materials-tsl.js', 'blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,', 'blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor,'],
    surface: ['src/render/webgpu-pipeline.js', 'channels.surface = vec4(roughness, metalness, 0, 1)', 'channels.surface = vec4(1, 1, 0, 1)'],
    order: ['src/render/webgpu-pipeline.js', "prePass.getTextureNode('linearDepth').sample(screenUV).toVar();", ''],
    shadow: ['src/ai/index.js', 'a.mesh.castShadow = visible;', 'a.mesh.userData.owNoShadow = !visible;'],
    parallax: ['src/materials/shader-tsl.js', 'after.negate().div(max(before.sub(after), 0.0001))', 'after.div(max(after.sub(before), 0.0001))'],
  };
  if (args.negative) {
    assert(Object.hasOwn(negatives, args.negative));
    const [file, before, after] = negatives[args.negative];
    await page.route(`**/${file}*`, async route => {
      const response = await route.fetch(), source = await response.text();
      assert(source.includes(before), 'negative control must match current source');
      await route.fulfill({ response, body: source.replaceAll(before, after) });
    });
  }
  await page.route('**/correctness-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(`http://127.0.0.1:${port}/correctness-fixture`);
  const result = await page.evaluate(async requireAMD => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const { createWorldViewPipeline } = await import('/src/render/webgpu-pipeline.js');
    const { ParticleLayer, resetSpawn } = await import('/src/fx/particles.js');
    const { HazeSystem } = await import('/src/fx/haze.js');
    const { WeaponMaterialsNode } = await import('/src/weapons/materials-tsl.js');
    const { parallaxUV } = await import('/src/materials/shader-tsl.js');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const close = (a, b, message) => check(Math.abs(a - b) < .003, `${message}: ${a} != ${b}`);
    const renderer = await createWebGpuRenderer(document.querySelector('canvas'));
    renderer.setSize(64, 64);
    const info = renderer.backend.device.adapterInfo;
    check(!info.isFallbackAdapter && (!requireAMD || (info.vendor === 'amd' && info.architecture === 'rdna-4')), 'wrong native device');
    const scene = new T.Scene(), view = new T.Scene(), camera = new T.PerspectiveCamera(60, 1, .1, 100);
    scene.background = new T.Color(.5, .6, .7);
    const atlas = new T.DataTexture(new Uint8Array([255,255,255,255]), 1, 1); atlas.needsUpdate = true;
    const target = new T.RenderTarget(64, 64, { type: T.HalfFloatType, depthBuffer: false });
    const read = async (rt, attachment = 0) => Array.from(await renderer.readRenderTargetPixelsAsync(rt, 32, 32, 1, 1, attachment), T.DataUtils.fromHalfFloat);
    const geometry = new T.PlaneGeometry(10, 10), opaque = new T.MeshBasicNodeMaterial({ color: new T.Color(.2, .2, .2) });
    const underlay = new T.Mesh(geometry, opaque); underlay.position.z = -3;
    const coverage = [];
    for (const mode of ['additive', 'lit']) for (const covered of [false, true]) {
      if (covered) view.add(underlay);
      const layer = new ParticleLayer({ capacity: 16, mode, atlas, cols: 1 }); view.add(layer.mesh);
      const s = resetSpawn(); s.z = -2; s.size0 = s.size1 = 2; s.life = 10; s.alpha = .5;
      s.r0 = s.g0 = s.b0 = s.r1 = s.g1 = s.b1 = .1; s.i0 = s.i1 = 1;
      layer.emit(s, 0); layer.flush(.5);
      const graph = createWorldViewPipeline(renderer, scene, camera, view, camera, { gtao: false, bloomStrength: 0 });
      graph.pipeline.outputColorTransform = false;
      renderer.setRenderTarget(target); graph.render();
      const rgba = await read(graph.viewPass.renderTarget), output = await read(target);
      const alpha = covered ? 1 : mode === 'additive' ? 0 : .475;
      close(rgba[3], alpha, `${mode}/${covered}: coverage alpha`);
      for (let i = 0; i < 3; i++) close(output[i], [.5,.6,.7][i] * (1 - alpha) + rgba[i], 'premultiplied composition');
      check(output.slice(0,3).every(x => x >= 0), 'negative composite RGB');
      coverage.push({ mode, covered, rgba, output });
      graph.dispose(); layer.mesh.removeFromParent(); layer.dispose(); underlay.removeFromParent();
    }
    const optics = new WeaponMaterialsNode({});
    for (const mat of [optics.reticle(), optics.lensRing(), optics.glass()]) {
      const mesh = new T.Mesh(geometry, mat); mesh.position.z = -2; view.add(mesh);
      const graph = createWorldViewPipeline(renderer, scene, camera, view, camera, { gtao: false, bloomStrength: 0 });
      renderer.setRenderTarget(target); graph.render();
      close((await read(graph.viewPass.renderTarget))[3], mat === optics.glass() ? .1 : 0, `${mat.name}: optical coverage`);
      graph.dispose(); mesh.removeFromParent();
    }
    optics.dispose();
    const surface = new T.MeshStandardNodeMaterial({ roughness: 1, metalness: 1 });
    surface.roughnessNode = N.float(.15); surface.metalnessNode = N.float(0);
    const wall = new T.Mesh(geometry, surface); wall.position.z = -5; wall.layers.enable(1); scene.add(wall);
    const graph = createWorldViewPipeline(renderer, scene, camera, view, camera, { gtao: false, ssrEnabled: true, bloomStrength: 0 });
    const mapped = new T.DataTexture(new Uint8Array([255,128,64,255]), 1, 1); mapped.needsUpdate = true;
    const surfaces = [];
    for (const custom of [true, false]) {
      if (!custom) { surface.roughnessNode = surface.metalnessNode = null; surface.roughness = .8; surface.metalness = .5; surface.roughnessMap = surface.metalnessMap = mapped; surface.needsUpdate = true; }
      renderer.setRenderTarget(target); graph.render();
      const rt = graph.prePass.renderTarget, index = rt.textures.findIndex(t => t.name === 'surface');
      const values = await read(rt, index); surfaces.push(values);
      close(values[0], custom ? .15 : .8 * 128 / 255, 'surface roughness');
      close(values[1], custom ? 0 : .5 * 64 / 255, 'surface metalness');
    }
    graph.dispose();
    const depth = [];
    for (const gtao of [false, true]) {
      const haze = new HazeSystem({ capacity: 16, atlas, cols: 1 }); haze.resize(64, 64);
      const order = [];
      const graph = createWorldViewPipeline(renderer, scene, camera, view, camera, { gtao, bloomStrength: 0,
        afterDepth: () => { order.push('haze'); haze.render(renderer, camera); } });
      scene.onBeforeRender = (_r, _s, _c, rt) => order.push(rt === graph.prePass.renderTarget ? 'prepass' : 'world');
      haze.emit(0, 0, 0, -3, 2, 1, 10, 1, 0); haze.update(.5, graph.linearDepth.value, camera);
      const counts = [];
      for (const z of [-5, -2, -5]) {
        // PassNode updates once per native animation frame, not per readback.
        await new Promise(requestAnimationFrame);
        wall.position.z = z; order.length = 0;
        renderer.setRenderTarget(target); graph.render();
        check(order.join(',') === 'prepass,haze,world', `current-depth order (AO=${gtao}): ${order}`);
        const raw = await renderer.readRenderTargetPixelsAsync(haze.rt, 0, 0, 32, 32);
        const count = Array.from(raw, T.DataUtils.fromHalfFloat).filter(x => Math.abs(x) > .001).length;
        counts.push(count); check(z === -2 ? count === 0 : count > 0, 'haze must occlude/reappear on the first moved-wall frame');
      }
      depth.push({ gtao, counts }); graph.dispose(); haze.dispose();
    }
    scene.onBeforeRender = () => {};
    // Constant height has an analytic intersection between discrete march layers.
    const height = new T.DataTexture(new Uint8Array([255,255,255,161]), 1, 1);
    height.minFilter = height.magFilter = T.LinearFilter; height.needsUpdate = true;
    const parallaxMaterial = new T.MeshBasicNodeMaterial();
    parallaxMaterial.fragmentNode = N.Fn(() => N.vec4(parallaxUV(height, N.vec2(.5), N.vec3(.5,0,1), N.float(.2), N.float(1), 16), 0, 1))();
    const quad = new T.QuadMesh(parallaxMaterial); renderer.setRenderTarget(target); quad.render(renderer);
    const parallax = await read(target);
    const intersection = .5 - .5 * .2 * (1 - 161 / 255);
    // Tight enough to reject the full-layer endpoint (0.4625).
    check(Math.abs(parallax[0] - intersection) < .0003, `parallax lost interpolation: ${parallax[0]} != ${intersection}`);
    parallaxMaterial.dispose(); height.dispose();
    renderer.setRenderTarget(null); surface.dispose(); mapped.dispose(); opaque.dispose(); geometry.dispose(); atlas.dispose(); target.dispose(); await renderer.dispose();
    return { coverage, surfaces, depth, parallax };
  }, process.env.MESA_VK_DEVICE_SELECT === '1002:7550!');
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 180000 });
  await verifyNative(page);
  result.shadows = await page.evaluate(async () => {
    const e = window.__ENGINE__, ctx = e.ctx, ai = ctx.get('ai');
    window.__APPLY_SHOT__('combat'); await window.__PUMP__(6);
    const mesh = ai.agents[0].mesh, culled = mesh.frustumCulled, before = mesh.onBeforeShadow;
    const far = ctx.camera.clone(); far.position.set(10000,10000,10000); far.updateMatrixWorld(true);
    let draws = 0; mesh.frustumCulled = false; mesh.onBeforeShadow = () => draws++;
    const counts = [];
    try {
      for (const camera of [ctx.camera, far, ctx.camera]) {
        ai._updateRelevance({ ...ctx, camera }); draws = 0;
        await window.__PRESENT__(1); ctx.get('render').render(ctx); counts.push(draws);
      }
    } finally { mesh.onBeforeShadow = before; mesh.frustumCulled = culled; ai._updateRelevance(ctx); }
    return counts;
  });
  assert(result.shadows[0] > 0 && result.shadows[1] === 0 && result.shadows[2] > 0, `AI native shadow relevance: ${result.shadows}`);
  await page.evaluate(() => window.__ENGINE__.dispose());
  assert.deepEqual(errors, []);
  writeFileSync(args.out ?? '/tmp/webgpu-correctness.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); stopViteServer(server); }
