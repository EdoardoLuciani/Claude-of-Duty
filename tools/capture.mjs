#!/usr/bin/env node
/**
 * Deterministic screenshot harness for the game.
 *
 * Boots vite (if not already up), opens the page in GPU-backed Chromium,
 * waits for `window.__READY__`, optionally runs a named "shot" defined in
 * src/dev/shots.js, then writes a PNG.
 *
 * Usage:
 *   node tools/capture.mjs --shot=hero --out=shots/hero.png
 *   node tools/capture.mjs --shot=hero --out=shots/hero.png --w=2560 --h=1440
 *   node tools/capture.mjs --reload --out=/tmp/webgpu-before-reload
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs();

const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const RELOAD = !!args.reload;
const SHOT = RELOAD ? 'weapon' : args.shot ?? 'default';
const OUT = resolve(args.out ?? (RELOAD ? 'shots/reload' : `shots/${SHOT}.png`));
const TIMEOUT = Number(args.timeout ?? 90000);
// Frames to render before capture: lets TAA converge, streaming settle, LOD pick.
const SETTLE = Number(args.settle ?? 90);

const server = await ensureViteServer({ port: PORT, attempts: 120 });

const browser = await launchChromium({
  headless: true,
  ...(args.executable ? { executablePath: String(args.executable) } : {}),
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--disable-frame-rate-limit',
    '--force-color-profile=srgb',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--mute-audio',
  ],
});

const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
});

const logs = [];
// Headless Chromium can display a black WebGPU swapchain even though the GPU
// produced a valid frame. Copy the final graph to an LDR target and place its
// readback under the HTML HUD only for the screenshot.
async function captureFrame(path) {
  await page.evaluate(async () => {
    const r = window.__ENGINE__.ctx.get('render');
    const { RenderTarget } = await import('/node_modules/.vite/deps/three_webgpu.js');
    const w = r.screenSize.width, h = r.screenSize.height;
    const rt = new RenderTarget(w, h);
    let pixels;
    try {
      r.renderer.setRenderTarget(rt);
      r._graph.render();
      pixels = await r.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
    } finally {
      r.renderer.setRenderTarget(null);
      rt.dispose();
    }
    const stride = (pixels.length - w * 4) / Math.max(1, h - 1);
    if (!Number.isInteger(stride) || stride < w * 4) throw new Error('Bad WebGPU readback stride');
    const packed = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) packed.set(pixels.subarray(y * stride, y * stride + w * 4), y * w * 4);
    const overlay = document.createElement('canvas');
    overlay.id = 'webgpu-capture-overlay';
    overlay.width = w; overlay.height = h;
    overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;pointer-events:none';
    overlay.getContext('2d').putImageData(new ImageData(packed, w, h), 0, 0);
    document.body.append(overlay);
  });
  try { await page.screenshot({ path, type: 'png' }); }
  finally { await page.evaluate(() => document.getElementById('webgpu-capture-overlay')?.remove()); }
}
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

let failed = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1&shot=${encodeURIComponent(SHOT)}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });

  // Engine sets window.__READY__ = true once assets are loaded and first frame drawn.
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });

  if (args.list) {
    const shots = await page.evaluate('Object.keys(window.__SHOTS__ ?? {})');
    console.log(JSON.stringify(shots, null, 2));
  } else {
    // Apply the shot (camera pose, time of day, weapon state, ...).
    const applied = await page.evaluate(
      ({ s, settle }) =>
        window.__APPLY_SHOT__ ? window.__APPLY_SHOT__(s, { grabFrame: settle }) : 'no-shot-api',
      { s: SHOT, settle: SETTLE }
    );
    logs.push(`[shot] ${JSON.stringify(applied)}`);

    if (RELOAD) {
      await page.evaluate((n) => window.__PUMP__(n), SETTLE);
      const started = await page.evaluate(() => {
        const e = window.__ENGINE__;
        const w = e.ctx.get('weapons');
        w.state.mag = 5;
        if (!w.reload()) throw new Error('Cannot start scripted rifle reload');
        // The shot freezes player control; rotate before each engine step so
        // the player rig does not overwrite the camera (and TAA sees motion).
        const step = e.step;
        e.step = function (...args) {
          this.camera.rotation.y += 0.002;
          return step.apply(this, args);
        };
        return { weapon: w.activeId, clip: w.viewmodel.clipName,
          duration: w.viewmodel.clip.duration, yaw: e.camera.rotation.y };
      });
      const frames = [0, 20, 45, 70, 95, 120, 135];
      const captures = [];
      let last = 0;
      for (const frame of frames) {
        if (frame > last) await page.evaluate((n) => window.__PUMP__(n), frame - last);
        await page.evaluate(() => window.__PRESENT__(2));
        const state = await page.evaluate(() => {
          const w = window.__ENGINE__.ctx.get('weapons');
          return { clip: w.viewmodel.clipName, clipTime: +w.viewmodel.clipT.toFixed(3),
            mag: w.state.mag, reloading: w.reloading,
            yaw: +window.__ENGINE__.camera.rotation.y.toFixed(4) };
        });
        const path = `${OUT}-${String(frame).padStart(3, '0')}.png`;
        mkdirSync(dirname(path), { recursive: true });
        await captureFrame(path);
        captures.push({ frame, path, ...state });
        last = frame;
      }
      console.log(JSON.stringify({ ok: true, reload: started, captures, w: W, h: H }, null, 2));
    } else {
      // Advance exactly SETTLE engine frames; present without advancing the
      // simulation so the screenshot lands on the same TAA/flash frame.
      await page.evaluate((n) => window.__PUMP__(n), SETTLE);
      await page.evaluate(() => window.__PRESENT__(2));

      mkdirSync(dirname(OUT), { recursive: true });
      await captureFrame(OUT);

      const info = await page.evaluate('window.__RENDER_INFO__ ?? null');
      console.log(JSON.stringify({ ok: true, out: OUT, shot: SHOT, w: W, h: H, info }, null, 2));
    }
  }
} catch (e) {
  failed = e;
} finally {
  const gpu = await page.evaluate(() =>
    window.__ENGINE__?.ctx.peek('render')?.renderer.backend.constructor.name ?? 'n/a'
  ).catch(() => 'n/a');
  if (failed || args.verbose) {
    console.error('GPU:', gpu);
    console.error(logs.slice(-60).join('\n'));
  }
  await browser.close();
  stopViteServer(server);
}

if (failed) {
  console.error(JSON.stringify({ ok: false, error: failed.message }));
  process.exit(1);
}
