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

const args = parseArgs();
const options = ['port', 'w', 'h', 'dpr', 'frames', 'warmup', 'quality', 'out', 'executable'];
assert(Object.keys(args).every(key => options.includes(key)), `Supported options: ${options.join(', ')}`);
const port = Number(args.port ?? 8080), width = Number(args.w ?? 1280), height = Number(args.h ?? 720);
const dpr = Number(args.dpr ?? 1), frames = Number(args.frames ?? 1800), warmup = Number(args.warmup ?? 120);
const quality = String(args.quality ?? 'high');
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
const server = await ensureViteServer({ port });
assert(server, 'profile requires its own server; choose an unused --port to bind results to this checkout');
let browser;
try {
  browser = await launchChromium({ headless: true, executablePath: args.executable ?? full ?? undefined,
    args: ['--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const start = performance.now();
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=${quality}`, { waitUntil: 'domcontentloaded' });
  await waitForGame(page);
  const bootMs = performance.now() - start;
  await page.addScriptTag({ content: `window.__PROFILE__ = { combatLane: ${combatLane.toString()},
    create: ${createCombatProfile.toString()} };` });
  const result = await page.evaluate(async ({ frames, warmup }) => {
    const engine = window.__ENGINE__, r = engine.ctx.get('render'), renderer = r.renderer;
    const api = window.__PROFILE__, fixture = api.create(engine, api.combatLane);
    const samples = []; // waitForGame already installed __NATIVE_BUILDS__.
    const render = r.render;
    let renderMs = 0, last = null;
    r.render = function (...args) {
      const start = performance.now();
      try { return render.apply(this, args); }
      finally { renderMs = performance.now() - start; }
    };
    const deadline = performance.now() + 180000;
    const tick = () => new Promise((resolve, reject) => {
      const frame = requestAnimationFrame(now => { clearTimeout(timer); resolve(now); });
      const timer = setTimeout(() => {
        cancelAnimationFrame(frame);
        reject(new Error('combat profile exceeded 180s deadline'));
      }, Math.max(0, deadline - performance.now()));
    });
    try {
      // Bound both the active loop and a tab that stops delivering rAF entirely.
      for (let i = -warmup; i <= frames; i++) {
        const now = await tick();
        if (last) last.dt = now - last.at;
        if (i === frames) break; // collect the last measured frame's full interval
        fixture.before(i);
        const before = window.__NATIVE_BUILDS__, calls = renderer.info.render.calls, draws = renderer.info.render.drawCalls;
        renderMs = 0;
        const start = performance.now();
        engine.step();
        const cpuMs = performance.now() - start;
        fixture.after();
        if (i >= 0) {
          last = { i, at: now, dt: null, cpuMs, renderMs, gameMs: cpuMs - renderMs,
            nodeBuilders: window.__NATIVE_BUILDS__ - before, calls: renderer.info.render.calls - calls,
            draws: renderer.info.render.drawCalls - draws,
            geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
          samples.push(last);
        }
      }
      const a = renderer.backend.device.adapterInfo;
      return { samples, combat: fixture.report,
        hardware: { vendor: a.vendor, architecture: a.architecture, device: a.device,
          description: a.description, fallback: a.isFallbackAdapter, userAgent: navigator.userAgent },
        internal: { drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
          target: [r.screenSize.width, r.screenSize.height], pixelRatio: renderer.getPixelRatio(),
          quality: engine.config.quality, settings: engine.config.q },
        prewarm: window.__PREWARM__,
      };
    } finally { r.render = render; fixture.dispose(); }
  }, { frames, warmup });
  const distribution = values => {
    assert(values.length && values.every(Number.isFinite), 'missing timing samples');
    const sorted = values.sort((a, b) => a - b);
    const at = p => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(3);
    return { p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) };
  };
  const frameTimeMs = distribution(result.samples.map(s => s.dt));
  const hitches = result.samples.filter(s => s.dt > Math.max(2 * frameTimeMs.p50, frameTimeMs.p50 + 8));
  const summary = { frameTimeMs, cpuStepMs: distribution(result.samples.map(s => s.cpuMs)),
    cpuRenderSubmitMs: distribution(result.samples.map(s => s.renderMs)),
    cpuGameMs: distribution(result.samples.map(s => s.gameMs)),
    gpuTimeMs: null, gpuTimeSource: 'unavailable: no GPU timestamp queries',
    nodeBuilders: result.samples.reduce((sum, s) => sum + s.nodeBuilders, 0),
    hitchCount: hitches.length, worstHitches: hitches.sort((a, b) => b.dt - a.dt).slice(0, 15) };
  const report = { revision, dirty, browserExecutable: args.executable ?? full ?? 'Playwright default',
    frames, warmup, width, height, dpr, bootMs, ...result, summary, errors };
  // Persist even a failed-coverage run so the reason can be diagnosed, not silently filtered out.
  writeFileSync(String(args.out ?? '/tmp/combat-profile.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ revision, dirty, bootMs, hardware: result.hardware,
    combat: result.combat, summary, errors }, null, 2));
  assert.deepEqual(errors, []);
  validateCombatProfile(result.combat);
  await page.evaluate(() => window.__ENGINE__.dispose());
} finally {
  try { await browser?.close(); }
  finally { stopViteServer(server); }
}
