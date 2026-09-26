#!/usr/bin/env node
/**
 * SPIKE runner — boots Vite, drives tools/webgpu-spike/index.html in headless
 * Chromium with a real WebGPU adapter, and writes the report + montage.
 *
 *   node tools/webgpu-spike/run.mjs [--w=960] [--h=540] [--frames=200]
 *                                   [--forceWebGL] [--out=shots/spike]
 *
 * Notes on the launch configuration, both learned the hard way:
 *   - Playwright's default `headless: true` binary is `chromium_headless_shell`,
 *     which never exposes `navigator.gpu`. The full Chromium build must be used.
 *   - `about:blank` is not a secure context, so `navigator.gpu` is undefined
 *     there; a http://127.0.0.1 page is. Test WebGPU code over the dev server.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ensureViteServer, parseArgs, stopViteServer } from '../lib/browser-harness.mjs';

const args = parseArgs();
const PORT = Number(args.port ?? 5199);
const W = Number(args.w ?? 960);
const H = Number(args.h ?? 540);
const FRAMES = Number(args.frames ?? 200);
const OUT = resolve(args.out ?? 'shots/webgpu-spike');
const TIMEOUT = Number(args.timeout ?? 240000);

const FULL_CHROMIUM = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;

const server = await ensureViteServer({ port: PORT, root: process.cwd(), attempts: 240 });

const launch = {
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=vulkan',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--mute-audio',
    '--no-sandbox',
  ],
};
if (existsSync(FULL_CHROMIUM)) launch.executablePath = FULL_CHROMIUM;
else console.error('[spike] full Chromium not found; WebGPU is unlikely to be available');

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

let report = null;
try {
  const q = new URLSearchParams({ w: String(W), h: String(H), frames: String(FRAMES) });
  if (args.forceWebGL) q.set('forceWebGL', '1');
  if (args.mode) q.set(String(args.mode), '1');
  await page.goto(`http://127.0.0.1:${PORT}/tools/webgpu-spike/index.html?${q}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });
  await page.waitForFunction('window.__SPIKE_READY__ === true', null, { timeout: TIMEOUT });
  report = await page.evaluate('window.__SPIKE__');
  const montage = report?.montage;
  if (montage) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(`${OUT}.png`, Buffer.from(montage.split(',')[1], 'base64'));
  }
  const rest = { ...report };
  delete rest.montage;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(`${OUT}.json`, JSON.stringify(rest, null, 2));
  const noisy = logs.filter((l) => /error|warn|pageerror/i.test(l));
  if (noisy.length) {
    console.error('--- page console (errors/warnings) ---');
    console.error(noisy.slice(0, 60).join('\n'));
  }
  console.log(JSON.stringify(rest, null, 2));
} catch (e) {
  console.error('[spike] failed:', e && e.message);
  console.error(logs.slice(-40).join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  stopViteServer(server);
}

if (logs.some((l) => l.startsWith('[pageerror]'))) {
  console.error('\n--- page errors ---');
  console.error(logs.filter((l) => l.startsWith('[pageerror]')).join('\n'));
}
