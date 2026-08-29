#!/usr/bin/env node
/**
 * Render-validate the flagged map issues. Boots the game, poses the camera at
 * each flagged location (LEVEL-space framings, converted to world inside the
 * page via world.levelToWorld), and writes a PNG per shot.
 *
 *   node tools/validate-map-issues.mjs            # render all shots
 *   node tools/validate-map-issues.mjs --only=rock-sw,close-stackA
 *
 * Read the PNGs afterwards (they go to shots/validate-map/).
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs();
const PORT = Number(args.port ?? 5173);
const W = Number(args.w ?? 1280);
const H = Number(args.h ?? 720);
const OUTDIR = resolve(args.out ?? 'shots/validate-map');
const SETTLE = Number(args.settle ?? 70);
const TIME = Number(args.time ?? 16.5);
const FOV = Number(args.fov ?? 68);

// sh: LEVEL-space framings of each confirmed finding. cam + target are level
// coordinates; the page converts them to world space.
const SHOTS = [
  { name: 'tyre-0005',   cam: [8.4, 1.3, 4.6],    target: [6.11, 0.55, 3.02],   doc: 'market small-tyre stack, was hovering over the alley-mouth ramp' },
  { name: 'tyre-0008',   cam: [-3.3, 1.3, 7.9],   target: [-5.60, 0.55, 6.22],  doc: 'second market small-tyre stack, was hovering' },
  { name: 'tyre-0001',   cam: [-2.9, 1.2, 13.9],  target: [-5.17, 0.25, 12.45], doc: 'north small-tyre stack, was 0.17 above the pavement' },
  { name: 'can-0036',    cam: [-3.6, 1.1, 26.3],  target: [-6.00, 0.28, 25.13], doc: 'can/0036, was 0.25 above the ground' },
  { name: 'rock-east-a', cam: [27.0, 1.2, -19.6], target: [29.27, 0.10, -21.38],doc: 'seam stones on the east gravel alley, were floating over dunes' },
  { name: 'rock-east-b', cam: [17.0, 1.2, -12.2], target: [19.12, 0.10, -13.73],doc: 'seam stones, east gravel alley north edge' },
  { name: 'rock-sw',     cam: [-28.2, 1.2, -44.4],target: [-30.43, 0.10, -46.16],doc: 'seam stones on the SW dirt alley, were floating over dunes' },
  { name: 'rock-street', cam: [8.6, 1.2, -20.2],  target: [6.59, 0.05, -21.70], doc: 'seam stone at the pavement edge' },
  { name: 'close-stackA', cam: [7.6, 0.9, 4.4],  target: [6.135, 0.45, 3.018],  doc: 'tyre stacks @(6.13,3.02) tight low angle' },
  { name: 'close-stackB', cam: [-3.9, 0.9, 7.6], target: [-5.593, 0.45, 6.221], doc: 'tyre stacks @(-5.59,6.22) tight low angle' },
  { name: 'close-stackC', cam: [-3.5, 0.8, 13.6],target: [-5.143, 0.35, 12.453],doc: 'small stack @(-5.14,12.45) tight low angle' },
  { name: 'close-can',    cam: [-4.9, 0.7, 25.9],target: [-6.00, 0.25, 25.129], doc: 'can/0036 @(-6.0,25.13) tight low angle' },
];

const only = args.only ? new Set(String(args.only).split(',')) : null;
const list = SHOTS.filter((s) => !only || only.has(s.name));

const server = await ensureViteServer({ port: PORT, attempts: 120 });
const browser = await launchChromium({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--force-color-profile=srgb',
    '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

try {
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });

  const results = [];
  for (const shot of list) {
    const posed = await page.evaluate(({ cam, target, fov, time }) => {
      const engine = window.__ENGINE__;
      const world = engine.ctx.get('world');
      const player = engine.ctx.peek('player');
      engine.input.frozen = true;
      engine.input.enabled = false;
      player?.setControlEnabled?.(false);
      const c = engine.camera;
      const cp = world.levelToWorld(cam[0], cam[1], cam[2]);
      const tp = world.levelToWorld(target[0], target[1], target[2]);
      c.position.copy(cp);
      c.fov = fov; c.updateProjectionMatrix();
      c.lookAt(tp);
      player?.teleport?.(c.position, c.rotation);
      engine.ctx.peek('sky')?.setTimeOfDay?.(time);
      return { cam: cp.toArray().map((n) => +n.toFixed(2)), tgt: tp.toArray().map((n) => +n.toFixed(2)) };
    }, { cam: shot.cam, target: shot.target, fov: FOV, time: TIME });

    await page.evaluate((n) => new Promise((done) => {
      let i = 0; const tick = () => (++i >= n ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }), SETTLE);

    const out = resolve(OUTDIR, `${shot.name}.png`);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, type: 'png' });
    results.push({ name: shot.name, out, ...posed, doc: shot.doc });
    console.log(JSON.stringify({ ok: true, name: shot.name, ...posed }));
  }
  console.log(JSON.stringify({ done: true, n: results.length, errors }, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
