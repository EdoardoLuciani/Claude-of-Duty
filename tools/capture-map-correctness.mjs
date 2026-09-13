#!/usr/bin/env node
/** Capture the telemetry fixes and every newly accessible facade from fixed poses. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5173);
const width = Number(args.w ?? 960);
const height = Number(args.h ?? 540);
const outDir = resolve(args.out ?? 'shots/map-correctness');
const settle = Number(args.settle ?? 50);
mkdirSync(outDir, { recursive: true });

const telemetry = [
  ['issue-01-e3-doorway', [-3.009, 2.08, -26.65], [0.717, -0.572, -0.399]],
  ['issue-02-e2-door', [3.708, 2.194, -3.112], [0.783, -0.398, -0.478]],
  ['issue-03-w1-shell', [1.574, 2.085, 19.129], [-0.823, -0.353, 0.445]],
  ['issue-04-w1-inside', [-2.577, 2.076, 20.258], [-0.264, -0.8, 0.539]],
  ['issue-05-w1-short-door', [5.847, 1.669, 16.336], [-0.829, 0.233, 0.509]],
  ['issue-06-w2-opening', [-11.75, 2.099, 5.56], [-0.688, -0.571, 0.449]],
  ['issue-07-e3-opening', [-2.368, 2.101, -26.809], [0.67, -0.595, -0.444]],
  ['issue-08-junction-box', [-7.05, 2.081, -25.564], [-0.99, -0.076, -0.122]],
  ['issue-09-gate-e4', [-17.944, 1.693, -32.819], [0.741, -0.045, -0.67]],
  ['issue-10-wreck4', [-6.912, 1.114, -5.386], [-0.16, -0.325, 0.932]],
].map(([name, eye, forward]) => ({ name, eye, forward, fov: 80 }));

const levelShots = [
  ['suite-w5', [-1.2, 1.65, 28.2], [-7.2, 1.35, 28.2]],
  ['suite-w1', [-1.2, 1.65, 15.0], [-7.2, 1.35, 15.0]],
  ['suite-w4', [-1.2, 1.65, -28.6], [-7.2, 1.35, -28.6]],
  ['suite-e5', [1.2, 1.65, 33.0], [7.2, 1.35, 33.0]],
  ['suite-e2', [1.2, 1.65, -2.2], [7.2, 1.35, -2.2]],
  ['suite-e4', [1.2, 1.65, -39.0], [7.2, 1.35, -39.0]],
  ['gate-wide', [0, 2.1, -27.0], [0, 4.6, -42.5]],
  ['wreck-1', [-0.2, 1.7, 4.0], [2.5, 0.55, 0.5]],
  ['wreck-2', [0.4, 1.7, -25.0], [-2.8, 0.55, -28.5]],
  ['wreck-3', [1.0, 1.7, 21.0], [4.9, 0.55, 24.0]],
  ['wreck-4', [-1.0, 1.7, -3.5], [-4.65, 0.5, -6.7]],
].map(([name, cam, target]) => ({ name, cam, target, fov: 68 }));

const server = await ensureViteServer({ port, attempts: 120 });
const browser = await launchChromium({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--force-color-profile=srgb', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  for (const shot of [...telemetry, ...levelShots]) {
    await page.evaluate((value) => {
      const engine = window.__ENGINE__;
      const world = engine.ctx.get('world');
      const player = engine.ctx.peek('player');
      engine.input.frozen = true;
      engine.input.enabled = false;
      player?.setControlEnabled?.(false);
      const camera = engine.camera;
      if (value.eye) {
        camera.position.fromArray(value.eye);
        camera.lookAt(
          value.eye[0] + value.forward[0],
          value.eye[1] + value.forward[1],
          value.eye[2] + value.forward[2]
        );
      } else {
        camera.position.copy(world.levelToWorld(...value.cam));
        camera.lookAt(world.levelToWorld(...value.target));
      }
      camera.fov = value.fov;
      camera.updateProjectionMatrix();
      player?.teleport?.(camera.position, camera.rotation);
      engine.ctx.peek('sky')?.setTimeOfDay?.(16.5);
    }, shot);
    await page.evaluate((frames) => new Promise((done) => {
      let frame = 0;
      const tick = () => (++frame >= frames ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }), settle);
    await page.screenshot({ path: resolve(outDir, `${shot.name}.png`), type: 'png' });
    console.log(`${shot.name}.png`);
  }
} finally {
  await browser.close();
  stopViteServer(server);
}
