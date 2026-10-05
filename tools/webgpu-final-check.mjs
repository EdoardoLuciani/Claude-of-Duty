#!/usr/bin/env node
// Final-review analytic oracles and actual-game first-use/capture checks.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
import { verifyNative, captureNative } from './lib/native-render.mjs';
const args = parseArgs(), port = Number(args.port ?? 5395);
const server = await ensureViteServer({ port });
let browser;
const report = { errors: [], warnings: [] };
try {
  browser = await launchChromium({ webgpu: true, headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') report.errors.push(m.text());
    if (m.type() === 'warning') report.warnings.push(m.text());
  });
  // Get all compiler messages, even when Chromium truncates its console stream.
  await page.addInitScript(() => {
    window.__SHADER_INFO__ = [];
    const create = GPUDevice.prototype.createShaderModule;
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      const code = descriptor.code;
      const module = create.call(this, descriptor);
      window.__SHADER_INFO__.push(module.getCompilationInfo().then(info => [...info.messages].map(m => ({
        type: m.type, text: m.message, line: m.lineNum,
        source: code.split('\n').slice(Math.max(0, m.lineNum - 2), m.lineNum + 1).join('\n'),
      }))));
      return module;
    };
  });
  const controls = {
    sky: ['src/sky/dome.js', 'acos(clamp(cos', 'acos((cos'],
    haze: ['src/fx/haze.js', '.xy.mul(vec2(1, -1)).mul(strength.x)', '.xy.mul(strength.x)'],
    exposure: ['src/render/webgpu-pipeline.js', 'const exposed = composite.mul(exposure);', 'const exposed = grade ? composite.mul(exposure) : composite;'],
    injury: ['src/render/webgpu-pipeline.js', 'const exposed = composite.mul(exposure);',
      'composite = composite.mul(view.a.oneMinus()).add(view); const exposed = composite.mul(exposure);'],
    placement: ['src/render/webgpu-pipeline.js', 'if (warp) world = warp(asTexture(world));', ''],
    ao: ['src/render/webgpu-pipeline.js', 'screenCoordinate.div(aoSize)', 'screenCoordinate.div(aoSize.mul(2))'],
    cache: ['src/render/webgpu-pipeline.js', 'viewPass.contextNode = context({});', ''],
    grenade: ['src/weapons/index.js', 'this.viewmodel.radio, this.viewmodel.grenade,', 'this.viewmodel.radio,'],
    fog: ['src/render/index-webgpu.js', 'frame: this._fogFrame,', 'frame: nativeFrameId,'],
  };
  if (args.negative) {
    const [file, before, after] = controls[args.negative];
    await page.route(`**/${file}*`, async route => {
      const response = await route.fetch(); let body = await response.text();
      assert(body.includes(before)); body = body.replaceAll(before, after);
      if (args.negative === 'sky') body = body.replaceAll('(cosS, -1, 1)', '(cosS)').replaceAll('(cosM, -1, 1)', '(cosM)');
      if (args.negative === 'placement') body = body.replace('const exposure = uniform(1);', 'const exposure = uniform(1); if (warp) composite = warp(asTexture(composite));');
      if (args.negative === 'fog') body = body.replace('import { lightPosition,', 'import { frameId as nativeFrameId, lightPosition,');
      await route.fulfill({ response, body });
    });
  }
  await page.route('**/final-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(`http://127.0.0.1:${port}/final-fixture`);
  report.fixture = await page.evaluate(async requireAMD => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const { createSkySample } = await import('/src/sky/dome.js');
    const { Celestial } = await import('/src/sky/celestial.js');
    const { HazeSystem } = await import('/src/fx/haze.js');
    const { createWorldViewPipeline } = await import('/src/render/webgpu-pipeline.js');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const close = (a, b, message) => check(Math.abs(a - b) < .002, `${message}: ${a} != ${b}`);
    const r = await createWebGpuRenderer(document.querySelector('canvas')); r.setSize(64, 64);
    const info = r.backend.device.adapterInfo;
    check(!info.isFallbackAdapter && (!requireAMD || info.vendor === 'amd' && info.architecture === 'rdna-4'), 'wrong device');
    const rt = new T.RenderTarget(64, 64, { type: T.HalfFloatType, depthBuffer: false });
    const draw = async node => {
      const p = new T.RenderPipeline(r, node); p.outputColorTransform = false;
      r.setRenderTarget(rt); p.render();
      const data = Array.from(await r.readRenderTargetPixelsAsync(rt, 0, 0, 64, 64), T.DataUtils.fromHalfFloat);
      p.dispose(); return data;
    };
    const black = new T.DataTexture(new Uint8Array([0,0,0,255]), 1, 1); black.needsUpdate = true;
    const discs = [];
    for (const body of ['sun', 'moon']) {
      const celestial = new Celestial(), data = new Float32Array(64 * 64 * 4);
      for (let i = 0; i < 4096; i++) { celestial.setHour(24 * i / 4096); celestial[body].toArray(data, i * 4); data[i * 4 + 3] = 1; }
      const directions = new T.DataTexture(data, 64, 64, T.RGBAFormat, T.FloatType); directions.needsUpdate = true;
      const dir = N.texture(directions, N.screenUV).rgb;
      const shared = { uViewPos: N.vec3(0), uMieScale: N.float(0),
        uSunDir: body === 'sun' ? dir : dir.negate(), uMoonDir: body === 'moon' ? dir : dir.negate(),
        uSunIrradiance: N.vec3(0), uMoonIrradiance: N.vec3(0),
        uSunDiscRadiance: N.vec3(body === 'sun' ? 1 : 0), uMoonDiscRadiance: N.vec3(body === 'moon' ? 1 : 0),
        uDisc: N.vec4(.00465,.00465,1,1), uGroundAlbedo: N.vec3(0), uHorizonMurk: N.float(0),
        uSkyRolloff: N.vec2(0,1), ambientTex: black };
      const sample = createSkySample(shared, { skTransmittance: N.Fn(() => N.vec3(1)),
        skSkyView: N.Fn(() => N.vec3(0)), skClouds: N.Fn(() => N.vec4(0)), skNightSky: N.Fn(() => N.vec3(0)) },
        { points: true, moonOct: 2 });
      const pixels = await draw(N.vec4(sample(dir), 1));
      let missing = 0;
      for (let i = 0; i < pixels.length; i += 4) if (!Number.isFinite(pixels[i]) || pixels[i] <= 0) missing++;
      check(missing === 0, `${body}: ${missing}/4096 disc centers missing`);
      discs.push({ body, samples: 4096, missing }); directions.dispose();
    }
    const atlas = new T.DataTexture(new Uint8Array([255,255,255,255]), 1, 1); atlas.needsUpdate = true;
    const camera = new T.PerspectiveCamera(60, 1, .1, 100);
    const haze = new HazeSystem({ capacity: 16, atlas, cols: 1 }); haze.resize(64, 64);
    haze.emit(0, 0, 0, -3, 2, 1, 10, 1, 0); haze.update(.5, null, camera); haze.render(r, camera);
    const gradient = N.convertToTexture(N.vec4(N.screenUV, 0, 1));
    const warped = await draw(haze.warpNode(gradient));
    const offsets = [[20,32],[43,32],[32,20],[32,43]].map(([x,y]) => {
      const i = (y * 64 + x) * 4;
      return [warped[i] - (x + .5)/64, warped[i + 1] - (y + .5)/64];
    });
    check(offsets[0][0] < -.001 && offsets[1][0] > .001 && offsets[2][1] < -.001 && offsets[3][1] > .001,
      `haze four-direction symmetry: ${JSON.stringify(offsets)}`);
    gradient.dispose(); haze.dispose();

    const scene = new T.Scene(), view = new T.Scene(); scene.background = new T.Color(.2, .3, .4);
    const geometry = new T.PlaneGeometry(10,10), material = new T.MeshBasicNodeMaterial({ color: new T.Color(.6,.2,.1) });
    const weapon = new T.Mesh(geometry, material); weapon.position.z = -2; view.add(weapon);
    const { createHdrMeter } = await import('/src/render/meter-webgpu.js');
    const results = [];
    let fogMeter;
    for (const visible of [false, true]) {
      weapon.visible = visible;
      const fogGain = N.uniform(0);
      const graph = createWorldViewPipeline(r, scene, camera, view, camera, { gtao: false, bloomStrength: 0,
        fog: ({color}) => N.vec4(color.sample(N.screenUV).rgb.add(fogGain),1),
        warp: tex => tex.sample(N.screenUV).mul(N.vec4(.5,.5,.5,1)) });
      graph.pipeline.outputColorTransform = false; graph.exposure.value = 2;
      await new Promise(requestAnimationFrame); r.setRenderTarget(rt); graph.render();
      const pixels = Array.from(await r.readRenderTargetPixelsAsync(rt, 32,32,1,1), T.DataUtils.fromHalfFloat);
      const expected = visible ? [1.2,.4,.2] : [.2,.3,.4];
      expected.forEach((v,i) => close(pixels[i], v, 'world-only warp and grade-independent exposure'));
      results.push({ visible, pixels });
      if (!visible) {
        const meter = createHdrMeter(r,graph.worldPass.renderTarget.texture,graph.linearDepth.value);
        const before = await meter.sample(); fogGain.value=1;
        await new Promise(requestAnimationFrame); r.setRenderTarget(rt); graph.render();
        const after = await meter.sample();
        close(before,after,'fog is intentionally outside the scene-illumination meter');
        const fogged=Array.from(await r.readRenderTargetPixelsAsync(rt,32,32,1,1),T.DataUtils.fromHalfFloat);
        check(fogged[0]>pixels[0]+.9,'fog policy fixture must visibly change composition');
        fogMeter={before,after}; meter.dispose();
      }
      graph.dispose();
    }
    const { LowHealthPass } = await import('/src/player/lowhealth.js');
    const injury = new LowHealthPass(); injury.resize(64,64); injury.state.value.set(.2,0,1);
    weapon.visible=true;
    const injured = createWorldViewPipeline(r,scene,camera,view,camera,{gtao:false,bloomStrength:0,postPasses:[injury]});
    injured.pipeline.outputColorTransform=false;
    await new Promise(requestAnimationFrame); r.setRenderTarget(rt); injured.render();
    const actualInjury=Array.from(await r.readRenderTargetPixelsAsync(rt,32,32,1,1),T.DataUtils.fromHalfFloat);
    const referenceInjury=await draw(injury.asColorNode(N.vec4(.6,.2,.1,1),injured.exposure));
    actualInjury.slice(0,3).forEach((v,i)=>close(v,referenceInjury[(32*64+32)*4+i],'injury includes the first-person pass'));
    check(Math.abs(actualInjury[0]-.6)>.01,'injury fixture must visibly alter the weapon');
    injured.dispose(); injury.dispose();

    // Equal environment and light topology: camera-dependent material hooks
    // must not rely on differing light hashes to distinguish world/view.
    const { IndirectFill } = await import('/src/render/indirect-webgpu.js');
    const world = new T.Scene(), first = new T.Scene(), viewCamera = camera.clone();
    const env = new T.DataTexture(new Uint8Array(256*128*4).fill(255),256,128);
    env.mapping = T.EquirectangularReflectionMapping; env.needsUpdate = true;
    world.environment = first.environment = env;
    const fill = new IndirectFill({ viewCamera, peek: () => null });
    fill.sky.value.setScalar(.3); fill.viewVisibility.value = .1;
    const shared = new T.MeshStandardNodeMaterial({ roughness: 1 }); fill.patch(shared);
    const a = new T.Mesh(geometry, shared), b = new T.Mesh(geometry, shared);
    a.position.z = b.position.z = -3; a.layers.enable(1); world.add(a); first.add(b);
    const split = createWorldViewPipeline(r,world,camera,first,viewCamera,{gtao:false,bloomStrength:0});
    split.pipeline.outputColorTransform = false;
    await new Promise(requestAnimationFrame); r.setRenderTarget(rt); split.render();
    const pixel = async target => Array.from(await r.readRenderTargetPixelsAsync(target,32,32,1,1),T.DataUtils.fromHalfFloat);
    const sharedView = await pixel(split.viewPass.renderTarget);
    const reference = new T.MeshStandardNodeMaterial({ roughness: 1 });
    reference.customProgramCacheKey = () => 'isolated-view-reference'; fill.patch(reference); b.material = reference;
    await new Promise(requestAnimationFrame); split.render();
    const isolatedView = await pixel(split.viewPass.renderTarget);
    sharedView.slice(0,3).forEach((v,i) => close(v,isolatedView[i],'shared material camera cache identity'));
    split.dispose(); shared.dispose(); reference.dispose();

    // Compare target-size UVs to native screenUV through two actual AO graphs,
    // including a resize. A corner fixture must produce nonuniform AO.
    first.remove(b); world.remove(a);
    world.add(new T.AmbientLight(0xffffff,1));
    const aoMaterial = new T.MeshStandardNodeMaterial({ roughness:1 });
    const wall = new T.Mesh(geometry,aoMaterial); wall.position.z=-4; wall.layers.enable(1); world.add(wall);
    const cube = new T.Mesh(new T.BoxGeometry(1,1,.2),aoMaterial); cube.position.set(0,-.4,-3.85); cube.layers.enable(1); world.add(cube);
    const aoChecks = [];
    for (const width of [64,128]) {
      r.setSize(width,64); camera.aspect=width/64; camera.updateProjectionMatrix(); rt.setSize(width,64);
      const images=[]; let aoRange;
      for (const referenceUV of [false,true]) {
        const g=createWorldViewPipeline(r,world,camera,first,viewCamera,{gtao:true,bloomStrength:0});
        g.aoPass.radius.value=1; // Exaggerate only the fixture's contact signal.
        if(referenceUV) g.worldPass.contextNode=N.builtinAOContext(N.texture(g.aoBlur.textureNode.value).sample(N.screenUV).r);
        g.pipeline.outputColorTransform=false;
        for(let frame=0;frame<3;frame++) {
          await new Promise(requestAnimationFrame); r.setRenderTarget(rt); g.render();
        }
        images.push(Array.from(await r.readRenderTargetPixelsAsync(rt,0,0,width,64),T.DataUtils.fromHalfFloat));
        const aoRT=g.aoBlur.textureNode.renderTarget;
        const visibility=await r.readRenderTargetPixelsAsync(aoRT,0,0,width,64);
        const row=(visibility.length-width)/63; let lo=255,hi=0;
        for(let y=0;y<64;y++)for(let x=0;x<width;x++) {
          lo=Math.min(lo,visibility[y*row+x]); hi=Math.max(hi,visibility[y*row+x]);
        }
        check(hi-lo>8,`AO fixture must have nonuniform visibility: ${lo}..${hi}, target ${aoRT.width}x${aoRT.height}, ${visibility.length} bytes`);
        aoRange=[lo,hi]; g.dispose();
      }
      const maxError=Math.max(...images[0].map((v,i)=>Math.abs(v-images[1][i])));
      check(maxError<.002,`AO target UV mismatch at ${width}: ${maxError}`);
      aoChecks.push({width,maxError,aoRange});
    }
    cube.geometry.dispose(); aoMaterial.dispose(); env.dispose();
    geometry.dispose(); material.dispose(); atlas.dispose(); black.dispose(); rt.dispose();
    await r.dispose(); return { discs, offsets, composition: results, actualInjury, fogMeter, sharedView, isolatedView, aoChecks };
  }, process.env.MESA_VK_DEVICE_SELECT === '1002:7550!');
  report.fixtureShaders = (await page.evaluate(async () => (await Promise.all(window.__SHADER_INFO__)).flat()));
  if (!args.fixture) {
    await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=${args.quality ?? 'high'}`);
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 180000 });
    report.device = await verifyNative(page);
    report.game = await page.evaluate(async () => {
      const e = window.__ENGINE__, r = e.ctx.get('render'), w = e.ctx.get('weapons');
      const { THREE: T } = await import('/tools/arm-material-fixture.js');
      if (!window.__PREWARM__.ok) throw Error('warmup failed');
      const before = window.__NATIVE_BUILDS__;
      w._updateGrenade(0, { actionPressed: action => action === 'grenade' }, true);
      await window.__PUMP__(12);
      if (!w.grenadeEquipped || window.__NATIVE_BUILDS__ !== before) throw Error(`grenade first equip: ${window.__NATIVE_BUILDS__ - before} late builders`);
      const grenadeLateBuilders = window.__NATIVE_BUILDS__ - before;
      w._stowGrenade();
      // Freeze app state, not Three's internal animation loop. Read actual fog
      // output twice after idle native frames; then advance the application clock.
      const rt = new T.RenderTarget(64,64,{ type:T.HalfFloatType,depthBuffer:false });
      const oldSize = r.renderer.getSize(new T.Vector2());
      const oldTaa = r.q.taa, oldSsr = r.q.ssr, viewVisible = e.viewScene.visible;
      e.viewScene.visible = false; // Exclude frame-smoothed first-person lighting.
      r._releaseGraph(); r.q.taa = false; r.q.ssr = false; r._getGraph();
      r.settings.autoExposure = false; r._exposure = 1;
      r.renderer.setSize(64,64,false);
      const sample = async () => {
        r.renderer.setRenderTarget(rt); r._graph.render();
        return [...await r.renderer.readRenderTargetPixelsAsync(rt,0,0,64,64)];
      };
      r.render(e.ctx); await new Promise(requestAnimationFrame);
      const a = await sample(), clock = r._fogFrame.value;
      for (let i=0;i<11;i++) await new Promise(requestAnimationFrame);
      const b = await sample();
      const idleChanges = a.filter((x,i) => x !== b[i]).length;
      if (idleChanges) throw Error(`idle fog changed ${idleChanges} channels`);
      e.time.frame++; r.render(e.ctx);
      if (r._fogFrame.value !== e.time.frame) throw Error('render owner did not publish the app sampling clock');
      await new Promise(requestAnimationFrame); const c = await sample();
      const steppedChanges = b.filter((x,i) => x !== c[i]).length;
      if (r.q.volumetrics && !steppedChanges) throw Error('marched fog sampling must advance with app frames');
      if (!r.q.volumetrics && steppedChanges) throw Error('analytic-only fog must not acquire temporal noise');
      r.renderer.setRenderTarget(null); rt.dispose(); r.renderer.setSize(oldSize.x,oldSize.y,false);
      r._releaseGraph(); r.q.taa=oldTaa; r.q.ssr=oldSsr; r._getGraph();
      r.settings.autoExposure=true; e.viewScene.visible=viewVisible;
      return { grenadeLateBuilders, fog: { marched: !!r.q.volumetrics, clock, idleChanges, steppedChanges } };
    });
    // Policy evidence, not an exposure retune: meter the unexposed world,
    // excluding scope masks/first-person flashes and screen post effects.
    report.exposure = [];
    for (const [shot,hour] of [['hero',12],['hero',16.5],['sunset',19.2],['sunset',19.7],['night',20.5],['night',1.5],['ads',16.5]]) {
      await page.evaluate(async ({shot,hour}) => {
        await window.__APPLY_SHOT__(shot,{grabFrame:4});
        window.__ENGINE__.ctx.get('sky').setTimeOfDay(hour);
        await window.__PUMP__(4);
      },{shot,hour});
      const row = await page.evaluate(async () => {
        const e=window.__ENGINE__, r=e.ctx.get('render'), sky=e.ctx.get('sky');
        const { THREE:T }=await import('/tools/arm-material-fixture.js');
        await r._meterTask; await r._meter(); r._exposure=r._exposureTarget; r.render(e.ctx);
        const w=r.screenSize.width,h=r.screenSize.height,target=new T.RenderTarget(w,h);
        await new Promise(requestAnimationFrame);
        const old=r.renderer.getRenderTarget(); let pixels,depth;
        try {
          r.renderer.setRenderTarget(target); r._graph.render();
          pixels=await r.renderer.readRenderTargetPixelsAsync(target,0,0,w,h);
          const index=r._graph.prePass.renderTarget.textures.findIndex(t=>t.name==='linearDepth');
          depth=await r.renderer.readRenderTargetPixelsAsync(r._graph.prePass.renderTarget,0,0,w,h,index);
        } finally {r.renderer.setRenderTarget(old);target.dispose();}
        const row=(pixels.length-w*4)/(h-1), depthRow=(depth.length-w*4)/(h-1);
        let skyPixels=0,clippedSky=0,sum=0;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
          const i=y*row+x*4, z=T.DataUtils.fromHalfFloat(depth[y*depthRow+x*4]);
          if(z<=0) {skyPixels++; if(Math.min(pixels[i],pixels[i+1],pixels[i+2])>=250)clippedSky++;}
          sum+=(pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722)/255;
        }
        const base=await r._meterPass.sample(), visible=e.viewScene.visible;
        e.viewScene.visible=false;
        // Compare at the same jitter phase, rather than mistaking a shifted
        // world sample for a first-person metering contribution.
        for (let i=0;i<(r._graph.taaPass ? 32 : 1);i++) {
          await new Promise(requestAnimationFrame); r._graph.render();
        }
        const withoutView=await r._meterPass.sample(); e.viewScene.visible=visible;
        await new Promise(requestAnimationFrame); r._graph.render();
        if(Math.abs(base-withoutView)>Math.max(1e-5,base*.001))throw Error(`viewmodel changed world-only meter: ${base} vs ${withoutView}`);
        return {hour:sky.hour,elevation:sky.sunAltitude,exposure:r._exposureTarget,bias:r.settings.exposureBias,
          meanDisplay:sum/(w*h),skyPixels,clippedSky,clippedFraction:clippedSky/Math.max(1,skyPixels),base,withoutView};
      });
      assert(row.exposure>=.003 && row.exposure<=5 && row.bias===0);
      assert(row.clippedFraction<.01,`broad sky clipping at ${hour}: ${row.clippedFraction}`);
      report.exposure.push({shot,...row});
      if(args.shot && [19.2,1.5].includes(hour)) await captureNative(page,`${args.shot}-${hour}.png`);
    }
    if (args.shot) await captureNative(page, String(args.shot));
    report.gameShaders = await page.evaluate(async () => (await Promise.all(window.__SHADER_INFO__)).flat());
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual((report.fixtureShaders ?? []).concat(report.gameShaders ?? []), [],
    'native shader diagnostics must be triaged, not hidden by Chromium warning limits');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (args.out) writeFileSync(String(args.out), JSON.stringify(report, null, 2));
  try { await browser?.close(); } finally { stopViteServer(server); }
}
