#!/usr/bin/env node
/**
 * Screenshot the standalone materials preview (dev tool, not shipped).
 *
 *   node src/materials/shoot.mjs --view=wall --out=/tmp/mat-wall.png --port=5202
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

const PORT = Number(args.port ?? 5202);
const W = Number(args.w ?? 1600);
const H = Number(args.h ?? 900);
const VIEW = args.view ?? 'board';
const OUT = resolve(args.out ?? `/tmp/mat-${VIEW}.png`);
const server = await ensureViteServer({ port: PORT });

const browser = await launchChromium({
  headless: true,
  args: [
    ...gpuAngleArgs(),
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-frame-rate-limit',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
  ],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

let failed = null;
try {
  const extra = (args.m ? `&m=${encodeURIComponent(args.m)}` : '') + (args.dbg ? `&dbg=${args.dbg}` : '');
  await page.goto(`http://127.0.0.1:${PORT}/src/materials/preview.html?view=${VIEW}${extra}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 60000 });
  await page.evaluate(
    () =>
      new Promise((d) => {
        let i = 0;
        const t = () => (++i >= 12 ? d() : requestAnimationFrame(t));
        requestAnimationFrame(t);
      })
  );
  mkdirSync(dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, type: 'png' });
  const info = await page.evaluate('window.__INFO__ ?? null');
  console.log(JSON.stringify({ ok: true, out: OUT, view: VIEW, info }, null, 2));
} catch (e) {
  failed = e;
}
const errs = logs.filter((l) => /error|Error|THREE\./.test(l));
console.error((errs.length ? errs : logs).slice(0, 40).join('\n'));
await browser.close();
stopViteServer(server);
if (failed) {
  console.error(JSON.stringify({ ok: false, error: failed.message }));
  process.exit(1);
}
