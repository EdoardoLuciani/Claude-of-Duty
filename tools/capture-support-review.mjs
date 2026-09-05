#!/usr/bin/env node
/** Reproduce the fixed-camera prop-support spot checks, without HUD/viewmodel. */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs();
if (!args.poses) {
  console.error('usage: node tools/capture-support-review.mjs --poses <spot-checks.json> [--report <review.json>] [--out <dir>]');
  process.exit(1);
}
const port = Number(args.port ?? 5196);
const out = resolve(args.out ?? 'shots/support-review');
const shots = JSON.parse(readFileSync(resolve(args.poses), 'utf8'));
const results = args.report ? JSON.parse(readFileSync(resolve(args.report), 'utf8')).results : [];
const byKey = new Map(results.map((result) => [result.key, result]));
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  for (const shot of shots) {
    const verdict = byKey.get(shot.id)?.status;
    await page.evaluate(({ shot, verdict }) => {
      const engine = window.__ENGINE__;
      const world = engine.ctx.get('world');
      const player = engine.ctx.peek('player');
      engine.input.frozen = true;
      engine.input.enabled = false;
      player?.setControlEnabled?.(false);
      engine.viewScene.visible = false;
      document.getElementById('ui').style.display = 'none';
      const cam = engine.camera;
      cam.position.copy(world.levelToWorld(...shot.target.map((n, i) => n + shot.offset[i])));
      cam.lookAt(world.levelToWorld(...shot.target));
      cam.fov = 55;
      cam.updateProjectionMatrix();
      player?.teleport?.(cam.position, cam.rotation);
      engine.ctx.peek('sky')?.setTimeOfDay?.(16.5);
      let label = document.getElementById('support-review-label');
      if (!label) {
        label = document.createElement('div');
        label.id = 'support-review-label';
        label.style.cssText = 'position:fixed;top:8px;left:8px;background:#000c;color:white;padding:10px;font:16px monospace;z-index:99999';
        document.body.appendChild(label);
      }
      label.textContent = `${shot.id}${verdict ? ` — ${verdict}` : ''}`;
    }, { shot, verdict });
    await page.evaluate(() => new Promise((done) => {
      let frame = 0;
      const tick = () => (++frame >= 30 ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }));
    await page.screenshot({ path: resolve(out, `${shot.name}.png`) });
    console.log(shot.name);
  }
} finally {
  await browser.close();
  stopViteServer(server);
}
