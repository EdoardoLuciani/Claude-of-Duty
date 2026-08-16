#!/usr/bin/env node
/**
 * DEV ONLY — screenshot the standalone character rig (src/ai/preview.html).
 * Mirrors tools/capture.mjs so the soldier model and its animation can be
 * iterated on while the rest of the game is mid-edit.
 *
 *   node src/ai/shoot.mjs --view=front --variant=vanguard --out=/tmp/ai-front.png
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ensureViteServer,
  gpuAngleArgs,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const args = parseArgs();

const PORT = Number(args.port ?? 5211);
const W = Number(args.w ?? 1280);
const H = Number(args.h ?? 1600);
const OUT = resolve(args.out ?? `/tmp/ai-${args.view ?? 'front'}.png`);
const SETTLE = Number(args.settle ?? 12);

const server = await ensureViteServer({ port: PORT, attempts: 120 });

const browser = await launchChromium({
  headless: true,
  args: [
    ...gpuAngleArgs(),
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
  ],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

const qs = new URLSearchParams();
for (const k of ['view', 'variant', 'clip', 'phase', 'aim']) if (args[k]) qs.set(k, args[k]);

let failed = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/src/ai/preview.html?${qs}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 60000 });
  await page.evaluate(
    (n) =>
      new Promise((done) => {
        let i = 0;
        const tick = () => (++i >= n ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    SETTLE
  );
  mkdirSync(dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, type: 'png' });
  console.log(JSON.stringify({ ok: true, out: OUT, view: args.view ?? 'front' }));
} catch (e) {
  failed = e;
}
if (failed || args.verbose) console.error(logs.slice(-40).join('\n'));
await browser.close();
stopViteServer(server);
if (failed) {
  console.error(JSON.stringify({ ok: false, error: failed.message }));
  process.exit(1);
}
