#!/usr/bin/env bun
import assert from 'node:assert/strict';

import {
  collectBrowserErrors,
  ensureDevServer,
  launchChromium,
  stopDevServer,
} from '../../tools/lib/browser-harness.ts';
import { waitForGame } from '../../tools/lib/native-render.ts';

const port = Number(process.env.PORT ?? 5173);
const server = await ensureDevServer({ port });
try {
  const browser = await launchChromium({
    headless: process.env.HEADLESS === '1',
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--ignore-gpu-blocklist', '--mute-audio'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    collectBrowserErrors(page, errors, { validationMessages: true });
    await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForGame(page);
    const result = await page.evaluate(async (): Promise<{ draws: number; uploads: number }> => {
      const engine = window.__ENGINE__,
        pump = window.__PUMP__;
      if (!engine || !pump) throw Error('capture not ready');
      const ui = engine.ctx.get('ui'),
        weapons = engine.ctx.get('weapons');
      const hud = ui.pixiHud,
        state = weapons.state;
      const backend = engine.ctx.get('render').renderer.backend;
      if (!hud || !state || !('device' in backend) || !(backend.device instanceof GPUDevice))
        throw Error('gameplay HUD or native GPU unavailable');
      await pump(30);
      const before = hud.draws;
      const queue = backend.device.queue,
        copy = queue.copyExternalImageToTexture.bind(queue);
      let uploads = 0;
      queue.copyExternalImageToTexture = function (source, destination, size): void {
        if (source.source instanceof HTMLCanvasElement || source.source instanceof OffscreenCanvas)
          uploads++;
        Reflect.apply(copy, queue, [source, destination, size]);
      };
      try {
        state.mag -= 3;
        if (!weapons.reload()) throw Error('reload did not start');
        ui.fpsText = '179 FPS';
        ui.banner.show('Wave 1 Cleared', '+100 · WAVE BONUS');
        await pump(10);
        return { draws: hud.draws - before, uploads };
      } finally {
        queue.copyExternalImageToTexture = copy;
      }
    });
    assert(result.draws > 0, 'changed labels must redraw the HUD');
    assert.equal(result.uploads, 0, 'changing HUD text must reuse uploaded glyphs');
    assert.deepEqual(errors, []);
    console.log('ok: ammo, reload, FPS and banner redraw without canvas texture uploads');
  } finally {
    await browser.close();
  }
} finally {
  stopDevServer(server);
}
