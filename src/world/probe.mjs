#!/usr/bin/env node
/**
 * WORLD dev probe. Boots the page like the capture harness does, applies a
 * shot, then evaluates an arbitrary expression in the page so level layout can
 * be interrogated (sun azimuth, prop positions, draw calls) without adding
 * console spam to the shipping code.
 *
 *   node src/world/probe.mjs --shot=hero --port=5206 --eval="w.stats"
 *
 * `w` is the world subsystem, `e` the engine, `THREE` is not available.
 * Only ever run this on port 5206 — every other agent owns a different port.
 */
import { resolve } from 'node:path';
import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const args = parseArgs();
const PORT = Number(args.port ?? 5206);
const SHOT = args.shot ?? 'hero';
const EXPR = args.eval ?? 'w.stats';

const server = await ensureViteServer({ port: PORT, attempts: 120 });

const browser = await launchChromium({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

try {
  await page.goto(`http://127.0.0.1:${PORT}/?capture=1&shot=${SHOT}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  await page.evaluate((s) => window.__APPLY_SHOT__?.(s), SHOT);
  // --pre="js" runs before the settle and the screenshot: use it to hide a batch
  // and find out which merged mesh a mystery silhouette belongs to.
  if (args.pre) {
    await page.evaluate((expr) => {
      const e = window.__ENGINE__;
      const w = e.ctx.peek('world');
      const r = e.ctx.peek('render');
      // eslint-disable-next-line no-eval
      eval(expr);
    }, args.pre);
  }
  if (args.time) {
    await page.evaluate((h) => window.__ENGINE__.ctx.peek('sky')?.setTimeOfDay(h), Number(args.time));
  }
  // Free camera: --pos=x,y,z --look=x,y,z [--fov=60] [--out=file.png]
  if (args.pos) {
    await page.evaluate(
      ({ pos, look, fov }) => {
        const e = window.__ENGINE__;
        const c = e.camera;
        c.position.set(...pos);
        c.lookAt(...look);
        if (fov) {
          c.fov = fov;
          c.updateProjectionMatrix();
        }
        e.ctx.peek('player')?.teleport?.(c.position, c.rotation);
      },
      {
        pos: args.pos.split(',').map(Number),
        look: (args.look ?? '0,0,0').split(',').map(Number),
        fov: args.fov ? Number(args.fov) : 0,
      }
    );
    await page.evaluate(
      (n) =>
        new Promise((d) => {
          let i = 0;
          const tick = () => (++i >= n ? d() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      Number(args.settle ?? 90)
    );
  }
  // Auto-exposure needs real frames to adapt, or every probe shot is 3 stops dark.
  if (!args.pos) {
    await page.evaluate(
      (n) =>
        new Promise((d) => {
          let i = 0;
          const tick = () => (++i >= n ? d() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      Number(args.settle ?? 90)
    );
  }
  if (args.out) await page.screenshot({ path: resolve(args.out), type: 'png' });

  const out = await page.evaluate((expr) => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world');
    const sky = e.ctx.peek('sky');
    const r = e.ctx.peek('render');
    const phys = e.ctx.peek('physics');
    // eslint-disable-next-line no-eval
    const v = eval(expr);
    return JSON.stringify(v, (k, val) =>
      typeof val === 'number' ? Math.round(val * 1e4) / 1e4 : val
    );
  }, EXPR);
  console.log(out);
} catch (err) {
  console.error('probe failed:', err.message);
  console.error(logs.slice(-25).join('\n'));
} finally {
  if (args.logs) console.error(logs.slice(-40).join('\n'));
  await browser.close();
  stopViteServer(server);
}
