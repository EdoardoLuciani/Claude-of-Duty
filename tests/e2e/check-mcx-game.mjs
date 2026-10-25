#!/usr/bin/env node
/** GPU/browser integration review. Run after npm ci; no Blender or network assets.
 * node tests/e2e/check-mcx-game.mjs --port=5197 --out=.tmp-rend/mcx-game
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { parseArgs } from '../../tools/lib/browser-harness.mjs';
import {
  openGameReview,
  setWeaponMode,
  requestReload,
  checkFireBurst,
} from '../../tools/lib/game-review.mjs';
const args = parseArgs();
const port = Number(args.port ?? 5197),
  out = resolve(args.out ?? '.tmp-rend/mcx-game');
const { page, errors, warnings, pump, capture, boot, close } = await openGameReview({ port, out });

try {
  await boot(90000);
  await page.evaluate(() => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx;
    const w = ctx.get('weapons'),
      market = ctx.get('market');
    window.mcxReview = { ctx, w, market, shells: 0, shots: 0 };
    ctx.events.on('weapon:shell', () => window.mcxReview.shells++);
    ctx.events.on('weapon:fire', () => window.mcxReview.shots++);
    market.credits = 10000;
    market.openShop(1);
  });
  await pump(30);
  await capture('shop');
  const creditsBefore = await page.evaluate(() => window.mcxReview.market.credits);
  await page.keyboard.press('Digit7');
  await pump(2);
  assert.equal(
    await page.evaluate(() => window.mcxReview.w.activeId),
    'rifle',
    'number keys no longer buy'
  );
  assert.equal(
    await page.evaluate(() => window.mcxReview.market.credits),
    creditsBefore,
    'Digit7 does not charge'
  );
  assert.equal(await page.evaluate(() => window.mcxReview.market.buy('mcx')), true);
  await pump(2);
  assert.equal(await page.evaluate(() => window.mcxReview.w.activeId), 'mcx');
  assert.equal(await page.evaluate(() => window.mcxReview.market.credits), 8900);
  const charges = await page.evaluate(() => window.mcxReview.w.carpetBombs);
  await page.evaluate(() => window.mcxReview.market.buy('carpet'));
  await pump(2);
  assert.equal(await page.evaluate(() => window.mcxReview.w.carpetBombs), charges + 1);
  await page.evaluate(() => {
    const { market, ctx } = window.mcxReview;
    market.closeShop();
    // Exercise Player/CameraRig's actual ADS FOV solve, not a fixed shot camera.
    ctx.get('player').setControlEnabled(true);
  });
  await pump(30);
  await capture('hip');

  await page.evaluate(() => {
    const { w } = window.mcxReview;
    w.debugMode = 'ads';
  });
  await pump(60);
  assert.equal(
    await page.evaluate(
      () => window.mcxReview.w.viewmodel.scopeReticle.material.userData.owUniforms.uChevron.value
    ),
    1
  );
  assert(
    await page.evaluate(() => {
      const { ctx } = window.mcxReview;
      return ctx.camera.fov < ctx.config.fov * 0.3;
    }),
    'actual camera reaches the MCX 4x ADS FOV'
  );
  await capture('acog');
  await page.setViewportSize({ width: 1024, height: 768 });
  await pump(4);
  assert.equal(
    await page.evaluate(
      () => window.mcxReview.w.viewmodel.scopeMask.material.userData.owUniforms.uAspect.value
    ),
    4 / 3
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await setWeaponMode(page, 'mcxReview', 'idle');
  await pump(40);

  await requestReload(page, 'mcxReview', { mag: 8 });
  await pump(43);
  await capture('reload-tactical');
  await pump(120);
  assert.equal(await page.evaluate(() => window.mcxReview.w.state.mag), 30);
  await requestReload(page, 'mcxReview', { mag: 0, chambered: false });
  await pump(146);
  await capture('reload-empty');
  await pump(60);
  assert.equal(await page.evaluate(() => window.mcxReview.w.state.mag), 29);

  await page.evaluate(() => {
    const { ctx, w } = window.mcxReview;
    ctx.input.enabled = true;
    ctx.input.frozen = false;
    w.debugMode = null;
  });
  // Acquire gameplay focus without firing or requesting pointer lock.
  await page.locator('canvas').first().click({ button: 'middle' });
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyI');
  await pump(1);
  assert.equal(
    await page.evaluate(() => window.mcxReview.w.viewmodel.clipName),
    'inspect',
    'Shift+I has no stock-fold override'
  );
  await page.keyboard.up('KeyI');
  await page.keyboard.up('Shift');
  await pump(54);
  await capture('inspect');
  assert(
    await page.evaluate(
      () =>
        window.mcxReview.w.viewmodel.active.model.root.getObjectByName('stock_hinge').quaternion
          .w === 1
    )
  );
  assert(await page.evaluate(() => window.mcxReview.w.tryFire()), 'fire cancels inspect');
  await pump(30);

  const after = await checkFireBurst(page, pump, capture, 'mcxReview', 5);

  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        out,
        shots: after.shots,
        shells: after.shells,
        render: await page.evaluate(() => window.__RENDER_INFO__),
        errors,
        warnings,
      },
      null,
      2
    )
  );
} finally {
  await close();
}
