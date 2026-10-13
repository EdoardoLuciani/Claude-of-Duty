#!/usr/bin/env node
/** Fast native review set. Reuses a page (state carries between shots); use
 * baseline.mjs for isolated pages. Neither tool promises pixel determinism.
 * node tools/shotset.mjs --shots=hero,detail --out=shots/latest
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
import { captureNative, verifyNative } from './lib/native-render.mjs';

const args = parseArgs();
const PORT = Number(args.port ?? 5173), W = Number(args.w ?? 1920), H = Number(args.h ?? 1080);
const SETTLE = Number(args.settle ?? 90), TIMEOUT = Number(args.timeout ?? 90000);
const OUTDIR = resolve(args.out ?? 'shots/latest');
const report = { ok: true, outDir: OUTDIR, size: `${W}x${H}`, shots: [], errors: [] };
const logs = [];
let server, browser;
mkdirSync(OUTDIR, { recursive: true });
try {
  server = await ensureViteServer({ port: PORT });
  browser = await launchChromium({ webgpu: true, headless: true,
    args: ['--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  const extra = args.query ? `&${args.query}` : '';
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1${extra}`,
    { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
  report.device = await verifyNative(page);
  const all = await page.evaluate('Object.keys(window.__SHOTS__ ?? {})');
  const wanted = args.shots ? String(args.shots).split(',').map(s => s.trim()) : all;
  for (const name of wanted) {
    if (!all.includes(name)) { report.shots.push({ shot: name, ok: false, error: 'unknown shot' }); continue; }
    const before = logs.length;
    const applied = await page.evaluate(({ s, settle }) => window.__APPLY_SHOT__(s, { grabFrame: settle }),
      { s: name, settle: SETTLE });
    await page.evaluate(n => window.__PUMP__(n), SETTLE);
    await page.evaluate(() => window.__PRESENT__(2));
    const file = `${OUTDIR}/${name}.png`;
    await captureNative(page, file);
    report.shots.push({ shot: name, ok: !applied?.error, file,
      doc: await page.evaluate(s => window.__SHOTS__[s]?.doc ?? '', name),
      info: await page.evaluate('window.__RENDER_INFO__ ?? null'), newLogs: logs.slice(before) });
  }
} catch (e) { report.ok = false; report.fatal = e.message; }
finally {
  try { await browser?.close(); } finally { if (server) stopViteServer(server); }
}
report.errors = logs.filter(l => l.startsWith('[pageerror]') || l.startsWith('[error]'));
report.ok &&= report.shots.length > 0 && report.shots.every(s => s.ok) && report.errors.length === 0;
writeFileSync(`${OUTDIR}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
