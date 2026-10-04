#!/usr/bin/env node
// Scripted motion/transition evidence, not an unscripted-play or timing oracle.
// Persistent offscreen output: exactly one gameplay render per simulated frame.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5330), out = resolve(args.out ?? '/tmp/cod-render-motion');
const width = Number(args.width ?? 1280), height = Number(args.height ?? 720), frames = Number(args.frames ?? 180);
const every = Number(args.every ?? 1), quality = args.quality ?? 'high';
const phases = (args.phases ?? 'road,reload,optics,combat,live,transition,cycle,lighting').split(',');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--ignore-gpu-blocklist','--force-color-profile=srgb'] });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (args.negative === 'haze') await page.route('**/src/fx/haze.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'this.render(renderer, cam);'; assert.equal(body.split(marker).length, 2);
    await route.fulfill({ response, body: body.replace(marker, '// intentionally omit native haze warm draw') });
  });
  else if (args.negative === 'ai') await page.route('**/src/ai/index.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'out.graphWarm = await r._warmGraph();'; assert.equal(body.split(marker).length, 2);
    await route.fulfill({ response, body: body.replace(marker, 'out.graphWarm = { skipped: true };') });
  });
  else if (args.negative) await page.route('**/src/weapons/index.js', async route => {
    const controls = {
      magazine: ['for (const { group } of this._droppedMags)', 'for (const { group } of [])'],
      optics: ['groups.push(this.viewmodel.radio, this.viewmodel.reticle, this.viewmodel.scopeOverlay);', 'groups.push(this.viewmodel.radio, this.viewmodel.reticle);'],
    };
    assert(Object.hasOwn(controls, args.negative));
    const [before, after] = controls[args.negative], response = await route.fetch(), body = await response.text();
    assert.equal(body.split(before).length, 2);
    await route.fulfill({ response, body: body.replace(before, after) });
  });
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&q=${quality}`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 120000 });
  await page.evaluate(async () => {
    const { THREE: T } = await import('/tools/arm-material-fixture.js');
    const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer, a = renderer.backend.device.adapterInfo;
    if (a.vendor !== 'amd' || a.architecture !== 'rdna-4' || a.isFallbackAdapter) throw new Error('RX 9070 XT required');
    const target = new T.RenderTarget(r.screenSize.width, r.screenSize.height, { depthBuffer: false });
    const setTarget = renderer.setRenderTarget;
    renderer.setRenderTarget = function(rt, ...rest) { return setTarget.call(this, rt ?? target, ...rest); };
    window.__motion = { target, restore: () => { renderer.setRenderTarget = setTarget; setTarget.call(renderer, null); target.dispose(); }, builds: [],
      key: r.activeSun.id, shadow: r.activeSun.shadow.shadowNode, layers: r.activeSun.shadow.shadowNode.lights.map(l => l.id) };
    renderer.debug.onNodeBuilderCreated = (builder, owner) => window.__motion.builds.push({
      name: owner.material?.name ?? builder.material?.name, type: owner.material?.type ?? builder.material?.type,
      camera: owner.camera?.type, scene: owner.scene?.name, side: owner.material?.side,
      object: builder.object?.name, objectType: builder.object?.constructor.name,
      compute: builder.object?.isComputeNode === true, nodeType: builder.object?.type,
      parent: builder.object?.parent?.name, grandparent: builder.object?.parent?.parent?.name,
      materials: (Array.isArray(builder.object?.material) ? builder.object.material : [builder.object?.material]).filter(Boolean).map(m => ({ name: m.name, type: m.type })),
      attributes: Object.fromEntries(Object.entries(builder.object?.geometry?.attributes ?? {}).map(([name, a]) => [name, { size: a.itemSize, normalized: a.normalized, type: a.array.constructor.name }])),
      receiveShadow: builder.object?.receiveShadow, frame: e.time.frame,
    });
    window.__APPLY_SHOT__('hero'); await window.__PUMP__(180);
  });
  for (const phase of phases) {
    mkdirSync(`${out}/${phase}`, { recursive: true });
    await page.evaluate(async phase => {
      const e = window.__ENGINE__, ctx = e.ctx, w = ctx.get('weapons'), state = window.__motion;
      state.builds.length = 0;
      window.__APPLY_SHOT__(phase === 'combat' ? 'combat' : phase === 'interior' ? 'interior' : phase === 'lighting' ? 'hero' : 'ads');
      if (phase === 'optics') { w.debugPose('ads'); if (!w.setWeaponImmediate('mcx')) throw new Error('MCX selection failed'); }
      else if (phase !== 'combat') w.setWeaponImmediate('rifle');
      await window.__PUMP__(60);
      if (phase === 'reload') { w.debugPose('idle'); w.state.mag = 5; if (!w.reload()) throw new Error('reload did not start'); }
      state.position = e.camera.position.clone(); state.rotation = e.camera.rotation.clone();
      state.setupBuilds = state.builds.slice();
      state.builds.length = 0; state.startFrame = e.time.frame;
      state.skyHour = ctx.get('sky').hour;
      state.stats = [];
      if (phase === 'cycle') { ctx.get('sky').setTimeOfDay(18); ctx.get('sky').setTimeRate(4); }
      if (phase === 'live') {
        w.debugMode = null; w.viewmodel.debugFrozen = false;
        e.input.enabled = true; e.input.frozen = false; e.input.down.clear();
        ctx.get('player').setControlEnabled(true);
      }
    }, phase);
    for (let i = 0; i < frames; i++) {
      const result = await page.evaluate(async ({ phase, i, frames, capture }) => {
        const e = window.__ENGINE__, ctx = e.ctx, r = ctx.get('render'), state = window.__motion, w = ctx.get('weapons');
        const { width, height } = state.target;
        const t = i / Math.max(1, frames - 1), swing = Math.sin(t * Math.PI * 2);
        if (phase !== 'live') { e.camera.position.copy(state.position); e.camera.rotation.copy(state.rotation); }
        if (phase === 'live') {
          e.input.down.add('KeyW');
          if (t < .5) e.input.down.add('KeyD'); else e.input.down.delete('KeyD');
          if (t > .2 && t < .7) e.input.down.add('Mouse2'); else e.input.down.delete('Mouse2');
          if (t > .45 && t < .6) e.input.down.add('Mouse0'); else e.input.down.delete('Mouse0');
          e.input._rawLook.x -= .002 / e.config.sensitivity;
        } else if (phase === 'transition') {
          if (i === 0 || i === Math.floor(frames * 2 / 3)) window.__APPLY_SHOT__('hero');
          if (i === Math.floor(frames / 3)) window.__APPLY_SHOT__('interior');
          state.position.copy(e.camera.position); state.rotation.copy(e.camera.rotation);
        } else if (phase === 'cycle') {
          // Accelerated real clock/update path, including throttled environment
          // bakes; separate from the hard lighting/camera-cut stress cases.
        } else if (phase === 'lighting') {
          const sky = ctx.get('sky');
          if (i === 0) sky.setTimeOfDay(19.2);
          if (i === Math.floor(frames / 3)) sky.setTimeOfDay(1.5);
          if (i === Math.floor(frames * 2 / 3)) sky.setTimeOfDay(16.5);
          ctx.get('world').setStreetlightPower(t > .4 && t < .6 ? 0 : 1);
          ctx.get('player').setFlashlightEnabled(t > .45 && t < .75);
        } else {
          e.camera.position.x += swing * (phase === 'interior' ? .8 : 1.2);
          e.camera.rotation.y += swing * .2;
          e.camera.rotation.x += Math.sin(t * Math.PI * 4) * .035;
          if (phase === 'interior') e.camera.position.z += Math.sin(t * Math.PI) * 4;
        }
        await window.__PUMP__(1);
        if (e.error) throw new Error(JSON.stringify(e.error));
        if (ctx.get('player').dead) throw new Error('player died; motion/clock coverage stopped');
        if (r.activeSun.id !== state.key || r.activeSun.shadow.shadowNode !== state.shadow || r.activeSun.shadow.shadowNode.lights.some((l,j) => l.id !== state.layers[j])) throw new Error('sun/moon handoff replaced shadow identity');
        if (!Number.isFinite(r._exposure) || r._exposure <= 0 || r._exposure > 5) throw new Error('invalid exposure transition');
        state.stats.push({ frame: e.time.frame, exposure: r._exposure, builds: state.builds.length, hour: ctx.get('sky').hour,
          clip: w.viewmodel.clipName, clipTime: w.viewmodel.clipT, camera: e.camera.position.toArray(), key: r.activeSun.intensity });
        if (phase === 'optics' && w.activeId !== 'mcx') throw new Error('not testing MCX optics');
        if (r.viewRt.samples !== 0) throw new Error('view target gained MSAA');
        if (r.hdrRt.width !== width || r.hdrRt.height !== height || r.viewRt.width !== width || r.viewRt.height !== height) throw new Error('capture changed quality-tier target dimensions');
        if (!capture) return null;
        const data = await r.renderer.readRenderTargetPixelsAsync(state.target, 0, 0, width, height);
        const pixels = new Uint8ClampedArray(width * height * 4), stride = data.length / height;
        for (let y = 0; y < height; y++) pixels.set(data.subarray(y * stride, y * stride + width * 4), y * width * 4);
        if (!pixels.some((value, index) => index % 4 !== 3 && value > 0)) throw new Error('blank motion frame');
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { phase, i, frames, capture: i % every === 0 });
      if (result) writeFileSync(`${out}/${phase}/${String(i).padStart(4, '0')}.png`, Buffer.from(result, 'base64'));
    }
    const report = await page.evaluate(() => {
      window.__ENGINE__.ctx.get('sky').setTimeRate(0);
      return { setupBuilds: window.__motion.setupBuilds, builds: window.__motion.builds,
        stats: window.__motion.stats, startFrame: window.__motion.startFrame,
        drawing: [window.__motion.target.width, window.__motion.target.height] };
    });
    results.push({ phase, ...report });
    writeFileSync(`${out}/report.json`, JSON.stringify({ quality, width, height, frames, every, results, errors }, null, 2));
    assert.equal(report.stats.at(-1).frame - report.startFrame, frames);
    assert.deepEqual(report.setupBuilds, [], `${phase}: setup shader builders`);
    assert.deepEqual(report.builds, [], `${phase}: late shader builders`);
    if (phase === 'cycle') assert(Math.abs(report.stats.at(-1).hour - ((18 + 4 * frames / 60) % 24)) < 1e-6,
      'accelerated clock must traverse the intended hours, not stop on death');
    console.log(phase, 'builders', report.builds.length);
  }
  assert.deepEqual(errors, []);
  await page.evaluate(async () => { window.__motion.restore(); await window.__ENGINE__.dispose(); });
} finally { await browser.close(); await stopViteServer(server); }
