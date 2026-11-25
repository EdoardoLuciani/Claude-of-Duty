/** Scratch review: supply the blockout to the existing RMR loader in this browser only. */
import { resolve } from 'node:path';

import type { AttachmentConfig } from '../src/weapons/attachment-rules.ts';
import { ensureDevServer, launchChromium, stopDevServer } from './lib/browser-harness.ts';
import { captureNative, waitForGame } from './lib/native-render.ts';

const out = resolve(process.argv[2] ?? '/tmp/railway-blockout');
const port = Number(process.argv[3] ?? 5223);
const server = await ensureDevServer({ port });
try {
  const browser = await launchChromium({ headless: true, args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
    await page.route('**/models/attachments/rmr.runtime.glb', (route): Promise<void> =>
      route.fulfill({ path: resolve(out, 'railway.glb'), contentType: 'model/gltf-binary' })
    );
    for (const [optic, label] of [
      ['exps3', 'exps3'],
      ['rmr', 'railway'],
    ] as const) {
      await page.goto(
        `http://127.0.0.1:${port}/?capture=1&lockstep=1&attachmentOptic=${optic}&attachmentWeapon=rifle`,
        { waitUntil: 'domcontentloaded' }
      );
      await waitForGame(page);
      const config: AttachmentConfig = { optic, rail: null, muzzle: null };
      const data = await page.evaluate(
        async (
          config
        ): Promise<{
          weaponFov: number;
          worldFov: number;
          dot: number[];
        }> => {
          const engine = window.__ENGINE__;
          const shot = window.__APPLY_SHOT__;
          if (!engine || !shot || !window.__PUMP__ || !window.__PRESENT__)
            throw new Error('game not ready');
          const weapons = engine.ctx.get('weapons');
          const render = engine.ctx.get('render');
          render.settings.autoExposure = false;
          render._exposure = 2;
          if (!weapons.applyBuild('rifle', config) || !weapons.setWeaponImmediate('rifle'))
            throw new Error('failed to mount optic');
          const entry = weapons.viewmodel.active;
          if (!entry?.mountedOptic) throw new Error('missing optic');
          if (config.optic === 'rmr') {
            // Prototype-only pocket tuning. Does not modify the real catalog or runtime.
            entry.eyeRelief = 0.215;
            entry.mountedOptic.optic = {
              apertureR: 0.0145,
              dotMoa: 4,
              minDotPixels: 4,
              dotOpacity: 0.9,
            };
          }
          const result = shot('ads', { grabFrame: 24 });
          if ('error' in result) throw new Error(result.error);
          await window.__PUMP__(24);
          await window.__PRESENT__(2);
          const { reticle } = weapons.viewmodel;
          if (!reticle.visible) throw new Error('optic reticle is not visible in ADS');
          const dot = reticle.getWorldPosition(reticle.position.clone()).project(engine.viewCamera);
          if (Math.hypot(dot.x, dot.y) > 0.03) throw new Error('optic reticle is not centered');
          return {
            weaponFov: engine.viewCamera.fov,
            worldFov: engine.camera.fov,
            dot: [dot.x, dot.y],
          };
        },
        config
      );
      console.log(label, data);
      await captureNative(page, resolve(out, `${label}-ads.png`));
    }
  } finally {
    await browser.close();
  }
} finally {
  stopDevServer(server);
}
