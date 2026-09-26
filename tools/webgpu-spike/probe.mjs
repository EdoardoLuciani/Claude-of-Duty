#!/usr/bin/env node
/**
 * Can this machine run WebGPU in a headless browser at all?
 *
 * Worth running before anything else, because two things make the answer "no"
 * for reasons that have nothing to do with the GPU:
 *
 *   1. Playwright's default `headless: true` binary is `chromium_headless_shell`,
 *      which never exposes `navigator.gpu`. The full Chromium build does.
 *   2. `about:blank` is not a secure context for WebGPU purposes, so
 *      `navigator.gpu` is undefined there even in the full build. Localhost is a
 *      secure context, so probe over the Vite dev server the way run.mjs does.
 *
 *   node tools/webgpu-spike/probe.mjs
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { ensureViteServer, stopViteServer } from '../lib/browser-harness.mjs';

const PORT = 5199;
const FULL_CHROMIUM = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;

const GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--mute-audio',
  '--no-sandbox',
];

async function probe(label, { url, executablePath, headless = true }) {
  if (executablePath && !existsSync(executablePath)) {
    console.log(`${label}: SKIP (no binary at ${executablePath})`);
    return;
  }
  let browser = null;
  try {
    browser = await chromium.launch({ headless, executablePath, args: GPU_ARGS });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const report = await page.evaluate(async () => {
      if (typeof navigator.gpu === 'undefined') return { navigatorGpu: false };
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { navigatorGpu: true, adapter: null };
        // Features must be REQUESTED to appear on the device, so ask the adapter.
        const device = await adapter.requestDevice();
        return {
          navigatorGpu: true,
          adapter: true,
          fallbackAdapter: adapter.isFallbackAdapter ?? null,
          maxColorAttachments: device.limits.maxColorAttachments,
          maxTextureDimension2D: device.limits.maxTextureDimension2D,
          timestampQuery: adapter.features.has('timestamp-query'),
        };
      } catch (e) {
        return { navigatorGpu: true, error: String((e && e.message) || e) };
      }
    });
    console.log(`${label}: ${JSON.stringify(report)}`);
  } catch (e) {
    console.log(`${label}: LAUNCH FAILED ${String((e && e.message) || e).split('\n')[0]}`);
  } finally {
    if (browser) await browser.close();
  }
}

const server = await ensureViteServer({ port: PORT, root: process.cwd(), attempts: 200 });

// The two failure modes, then the configuration that works.
await probe('managed chromium,     about:blank', { url: 'about:blank' });
await probe('full chromium,        about:blank', { url: 'about:blank', executablePath: FULL_CHROMIUM });
await probe('full chromium,        dev server ', {
  url: `http://127.0.0.1:${PORT}/index.html`,
  executablePath: FULL_CHROMIUM,
});

stopViteServer(server);
