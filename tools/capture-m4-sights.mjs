#!/usr/bin/env node
/** Capture and verify the approved sight in the shipped GLB, without mutations.
 * node tools/capture-m4-sights.mjs --port=5208 --out=.tmp-rend/m4-sights
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs(), port = Number(args.port ?? 5208);
assert(!args.variants, 'Historical A–H prototypes are in PR #343; this tool now checks the shipped sight');
const out = resolve(args.out ?? '.tmp-rend/m4-sights');
mkdirSync(out, { recursive: true });
const scenes = [
  { id: 'day-1080', label: 'Daylight / 1920 × 1080', width: 1920, height: 1080, time: 16.5 },
  { id: 'dusk-1080', label: 'Dusk / 1920 × 1080', width: 1920, height: 1080, time: 19.2 },
  { id: 'day-720', label: 'Daylight / 1280 × 720', width: 1280, height: 720, time: 16.5 },
];
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true, args: [
    '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars',
  ] });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const errors = [], captures = [];
  page.on('pageerror', e => errors.push(e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  for (const scene of scenes) {
    // Fresh engine: same RNG, idle phase, camera and temporal history as the review.
    await page.setViewportSize({ width: scene.width, height: scene.height });
    await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
    const metrics = await page.evaluate(async time => {
      window.__APPLY_SHOT__('weapon');
      const ctx = window.__ENGINE__.ctx, w = ctx.get('weapons');
      ctx.get('sky').setTimeOfDay(time);
      ctx.get('player').setControlEnabled(true);
      w.debugMode = 'ads';
      await window.__PUMP__(100);
      const { checkM4Sights } = await import('/tools/lib/m4-sight-checks.js');
      const geometry = checkM4Sights(w.viewmodel.active.animation.root);
      await window.__PRESENT__(2);
      return { ...geometry, frame: ctx.time.frame, worldFov: ctx.camera.fov, viewFov: ctx.viewCamera.fov,
        reticle: w.viewmodel.reticle.visible, render: window.__RENDER_INFO__ };
    }, scene.time);
    assert.equal(metrics.reticle, false); assert.equal(metrics.frame, 103);
    const file = `${scene.id}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    captures.push({ scene: scene.id, file, ...metrics });
    console.log(`Captured ${file}`);
  }
  assert.deepEqual(errors, []);
  for (const c of captures) {
    assert.equal(c.worldFov, captures[0].worldFov); assert.equal(c.viewFov, captures[0].viewFov);
    assert.deepEqual(c.postTop, captures[0].postTop);
  }
  const board = await browser.newPage({ viewport: { width: 808, height: 430 }, deviceScaleFactor: 1 });
  for (const zoom of [1, 3]) {
    const cards = scenes.map(scene => {
      const data = readFileSync(`${out}/${scene.id}.png`).toString('base64');
      return `<article><h3>${scene.label}</h3><div class="crop"><img src="data:image/png;base64,${data}" style="width:${scene.width * zoom}px;height:${scene.height * zoom}px"></div></article>`;
    }).join('');
    await board.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;padding:20px;background:#171c23;color:#e6edf3;font:16px system-ui}
      h1{font-size:23px;margin:0 0 8px}p{color:#b5c0ce}section{display:grid;grid-template-columns:repeat(3,248px);gap:8px}
      h3{font-size:14px;padding:10px 6px;margin:0;background:#303944}.crop{position:relative;width:248px;height:248px;overflow:hidden}
      img{position:absolute;max-width:none;left:50%;top:50%;transform:translate(-50%,-50%);${zoom > 1 ? 'image-rendering:pixelated;' : ''}}
    </style><h1>Shipped M4 sight — ${zoom === 1 ? 'native-size crops' : '3× diagnostic enlargement'}</h1>
    <p>Approved H: clear 5.6 mm rear hole, anchored ring, original post, neon-green tip. No geometry injection.</p><section>${cards}</section>`);
    await board.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); });
    await board.screenshot({ path: `${out}/comparison-${zoom}x.png`, fullPage: true });
  }
  await board.close();
  writeFileSync(`${out}/report.json`, JSON.stringify({ scenes, captures, errors }, null, 2) + '\n');
  console.log(`Shipped sight captures: ${out}`);
} finally {
  try { await browser?.close(); } finally { stopViteServer(server); }
}
