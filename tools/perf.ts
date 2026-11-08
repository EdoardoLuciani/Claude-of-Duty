#!/usr/bin/env bun
import assert from 'node:assert/strict';

import {
  ensureDevServer,
  launchChromium,
  parseArgs,
  stopDevServer,
} from './lib/browser-harness.ts';
import { waitForGame } from './lib/native-render.ts';

const args = parseArgs();
const port = Number(args.port ?? 8080);
const frames = Number(args.frames ?? 300);
const warmup = Number(args.warmup ?? 120);
assert(Number.isInteger(port) && port > 0 && port <= 65535, 'invalid port');
assert(Number.isInteger(frames) && frames > 0, 'frames must be a positive integer');
assert(Number.isInteger(warmup) && warmup >= 0, 'warmup must be a non-negative integer');
const server = await ensureDevServer({ port });
let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
type Timings = { med: number; p95: number; min: number };
type Result = {
  res: string;
  medMs: number;
  p95Ms: number;
  medFps: number;
  calls: number | null;
  tris: number | null;
};
const out: Result[] = [];
try {
  browser = await launchChromium({
    headless: true,
    args: [
      '--ignore-gpu-blocklist',
      '--mute-audio',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
    ],
  });
  for (const [w, h] of [
    [1280, 720],
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    try {
      await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'domcontentloaded' });
      await waitForGame(page);
      await page.evaluate((): void => {
        if (!window.__APPLY_SHOT__) throw new Error('capture shot API unavailable');
        window.__APPLY_SHOT__('hero');
      });
      const timings = await page.evaluate(
        async ({ warmup, frames }): Promise<Timings> => {
          if (warmup > 0) {
            await new Promise<void>((done): void => {
              let i = 0;
              const tick = (): void => {
                if (++i >= warmup) done();
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
          }
          return new Promise<Timings>((done): void => {
            const ts: number[] = [];
            let last = performance.now();
            const tick = (): void => {
              const now = performance.now();
              ts.push(now - last);
              last = now;
              if (ts.length >= frames) {
                ts.sort((a, b): number => a - b);
                done({
                  med: ts[Math.floor(frames * 0.5)],
                  p95: ts[Math.floor(frames * 0.95)],
                  min: ts[0],
                });
              } else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        },
        { warmup, frames }
      );
      const info = await page.evaluate((): Window['__RENDER_INFO__'] => window.__RENDER_INFO__);
      if (!info) throw new Error('render counters unavailable');
      out.push({
        res: `${w}x${h}`,
        medMs: +timings.med.toFixed(2),
        p95Ms: +timings.p95.toFixed(2),
        medFps: +(1000 / timings.med).toFixed(0),
        calls: info.calls,
        tris: info.tris,
      });
    } finally {
      await page.close();
    }
  }
  console.log(JSON.stringify(out, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    stopDevServer(server);
  }
}
