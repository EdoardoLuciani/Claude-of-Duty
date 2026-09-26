#!/usr/bin/env node
/**
 * Gameplay profiler. Serve this checkout with `npm run dev -- --port 8080`, then:
 *   node tools/profile.mjs --port=8080 --w=1512 --h=982 --dpr=2 --frames=900
 *
 * Frame time includes scheduling/GPU backpressure; CPU step and render submit
 * measure only synchronous JS. WebGL2 GPU time uses asynchronous disjoint timer
 * queries and is omitted when the extension is unavailable (never gl.finish()).
 * Keep the same shot, resolution, quality, browser and GPU for comparisons.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchChromium, parseArgs } from './lib/browser-harness.mjs';

const args = parseArgs();
const PORT = Number(args.port ?? 8080);
const W = Number(args.w ?? 1512);
const H = Number(args.h ?? 982);
const DPR = Number(args.dpr ?? 2);
const FRAMES = Number(args.frames ?? 900);
const WARMUP = Number(args.warmup ?? 60);
if (FRAMES < 1 || WARMUP >= FRAMES || WARMUP < 0) throw new Error('Require 0 <= warmup < frames');

// Playwright's headless-shell selects SwiftShader for WebGPU even on machines
// with a physical adapter. Use the full managed Chromium for *both* baselines
// when installed, so before/after differ by renderer rather than browser.
const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
const full = existsSync(cache) ? readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
  .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
  .map((name) => join(cache, name, 'chrome-linux64/chrome'))
  .find(existsSync) : null;
const executablePath = args.executable ?? full ?? undefined;
const browser = await launchChromium({
  headless: true, executablePath,
  args: ['--ignore-gpu-blocklist', '--mute-audio', '--use-angle=vulkan',
         '--enable-features=Vulkan', '--disable-frame-rate-limit',
         '--disable-gpu-vsync', '--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const t0 = Date.now();
  const EXTRA = args.query ? `?${args.query}` : '';
  await page.goto(`http://127.0.0.1:${PORT}/${EXTRA}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  const bootMs = Date.now() - t0;

  const bootMarks = await page.evaluate(() =>
    performance.getEntriesByType('measure').map((m) => ({ name: m.name, ms: +m.duration.toFixed(1) }))
      .sort((a, b) => b.ms - a.ms).slice(0, 25));
  const internal = await page.evaluate(() => {
    const r = window.__ENGINE__.ctx.peek('render');
    const renderer = r.renderer;
    const width = renderer.domElement.width;
    const height = renderer.domElement.height;
    return {
      pixelRatio: renderer.getPixelRatio(), drawingBuffer: [width, height],
      internalTarget: [r.screenSize.width, r.screenSize.height],
      megapixels: +((width * height) / 1e6).toFixed(2),
      quality: window.__ENGINE__.config.quality,
      renderScale: window.__ENGINE__.config.q.renderScale,
    };
  });
  const hardware = await page.evaluate(async () => {
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
    const info = adapter?.info;
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      webgpu: info ? { vendor: info.vendor, architecture: info.architecture,
        device: info.device, description: info.description } : null,
      webgl: gl ? gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) : null,
    };
  });

  const { samples, gpuSupport } = await page.evaluate(async (frames) => {
    const e = window.__ENGINE__;
    const r = e.ctx.peek('render');
    const renderer = r.renderer;
    const gl = renderer.isWebGLRenderer ? renderer.getContext() : null;
    const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2');
    const gpuSupport = ext ? 'EXT_disjoint_timer_query_webgl2' :
      renderer.isWebGLRenderer ? 'unavailable: EXT_disjoint_timer_query_webgl2' :
      'unavailable: per-frame timestamp readback not wired for this renderer';
    const samples = [];
    const pending = [];
    let i = 0, last = performance.now();
    const player = e.ctx.peek('player');
    let lastYaw = player?.yaw ?? 0;
    e.input.enabled = true; e.input.frozen = false;
    e.ctx.peek('player')?.setControlEnabled?.(true);
    e.ctx.peek('ai')?.debugStage?.('firefight');

    function poll() {
      if (!ext) return;
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        for (const { query } of pending) gl.deleteQuery(query);
        pending.length = 0;
        return;
      }
      for (let j = 0; j < pending.length;) {
        const { query, sample } = pending[j];
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) { j++; continue; }
        sample.gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query);
        pending.splice(j, 1);
      }
    }

    // Instrument the actual engine step rather than a second rAF callback: a
    // second callback's ordering relative to the engine is not guaranteed.
    const step = e.step;
    const render = r.render;
    r.render = function (...callArgs) {
      let query = null;
      if (ext && pending.length < 12) {
        query = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      }
      const start = performance.now();
      try { return render.apply(this, callArgs); }
      finally {
        samples[samples.length - 1].renderCpuMs = performance.now() - start;
        if (query) {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          pending.push({ query, sample: samples[samples.length - 1] });
        }
      }
    };
    await new Promise((done) => {
      e.step = function (now) {
        // The interval ending now contains the preceding step's CPU/GPU work.
        // Assign it to that step so hitch deltas and timings share a frame.
        if (i) samples[i - 1].dt = now - last;
        last = now;
        if (i >= frames) {
          e.step = step;
          r.render = render;
          done();
          return step.call(this, now);
        }
        const start = performance.now();
        // Input.beginFrame consumes raw mouse deltas; direct camera rotation
        // is overwritten by the player rig during update().
        e.input._rawLook.x -= 0.006 / e.config.sensitivity;
        e.input.down.add('KeyW');
        if (i % 90 < 30) e.input.down.add('Mouse0');
        else e.input.down.delete('Mouse0');
        const sample = { i, dt: null, gpuMs: null, renderCpuMs: null };
        samples.push(sample);
        try { return step.call(this, now); }
        finally {
          sample.stepCpuMs = performance.now() - start;
          sample.gameCpuMs = sample.stepCpuMs - (sample.renderCpuMs ?? 0);
          const yaw = player?.yaw ?? lastYaw;
          const change = yaw - lastYaw;
          sample.yawDelta = Math.atan2(Math.sin(change), Math.cos(change));
          lastYaw = yaw;
          sample.progs = renderer.info.programs?.length ?? 0;
          sample.calls = renderer.info.render.calls;
          sample.geos = renderer.info.memory.geometries;
          sample.texs = renderer.info.memory.textures;
          sample.heap = performance.memory ? performance.memory.usedJSHeapSize >> 20 : 0;
          poll();
          i++;
        }
      };
    });
    e.step = step;
    r.render = render;
    // Drain already-submitted timer queries, never stall the GPU for a result.
    for (let n = 0; n < 40 && pending.length; n++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      poll();
    }
    for (const { query } of pending) gl.deleteQuery(query);
    e.input.down.delete('KeyW');
    e.input.down.delete('Mouse0');
    return { samples, gpuSupport };
  }, FRAMES);

  const warm = samples.slice(WARMUP);
  const distribution = (values) => {
    const sorted = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const at = (p) => sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(3) : null;
    return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
  };
  const frame = distribution(warm.map((s) => s.dt));
  const hitches = warm.filter((s) => s.dt > Math.max(2 * frame.p50, frame.p50 + 8))
    .map((s) => {
      const prev = samples[s.i - 1];
      return { frame: s.i, ms: +s.dt.toFixed(1),
        progDelta: prev ? s.progs - prev.progs : 0,
        geoDelta: prev ? s.geos - prev.geos : 0,
        texDelta: prev ? s.texs - prev.texs : 0 };
    });
  const first = warm[0], last = warm[warm.length - 1];
  const turningFrames = warm.filter((s) => Math.abs(s.yawDelta) > 0.001).length;
  if (turningFrames < warm.length / 2) {
    throw new Error(`Scripted camera turn failed: ${turningFrames}/${warm.length} frames moved`);
  }
  console.log(JSON.stringify({
    cameraMotion: { turningFrames,
      yawTravelRad: +warm.reduce((sum, s) => sum + Math.abs(s.yawDelta), 0).toFixed(3) },
    bootMs, bootMarks, browserExecutable: executablePath ?? 'Playwright default',
    hardware, internal, frames: warm.length, warmup: WARMUP,
    frameTimeMs: frame,
    cpuStepMs: distribution(warm.map((s) => s.stepCpuMs)),
    cpuGameMs: distribution(warm.map((s) => s.gameCpuMs)),
    cpuRenderSubmitMs: distribution(warm.map((s) => s.renderCpuMs)),
    gpuRenderMs: { source: gpuSupport, ...distribution(warm.map((s) => s.gpuMs)) },
    fps: { p50: +(1000 / frame.p50).toFixed(0),
      p95: +(1000 / frame.p95).toFixed(0), p99: +(1000 / frame.p99).toFixed(0) },
    hitchCount: hitches.length,
    hitchPctOfFrames: +((hitches.length / warm.length) * 100).toFixed(2),
    worstHitches: hitches.sort((a, b) => b.ms - a.ms).slice(0, 15),
    programs: { start: first.progs, end: last.progs, compiledDuringPlay: last.progs - first.progs },
    resources: { geosStart: first.geos, geosEnd: last.geos, texStart: first.texs, texEnd: last.texs },
    heapMb: { start: first.heap, end: last.heap, growth: last.heap - first.heap },
    drawCalls: { min: Math.min(...warm.map((s) => s.calls)), max: Math.max(...warm.map((s) => s.calls)) },
    errors: errs.slice(0, 6),
  }, null, 2));
} finally {
  await browser.close();
}
