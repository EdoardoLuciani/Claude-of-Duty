#!/usr/bin/env node
/** Sustained living-combat baseline. See docs/profiling.md for methodology. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT, ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
import { waitForGame } from './lib/native-render.mjs';
import { combatLane } from './lib/combat-fixture.js';
import { createCombatProfile, validateCombatProfile } from './lib/profile-combat.js';
import { measureWorkerLatency } from './lib/worker-latency.js';

const args = parseArgs();
const out = String(args.out ?? '/tmp/combat-profile.json');
// Invalidate an old result even if validation or boot never reaches the loop.
writeFileSync(out, JSON.stringify({ failure: 'profile incomplete', summary: null }));
const options = ['port', 'w', 'h', 'dpr', 'frames', 'warmup', 'quality', 'out', 'executable', 'detail', 'cpu-profile', 'gpu', 'realtime', 'paced', 'worker-profile', 'worker-latency', 'agents', 'production'];
assert(Object.keys(args).every(key => options.includes(key)), `Supported options: ${options.join(', ')}`);
const port = Number(args.port ?? 8080), width = Number(args.w ?? 1280), height = Number(args.h ?? 720);
const dpr = Number(args.dpr ?? 1), frames = Number(args.frames ?? 1800), warmup = Number(args.warmup ?? 120);
const quality = String(args.quality ?? 'high'), agents = Number(args.agents ?? 5);
assert([5, 12].includes(agents), 'agents must be 5 or 12');
assert(!args['worker-latency'] || ['trace', 'echo'].includes(args['worker-latency']), 'worker-latency must be trace or echo');
assert(Number.isInteger(port) && port > 0 && port <= 65535, 'invalid port');
assert(Number.isInteger(frames) && frames >= 900 && frames <= 3600 && frames % 900 === 0,
  'frames must be 900, 1800, 2700 or 3600 (complete action cycles)');
assert(Number.isInteger(warmup) && warmup >= 0 && warmup <= 600, 'warmup must be 0..600 frames');
assert([width, height].every(n => Number.isInteger(n) && n > 0) && Number.isFinite(dpr) && dpr > 0, 'invalid resolution');
assert(['low', 'medium', 'high', 'ultra'].includes(quality), 'invalid quality');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: REPO_ROOT }).trim();
const dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: REPO_ROOT }).trim();
// Use full Chromium rather than headless-shell, which can select SwiftShader.
const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
const full = existsSync(cache) ? readdirSync(cache).filter(name => /^chromium-\d+$/.test(name))
  .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
  .map(name => join(cache, name, 'chrome-linux64/chrome')).find(existsSync) : null;
let server, browser, report;
try {
  server = await ensureViteServer({ port, preview: !!args.production });
  assert(server, 'profile requires its own server; choose an unused --port to bind results to this checkout');
  browser = await launchChromium({ headless: true, executablePath: args.executable ?? full ?? undefined,
    args: ['--ignore-gpu-blocklist', '--mute-audio', ...(args.paced ? [] : ['--disable-frame-rate-limit', '--disable-gpu-vsync'])] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const start = performance.now();
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=${quality}${args['worker-profile'] ? '&aiWorkerProfile=1' : ''}`, { waitUntil: 'domcontentloaded' });
  await waitForGame(page);
  const bootMs = performance.now() - start;
  await page.addScriptTag({ content: `window.__PROFILE__ = { combatLane: ${combatLane.toString()},
    create: ${createCombatProfile.toString()}, latency: ${measureWorkerLatency.toString()} };` });
  const cdp = args['cpu-profile'] ? await page.context().newCDPSession(page) : null;
  let clock = null;
  if (cdp) {
    await cdp.send('Performance.enable');
    clock = (await cdp.send('Performance.getMetrics')).metrics;
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  const result = await page.evaluate(async ({ frames, warmup, detail, gpu, realtime, agents, latencyMode }) => {
    const engine = window.__ENGINE__, r = engine.ctx.get('render'), renderer = r.renderer;
    const api = window.__PROFILE__, captureStep = engine.step;
    let fixture = null, measuredElapsed = null, latency = null, workerLatency = null;
    const samples = []; // waitForGame already installed __NATIVE_BUILDS__.
    const stages = [], restores = []; let sampleIndex = -1;
    const observe = (owner, id, phase, countOnly = false) => {
      const original = owner?.[phase]; if (typeof original !== 'function') return;
      const owned = Object.hasOwn(owner, phase);
      const ms = countOnly ? null : new Float64Array(frames), calls = new Uint16Array(frames);
      stages.push({ id, phase, countOnly, ms, calls });
      const observed = function () {
        const start = countOnly ? 0 : performance.now();
        try { return original.apply(this, arguments); }
        finally { if (sampleIndex >= 0) { if (!countOnly) ms[sampleIndex] += performance.now() - start; calls[sampleIndex]++; } }
      };
      owner[phase] = observed; restores.push(() => {
        if (owner[phase] === observed) { if (owned) owner[phase] = original; else delete owner[phase]; }
      });
    };
    const gpuSamples = [], tracked = renderer.backend.trackTimestamp;
    let gpuPending = null, gpuFailure = null, gpuClosed = false;
    const weapons = engine.ctx.get('weapons');
    const render = r.render, renderOwned = Object.hasOwn(r, 'render');
    let renderMs = 0, last = null, failure = null;
    const observedRender = function (...args) {
      const start = performance.now();
      try { return render.apply(this, args); }
      finally { renderMs = performance.now() - start; }
    };
    const deadline = performance.now() + 180000;
    const tick = () => new Promise((resolve, reject) => {
      const frame = requestAnimationFrame(now => { clearTimeout(timer); resolve({ now, callbackAt: performance.now() }); });
      const timer = setTimeout(() => {
        cancelAnimationFrame(frame);
        reject(new Error('combat profile exceeded 180s deadline'));
      }, Math.max(0, deadline - performance.now()));
    });
    try {
      if (latencyMode) latency = await api.latency(engine, { echo: latencyMode === 'echo' });
      fixture = api.create(engine, api.combatLane, { realtime, agents });
      if (gpu && !renderer.backend.device.features.has('timestamp-query')) throw new Error('native GPU timestamp queries unavailable');
      if (realtime) { engine.step = Object.getPrototypeOf(engine).step; engine._last = performance.now(); }
      if (detail) {
        for (const sys of engine.registry.ordered) for (const phase of ['fixedUpdate', 'update', 'lateUpdate'])
          observe(sys, sys.constructor.id, phase);
        const ai = engine.ctx.get('ai');
        for (const phase of ['canAttach', 'project', 'lineOfWalk', 'findPath']) observe(ai.grid, 'nav', phase);
        for (const phase of ['pick', 'peekOffset']) observe(ai.cover, 'cover', phase);
        observe(ai.grid._probe, 'attachment-controller', 'move', true);
        for (const actor of ai.agents) observe(actor, `actor-${actor.id}`, '_pickObservationPoints');
      }
      if (gpu) renderer.backend.trackTimestamp = true;
      r.render = observedRender;
      // Bound both the active loop and a tab that stops delivering rAF entirely.
      for (let i = -warmup; i <= frames; i++) {
        const { now, callbackAt } = await tick();
        if (last) { last.dt = now - last.at; last.callbackIntervalMs = callbackAt - last.callbackAt; }
        sampleIndex = i;
        if (i === frames) { sampleIndex = -1; break; } // collect the last measured frame's full interval
        if (i === 0) measuredElapsed = engine.time.elapsed;
        const actionFrame = i < 0 ? -1 : (engine.time.elapsed - measuredElapsed) * 60;
        fixture.before(i, realtime ? actionFrame : i);
        // Snapshot scalars: engine.step() mutates these counters through Three's
        // renderer. The deltas below are not same-value operands (DeepScan).
        const before = window.__NATIVE_BUILDS__, calls = renderer.info.render.calls, draws = renderer.info.render.drawCalls;
        renderMs = 0;
        const activity = detail ? fixture.activity() : null;
        latency?.before(i);
        const start = performance.now();
        engine.step(now);
        const cpuMs = performance.now() - start;
        latency?.after();
        const stepActivity = detail ? fixture.activity() : null;
        // Separate diagnostic mode. Never await GPU readback inside the pacing loop.
        // Pinned Three returns pass-duration totals for the last queried native frame.
        if (gpu && !gpuPending) {
          const frame = renderer.info.frame, measured = i;
          gpuPending = Promise.all(['render', 'compute'].map(type => renderer.resolveTimestampsAsync(type)))
            .then(([renderMs, computeMs]) => {
              if (measured >= 0 && !gpuClosed) gpuSamples.push({ i: measured, frame,
                renderFrame: renderer.backend.getTimestampFrames('render').at(-1) ?? null,
                computeFrame: renderer.backend.getTimestampFrames('compute').at(-1) ?? null,
                renderMs: renderMs ?? null, computeMs: computeMs ?? null });
            })
            .catch(error => { if (!gpuClosed) gpuFailure = String(error?.message ?? error); })
            .finally(() => { gpuPending = null; });
        }
        if (i >= 0) {
          last = { i, at: now, dt: null, callbackAt, callbackIntervalMs: null, startAt: start,
            callbackLagMs: callbackAt - now, cpuMs, renderMs, gameMs: cpuMs - renderMs,
            ...(detail ? { playerShots: stepActivity.playerShots - activity.playerShots, aiShots: stepActivity.aiShots - activity.aiShots,
              impacts: stepActivity.impacts - activity.impacts, weapon: weapons.activeId, reloading: weapons.reloading } : {}),
            nodeBuilders: window.__NATIVE_BUILDS__ - before, calls: renderer.info.render.calls - calls,
            draws: renderer.info.render.drawCalls - draws,
            geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
          samples.push(last);
        }
        fixture.after();
      }
      if (latency) workerLatency = await latency.finish();
    } catch (error) {
      failure = String(error?.message ?? error);
    } finally {
      let drainTimer;
      try {
        if (gpuPending) await Promise.race([gpuPending, new Promise((resolve, reject) => {
          drainTimer = setTimeout(() => reject(new Error('GPU timestamp drain exceeded deadline')),
            Math.max(0, Math.min(5000, deadline - performance.now())));
        })]);
      } catch (error) { gpuFailure ??= String(error?.message ?? error); }
      finally {
        clearTimeout(drainTimer); gpuClosed = true; renderer.backend.trackTimestamp = tracked; sampleIndex = -1;
        if (r.render === observedRender) { if (renderOwned) r.render = render; else delete r.render; }
        workerLatency ??= latency?.snapshot() ?? null; latency?.dispose();
        for (const restore of restores) restore(); engine.step = captureStep; fixture?.dispose();
      }
    }
    const simulationSeconds = measuredElapsed === null ? null : engine.time.elapsed - measuredElapsed;
    if (realtime && fixture) fixture.report.simulationSeconds = simulationSeconds;
    const a = renderer.backend.device.adapterInfo;
    return { samples, combat: fixture?.report ?? null, failure: failure ?? gpuFailure, gpuFailure, workerLatency,
      gpuSamples: gpu ? gpuSamples : null,
      worker: (() => { const ai = engine.ctx.get('ai'), w = ai.grid?.worker;
        return w ? { stats: { ...w.stats }, samples: w.samples.slice(), costs: w.costs,
          profiling: w.profile, incomplete: w.jobs.size,
          pendingDecisions: Array.from(w.scopes.values()).filter(s => s.waiting).map(s => {
            const a = ai.agents.find(a => a.id === s.actor);
            return { actor: s.actor, kind: s.kind, ageMs: performance.now() - s.started, frames: w.frame - s.frame, lastAttemptFrame: s.lastFrame,
              state: a?.state ?? null, combatAction: a?.combatAction ?? null, wantFire: a?.wantFire ?? null,
              pathPending: a?.pathPending ?? null, repositionPlanning: a ? !!a._positionPlan : null, searchPending: a?._searchPending ?? null };
          }),
          pendingJobs: Array.from(w.jobs.values(), j => ({ actor: j.scope.actor, ageMs: performance.now() - j.sent })), timing: 'query round trips include dispatch, queueing and main-thread delivery; nested costs are inclusive' } : null; })(),
      stages: detail ? stages.map(s => ({ ...s, ms: s.ms ? Array.from(s.ms) : null, calls: Array.from(s.calls) })) : null,
      timeOrigin: performance.timeOrigin, simulationSeconds,
      hardware: { vendor: a.vendor, architecture: a.architecture, device: a.device,
        description: a.description, fallback: a.isFallbackAdapter, userAgent: navigator.userAgent },
      internal: { drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
        target: [r.screenSize.width, r.screenSize.height], pixelRatio: renderer.getPixelRatio(),
        quality: engine.config.quality, settings: engine.config.q },
      prewarm: window.__PREWARM__,
    };
  }, { frames, warmup, agents, detail: !!args.detail, gpu: !!args.gpu, realtime: !!args.realtime, latencyMode: args['worker-latency'] ?? null });
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(String(args['cpu-profile']), JSON.stringify({ profile, clock, timeOrigin: result.timeOrigin }));
    await cdp.detach();
  }
  const distribution = values => {
    assert(values.length && values.every(Number.isFinite), 'missing timing samples');
    const sorted = values.sort((a, b) => a - b);
    const at = p => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(3);
    return { p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) };
  };
  let failure = result.failure, summary = null;
  if (failure === null) {
    try {
      assert.deepEqual(errors, []);
      validateCombatProfile(result.combat);
      const frameTimeMs = distribution(result.samples.map(s => s.dt));
      const callbackIntervalMs = distribution(result.samples.map(s => s.callbackIntervalMs));
      const hitches = result.samples.filter(s => s.dt > Math.max(2 * frameTimeMs.p50, frameTimeMs.p50 + 8));
      const callbackHitches = result.samples.filter(s => s.callbackIntervalMs > Math.max(2 * callbackIntervalMs.p50, callbackIntervalMs.p50 + 8));
      if (args.gpu) {
        assert(result.gpuSamples.length, 'missing GPU timestamp samples');
        for (const s of result.gpuSamples) {
          assert(s.renderFrame === s.frame && Number.isFinite(s.renderMs), 'GPU render timestamp frame mismatch');
          if (s.computeMs !== null) assert(s.computeFrame === s.frame, 'GPU compute timestamp frame mismatch');
        }
      }
      const passSums = result.gpuSamples?.filter(s => Number.isFinite(s.computeMs)).map(s => s.renderMs + s.computeMs);
      summary = { frameTimeMs, callbackIntervalMs,
        cpuStepMs: distribution(result.samples.map(s => s.cpuMs)),
        cpuRenderSubmitMs: distribution(result.samples.map(s => s.renderMs)),
        cpuGameMs: distribution(result.samples.map(s => s.gameMs)),
        gpuTimeMs: null, gpuTimeSource: 'unavailable: complete GPU frame/presentation timing not measured',
        gpuSampleCount: result.gpuSamples?.length ?? null,
        gpuPassTimeMs: passSums?.length ? distribution(passSums) : null,
        gpuPassTimeSource: args.gpu ? 'native timestamp render + compute pass sums; excludes copies, queue wait and presentation' : null,
        cpuBudgetMs: 1000 / 60, cpuBudgetMissCount: result.samples.filter(s => s.cpuMs > 1000 / 60).length,
        nodeBuilders: result.samples.reduce((sum, s) => sum + s.nodeBuilders, 0),
        hitchCount: hitches.length, worstHitches: hitches.sort((a, b) => b.dt - a.dt).slice(0, 15),
        callbackHitchCount: callbackHitches.length,
        worstCallbackHitches: callbackHitches.sort((a, b) => b.callbackIntervalMs - a.callbackIntervalMs).slice(0, 15) };
    } catch (error) { failure = String(error?.message ?? error); }
  }
  report = { revision, dirty, browserExecutable: args.executable ?? full ?? 'Playwright default',
    frames, warmup, width, height, dpr, build: args.production ? 'production' : 'development', detail: !!args.detail, realtime: !!args.realtime, paced: !!args.paced,
    gpuDiagnostic: !!args.gpu, cpuSampled: !!args['cpu-profile'], bootMs, ...result, failure, summary, errors };
  // Write failed/partial runs too; never leave a stale success or invent missing intervals.
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ revision, dirty, bootMs, hardware: result.hardware,
    combat: result.combat, failure, summary, errors }, null, 2));
  if (failure !== null) throw new Error(failure);
  await page.evaluate(() => window.__ENGINE__.dispose());
} catch (error) {
  report ??= { revision, dirty, summary: null };
  report.failure ??= String(error?.stack ?? error);
  writeFileSync(out, JSON.stringify(report, null, 2));
  throw error;
} finally {
  try { await browser?.close(); }
  finally { stopViteServer(server); }
}
