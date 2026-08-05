#!/usr/bin/env node
/**
 * Capture many named shots in a single browser session, then report render
 * stats and any console errors. This is what the visual critics review.
 *
 *   node tools/shotset.mjs --out=shots/iter-03            # all shots
 *   node tools/shotset.mjs --shots=hero,detail --out=tmp  # a subset
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs();

const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const SETTLE = Number(args.settle ?? 90);
const OUTDIR = resolve(args.out ?? 'shots/latest');
const server = await ensureViteServer({ port: PORT });

const browser = await launchChromium({
  headless: true,
  args: [
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-frame-rate-limit',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
    '--mute-audio',
  ],
});

const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => m.type() !== 'debug' && logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

mkdirSync(OUTDIR, { recursive: true });

const report = { ok: true, outDir: OUTDIR, size: `${W}x${H}`, shots: [], errors: [] };

try {
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });

  const all = await page.evaluate('Object.keys(window.__SHOTS__ ?? {})');
  const wanted = args.shots ? String(args.shots).split(',').map((s) => s.trim()) : all;

  for (const name of wanted) {
    if (!all.includes(name)) {
      report.shots.push({ shot: name, ok: false, error: 'unknown shot' });
      continue;
    }
    const before = logs.length;
    const applied = await page.evaluate(
      ({ s, settle }) => window.__APPLY_SHOT__(s, { grabFrame: settle }),
      { s: name, settle: SETTLE }
    );
    await page.evaluate(
      (n) =>
        new Promise((done) => {
          let i = 0;
          const tick = () => (++i >= n ? done() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      SETTLE
    );
    const file = `${OUTDIR}/${name}.png`;
    await page.screenshot({ path: file, type: 'png' });
    const info = await page.evaluate('window.__RENDER_INFO__ ?? null');
    report.shots.push({
      shot: name,
      ok: !applied?.error,
      file,
      doc: await page.evaluate((s) => window.__SHOTS__[s]?.doc ?? '', name),
      info,
      newLogs: logs.slice(before),
    });
  }
} catch (e) {
  report.ok = false;
  report.fatal = e.message;
} finally {
  report.errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
  await browser.close();
  stopViteServer(server);
}

writeFileSync(`${OUTDIR}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
