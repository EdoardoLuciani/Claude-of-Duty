#!/usr/bin/env node
/**
 * Pose capture: boots the game and snaps a PNG from an explicit world-space
 * camera pose (pos + look), used to eyeball map issues from telemetry spots.
 *
 *   node tools/shot-pose.mjs --pos=2.867,2.08,-29.494 --look=3.016,1.04,-27.718 --out=shots/before-tarp.png
 *   node tools/shot-pose.mjs --pos=4.703,2.08,-20.212 --look=3.403,1.641,-19.043 --out=shots/before-box.png
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs();
const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1920);
const H = Number(args.h ?? 1080);
const OUT = resolve(args.out ?? 'shots/pose.png');
const FOV = Number(args.fov ?? 80);
const SETTLE = Number(args.settle ?? 70);
const TIME = Number(args.time ?? 16.5);
const POS = String(args.pos ?? '').split(',').map(Number);
const LOOK = String(args.look ?? '').split(',').map(Number);
const TIMEOUT = Number(args.timeout ?? 90000);

const server = await ensureViteServer({ port: PORT, attempts: 120 });
const browser = await launchChromium({
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--force-color-profile=srgb',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--mute-audio',
  ],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
let failed = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });

  await page.evaluate(
    ({ pos, look, fov, time }) =>
      new Promise((done) => {
        const engine = window.__ENGINE__;
        engine.input.frozen = true;
        engine.input.enabled = false;
        const player = engine.ctx.peek('player');
        player?.setControlEnabled?.(false);
        const T = engine.camera.position.constructor;
        engine.camera.position.fromArray(pos);
        const target = new T().fromArray(look);
        engine.camera.lookAt(target);
        if (fov) {
          engine.camera.fov = fov;
          engine.camera.updateProjectionMatrix();
        }
        player?.teleport?.(engine.camera.position, engine.camera.rotation);
        engine.ctx.peek('sky')?.setTimeOfDay?.(time);
        engine.ctx.peek('weapons')?.debugPose?.('idle');
        engine.ctx.peek('ui')?.debugState?.('clean');
        done();
      }),
    { pos: POS, look: LOOK, fov: FOV, time: TIME }
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

  mkdirSync(dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, type: 'png' });
  console.log(JSON.stringify({ ok: true, out: OUT }));
} catch (e) {
  failed = e;
} finally {
  if (failed || args.verbose) console.error(logs.slice(-40).join('\n'));
  await browser.close();
  stopViteServer(server);
}
if (failed) {
  console.error(JSON.stringify({ ok: false, error: failed.message }));
  process.exit(1);
}
