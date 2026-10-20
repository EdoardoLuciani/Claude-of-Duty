// Offline asset/input extraction from an unmodified game checkout. Not timed.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { chromium } from 'playwright';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../lib/browser-harness.mjs';
import { combatLane } from '../lib/combat-fixture.js';
import { waitForGame } from '../lib/native-render.mjs';
import { createCombatProfile, validateCombatProfile } from '../lib/profile-combat.js';
import { makeSceneExport } from './export-scene.js';
const args = parseArgs(),
  agents = Number(args.agents || 5),
  out = resolve(args.out || './direct-webgpu-data');
await mkdir(out, { recursive: true });
let browser, server;
try {
  server = await ensureViteServer({
    port: Number(args.port || 8390),
    root: resolve(args.root || process.cwd()),
    preview: !!args.production,
  });
  assert(server, 'choose an unused export port');
  browser = await launchChromium({
    headless: true,
    executablePath: args.executable || chromium.executablePath(),
    args: [
      '--ignore-gpu-blocklist',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--mute-audio',
    ],
  });
  const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    }),
    errors = [];
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${args.port || 8390}/?capture=1&lockstep=1&q=high`);
  await waitForGame(page);
  await page.addScriptTag({
    content: `window.__EXPORT_API__={combatLane:${combatLane},create:${createCombatProfile},extract:${makeSceneExport}};`,
  });
  await page.exposeFunction('__SAVE_SCENE__', async ({ meta, base64 }) => {
    await writeFile(join(out, `scene-${agents}.json`), JSON.stringify(meta));
    await writeFile(join(out, `scene-${agents}.bin`), Buffer.from(base64, 'base64'));
  });
  const report = await page.evaluate(async (agents) => {
    const engine = window.__ENGINE__,
      api = window.__EXPORT_API__,
      fixture = api.create(engine, api.combatLane, { agents });
    let capture;
    for (let i = -120; i < 900; i++) {
      const now = await new Promise((resolve) => requestAnimationFrame(resolve));
      fixture.before(i);
      if (i === 0) capture = api.extract(engine, 120);
      engine.step(now);
      capture?.take(i);
      fixture.after();
    }
    await window.__SAVE_SCENE__(capture.finish());
    fixture.dispose();
    return fixture.report;
  }, agents);
  validateCombatProfile(report);
  assert.deepEqual(errors, []);
  await writeFile(join(out, `source-combat-${agents}.json`), JSON.stringify(report, null, 2));
  await page.evaluate(() => window.__ENGINE__.dispose());
  console.log('exported validated scene', agents);
} finally {
  await browser?.close();
  if (server) await stopViteServer(server);
}
