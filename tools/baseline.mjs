#!/usr/bin/env node
/** Isolated native captures with a fixed simulation-frame budget.
 * Each shot starts in a fresh page; unlike shotset, no previous shot's state
 * carries over. This is not a promise of whole-game byte-identical captures:
 * asset readiness and native temporal history still require repeat-run checks.
 * node tools/baseline.mjs --shots=hero,detail --out=shots/base --port=8080
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
import { captureNative, verifyNative } from './lib/native-render.mjs';

const args = parseArgs();
const PORT = Number(args.port ?? 5173), W = Number(args.w ?? 1920), H = Number(args.h ?? 1080);
const SETTLE = Number(args.settle ?? 90), TIMEOUT = Number(args.timeout ?? 90000);
const OUTDIR = resolve(args.out ?? 'shots/base');
const EXTRA = args.query ? `&${args.query}` : '';
const url = `http://127.0.0.1:${PORT}/?capture=1&lockstep=1${EXTRA}`;
const report = { ok: true, outDir: OUTDIR, size: `${W}x${H}`, isolated: true, settle: SETTLE, shots: [], errors: [] };
let server, browser;
mkdirSync(OUTDIR, { recursive: true });
try {
  server = await ensureViteServer({ port: PORT });
  browser = await launchChromium({ webgpu: true, headless: true,
    args: ['--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'] });
  // Discovery is inside the same cleanup boundary as launch and capture.
  const probe = await browser.newPage({ viewport: { width: W, height: H } });
  await probe.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await probe.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
  await verifyNative(probe);
  const all = await probe.evaluate('Object.keys(window.__SHOTS__ ?? {})');
  await probe.close();
  const wanted = args.shots ? String(args.shots).split(',').map(s => s.trim()) : all;
  for (const name of wanted) {
    if (!all.includes(name)) { report.shots.push({ shot: name, ok: false, error: 'unknown shot' }); continue; }
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const logs = [];
    page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
    page.on('pageerror', e => logs.push(e.message));
    try {
      await page.goto(`${url}&shot=${encodeURIComponent(name)}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
      const device = await verifyNative(page);
      const applied = await page.evaluate(({ s, settle }) => window.__APPLY_SHOT__(s, { grabFrame: settle }),
        { s: name, settle: SETTLE });
      await page.evaluate(n => window.__PUMP__(n), SETTLE);
      await page.evaluate(() => window.__PRESENT__(2));
      await captureNative(page, `${OUTDIR}/${name}.png`);
      const info = await page.evaluate('window.__RENDER_INFO__ ?? null');
      report.shots.push({ shot: name, ok: !applied?.error && logs.length === 0, device, info, logs });
    } catch (e) { report.shots.push({ shot: name, ok: false, error: e.message, logs }); }
    finally { await page.close(); }
  }
} catch (e) { report.ok = false; report.fatal = e.message; }
finally {
  try { await browser?.close(); } finally { if (server) stopViteServer(server); }
}
report.errors = report.shots.flatMap(s => s.logs ?? []);
report.ok &&= report.shots.length > 0 && report.shots.every(s => s.ok);
writeFileSync(`${OUTDIR}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
