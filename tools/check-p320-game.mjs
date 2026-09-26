#!/usr/bin/env node
// Real GLB / GPU / gameplay review at the agreed native 1440p high preset.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5198);
const frames = Number(args.frames ?? 120);
assert(frames >= 30, 'use --frames=120 (at least 30 frames per run)');
const out = resolve(args.out ?? 'assets/weapons/p320-compact/gameplay');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--enable-webgl-draft-extensions'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const pump = n => page.evaluate(n => window.__PUMP__(n), n);
const shot = async name => { await page.evaluate(() => window.__PRESENT__(2)); await page.screenshot({ path: `${out}/${name}.png` }); };
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await page.evaluate(() => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx, w = ctx.get('weapons');
    window.p320Review = { ctx, w, shots: 0, shells: 0 };
    ctx.events.on('weapon:fire', () => window.p320Review.shots++);
    ctx.events.on('weapon:shell', () => window.p320Review.shells++);
    w.setWeaponImmediate('pistol'); w.debugMode = 'idle';
  });
  await pump(90); await shot('hip');
  if (args['capture-only']) { console.log({out,errors}); }
  else {
    assert.equal(await page.evaluate(() => window.p320Review.w.current.label), 'P320 Compact');
    await page.evaluate(() => { window.p320Review.w.debugMode = 'ads'; });
    await pump(50); await shot('ads');
    assert(await page.evaluate(() => { const vm = window.p320Review.w.viewmodel; return !vm.reticle.visible && !vm.scopeOverlay.visible; }));
    await page.evaluate(() => { window.p320Review.w.debugMode = 'idle'; }); await pump(35);
    assert(await page.evaluate(() => { const w = window.p320Review.w; w.state.mag = 8; return w.reload(); }));
    await pump(38); await shot('reload-tactical'); await pump(115);
    assert.equal(await page.evaluate(() => window.p320Review.w.state.mag), 15);
    assert(await page.evaluate(() => { const w = window.p320Review.w; w.state.mag = 0; w.state.chambered = false; return w.reload(); }));
    await pump(123); await shot('reload-empty'); await pump(45);
    assert(await page.evaluate(() => { const w = window.p320Review.w; return w.state.mag === 14 && w.state.chambered; }));
    assert(await page.evaluate(() => window.p320Review.w.inspect()));
    await pump(51); await shot('inspect-left'); await pump(65); await shot('inspect-right');
    assert(await page.evaluate(() => window.p320Review.w.tryFire()), 'fire cancels inspect');
    await pump(2); await shot('fire'); await pump(20);
    for (let i = 0; i < 6; i++) { assert(await page.evaluate(() => window.p320Review.w.tryFire())); await pump(9); }
    assert.equal(await page.evaluate(() => window.p320Review.shots), 7);
    assert.equal(await page.evaluate(() => window.p320Review.shells), 7);
    assert(await page.evaluate(() => { const w = window.p320Review.w; w.state.mag = 0; w.state.chambered = true; return w.tryFire(); }));
    await pump(25); await shot('lockback');
    assert(await page.evaluate(() => window.p320Review.w.viewmodel.active.animation.slide.position.z > .025));
    await page.evaluate(() => { const w = window.p320Review.w; w.state.mag = 15; w.state.chambered = true; w.viewmodel.stopClip(); });
    await pump(30);
    // Utility/switch paths must return the authored grip without changing shared assets.
    assert(await page.evaluate(() => window.p320Review.w.beginHeal()));
    await pump(20); await page.evaluate(() => window.p320Review.w.setHealProgress(.5)); await pump(20);
    await page.evaluate(() => window.p320Review.w.endHeal()); await pump(60);
    for (const utility of ['grenade', 'radio']) {
      await page.evaluate(utility => {
        const w = window.p320Review.w, input = { actionPressed: action => action === utility };
        if (utility === 'grenade') w._updateGrenade(0, input, true); else w._updateRadio(input, true);
      }, utility);
      await pump(40);
      await page.evaluate(utility => { const w = window.p320Review.w; if (utility === 'grenade') w._stowGrenade(); else w._stowRadio(); }, utility);
      await pump(60);
      assert(await page.evaluate(() => {
        const vm = window.p320Review.w.viewmodel;
        return vm.armR.thumb.root.quaternion.angleTo(vm.active.animation.hands.right.thumb[0].quaternion) < 1e-6;
      }), `${utility}: authored fingers restored`);
    }
    assert(await page.evaluate(() => window.p320Review.w.setWeapon('rifle'))); await pump(80);
    assert(await page.evaluate(() => window.p320Review.w.setWeapon('pistol'))); await pump(80);
    assert.equal(await page.evaluate(() => window.p320Review.w.viewmodel.clipName), null);
    const audio = await page.evaluate(async () => {
      const { NoiseBank } = await import('/src/audio/dsp.js');
      const { reloadPhase } = await import('/src/audio/foley.js');
      const { Rng } = await import('/src/core/rng.js');
      const results = {};
      for (const [label, phase, options] of [['retained', 'magout', { retained: true }], ['dropped', 'magout', {}], ['slide', 'slide', {}], ['settle', 'end', { settleOnly: true }]]) {
        const ac = new OfflineAudioContext(1, 48000, 48000), rng = new Rng(320);
        const voice = reloadPhase(ac, new NoiseBank(ac, rng.fork(), 1), rng, phase, options);
        voice.node.connect(ac.destination);
        const samples = (await ac.startRendering()).getChannelData(0);
        let energy = 0, peak = 0;
        for (const sample of samples) { energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
        results[label] = { energy, peak };
      }
      return results;
    });
    for (const [name, sound] of Object.entries(audio)) assert(Number.isFinite(sound.energy) && sound.energy > 0 && sound.peak < 1, `${name}: finite unclipped audio`);
    assert(audio.dropped.energy > audio.retained.energy, 'retained magazine omits ground impact');
    const report = args['checks-only'] ? { checksOnly: true } : await page.evaluate(async frames => {
      const { ctx, w } = window.p320Review;
      const { buildPistol } = await import('/src/weapons/models/pistol.js');
      const legacy = buildPistol(); legacy.id = 'pistol-baseline';
      w.viewmodel.addWeapon(legacy, { ...w.current, id: legacy.id });
      w.states.set(legacy.id, { ...w.state, def: { ...w.current, id: legacy.id } });
      const render = ctx.get('render'), renderer = render.renderer, gl = renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const result = { environment: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
        preset: ctx.config.quality, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) },
        method: 'Static identical scene, 90 warmup frames; three runs. GPU timer covers the viewmodel forward pass including unchanged shared arms. Lockstep wall samples include browser scheduling and are not combat FPS.', weapons: {} };
      const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      result.environment.gpuTimerAvailable = !!timer;
      result.framesPerRun = frames;
      const originalRender = renderer.render;
      let measured = false, queries = [];
      renderer.render = function (scene, camera) {
        if (!measured || !timer || scene !== ctx.viewScene) return originalRender.call(this, scene, camera);
        const query = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        originalRender.call(this, scene, camera);
        gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query);
      };
      for (const id of ['pistol-baseline', 'mcx', 'pistol']) {
        w.setWeaponImmediate(id); w.debugMode = 'idle'; await window.__PUMP__(90);
        const entry = w.viewmodel.active, textures = new Set();
        let triangles = 0, primitives = 0;
        entry.group.traverseVisible(o => {
          if (!o.isMesh) return;
          primitives++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
          }
        });
        let textureBytes = 0;
        const sources = new Set();
        for (const t of textures) if (!sources.has(t.source)) {
          sources.add(t.source); const image = t.source.data;
          textureBytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * 4 / 3;
        }
        const runs = [];
        for (let run = 0; run < 3; run++) {
          const samples = [], programs = renderer.info.programs.length;
          queries = []; measured = true;
          for (let i = 0; i < frames; i++) {
            const start = performance.now(); await window.__PUMP__(1); samples.push(performance.now() - start);
          }
          measured = false;
          gl.finish();
          // Timer availability becomes visible after yielding to the browser.
          await new Promise(resolve => setTimeout(resolve, 30));
          const gpu = [];
          const disjoint = timer && gl.getParameter(timer.GPU_DISJOINT_EXT);
          for (const query of queries) {
            if (!disjoint && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(query);
          }
          gpu.sort((a, b) => a - b);
          samples.sort((a, b) => a - b);
          const q = p => Number(samples[Math.min(samples.length - 1, Math.floor(samples.length * p))].toFixed(2));
          runs.push({ p50ms: q(.5), p95ms: q(.95), p99ms: q(.99), maxMs: q(1),
            viewGpuP50ms: gpu.length ? Number(gpu[Math.floor(gpu.length * .5)].toFixed(3)) : null,
            viewGpuP95ms: gpu.length ? Number(gpu[Math.floor(gpu.length * .95)].toFixed(3)) : null,
            gpuSamples: gpu.length, gpuIssuedQueries: queries.length, shaderCompiles: renderer.info.programs.length - programs });
        }
        result.weapons[id] = { visibleWeaponTriangles: triangles, visibleWeaponPrimitives: primitives, textureMiB: Number((textureBytes / 1048576).toFixed(2)), runs };
      }
      renderer.render = originalRender;
      w.setWeaponImmediate('pistol');
      return result;
    }, frames);
    report.audio = audio;
    report.errors = errors;
    writeFileSync(`${out}/${args['checks-only'] ? 'checks' : 'report'}.json`, JSON.stringify(report, null, 2) + '\n');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(report, null, 2));
  }
} finally { await browser.close(); stopViteServer(server); }
