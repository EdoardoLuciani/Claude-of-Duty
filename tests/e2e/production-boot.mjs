#!/usr/bin/env node
// Run after npm run build: exercises the minified dist, never the dev server.
import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
import { verifyNative, captureNative } from '../../tools/lib/native-render.mjs';
const args = parseArgs(), port = Number(args.port ?? 5390);
const server = await ensureViteServer({ port, root: args.root ?? process.cwd(), preview: true });
const browser = await launchChromium({ webgpu: true, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`);
  assert(await page.locator('script[src^="/assets/"]').count(), 'must run the production bundle');
  await page.waitForFunction(() => window.__READY__ || window.__ENGINE__?.error || document.body.innerText.includes('BOOT FAILURE'), null, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.__READY__ === true), true, errors.join('\n'));
  await verifyNative(page);
  await page.evaluate(async () => { window.__APPLY_SHOT__('combat'); await window.__PUMP__(30); });
  assert.equal(await page.evaluate(() => window.__PREWARM__.ok), true, 'all production warmup hooks must succeed');
  await captureNative(page, args.out ?? '/tmp/webgpu-production.png');
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.__ENGINE__.dispose());
  console.log('minified production boot, warmup and native frame: passed');
} finally { await browser.close(); stopViteServer(server); }
