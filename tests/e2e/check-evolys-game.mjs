#!/usr/bin/env node
// Real startup, HDR weapon pass, shared arms, ammo, switching and shot events.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../../tools/lib/browser-harness.mjs';
import {
  openGameReview,
  setWeaponMode,
  requestReload,
  checkFireBurst,
} from '../../tools/lib/game-review.mjs';
const args = parseArgs(),
  port = Number(args.port ?? 5213),
  out = resolve(args.out ?? '.tmp-rend/evolys/game');
const { page, errors, warnings, pump, capture, boot, close } = await openGameReview({ port, out });

const beltCount = () =>
  page.evaluate(
    () =>
      window.evolysReview.w.viewmodel.active.animation.bones.filter((b) => b.scale.x > 0.5).length
  );
try {
  await boot();
  await page.waitForFunction(
    async () => {
      await window.__ENGINE__.ctx.get('weapons')._restTask;
      return true;
    },
    null,
    { timeout: 90000 }
  );
  await page.evaluate(() => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx,
      w = ctx.get('weapons');
    window.evolysReview = { ctx, w, shells: 0, shots: 0 };
    ctx.events.on('weapon:shell', () => window.evolysReview.shells++);
    ctx.events.on('weapon:fire', () => window.evolysReview.shots++);
    ctx.get('player').setControlEnabled(true);
    if (!w.equipPrimary('lmg')) throw new Error('LMG failed to equip');
  });
  await pump(60);
  assert.equal(
    await page.evaluate(() => window.evolysReview.w.viewmodel.active.animation.constructor.name),
    'EvolysAnimation'
  );
  await capture('hip');
  assert.equal(await beltCount(), 8);
  await setWeaponMode(page, 'evolysReview', 'ads');
  await pump(60);
  assert(
    await page.evaluate(() => {
      const vm = window.evolysReview.w.viewmodel;
      return vm.reticle.visible && !vm.scopeOverlay.visible && vm.adsT > 0.99;
    })
  );
  await capture('reflex-ads');
  await setWeaponMode(page, 'evolysReview', 'idle');
  await pump(40);
  await requestReload(page, 'evolysReview', { mag: 8 });
  await pump(104);
  await capture('reload-tactical-pouch');
  assert(
    await page.evaluate(() => {
      const a = window.evolysReview.w.viewmodel.active.animation;
      return a.spare.visible && !a.pouch.visible && !a.belt.visible;
    })
  );
  await pump(40);
  await capture('reload-tactical-feed');
  assert.equal(await beltCount(), 8);
  await pump(70);
  assert.equal(await page.evaluate(() => window.evolysReview.w.state.mag), 100);
  await requestReload(page, 'evolysReview', { mag: 0, chambered: false, reserve: 150 });
  await pump(150);
  await capture('reload-empty-pouch');
  assert.equal(await beltCount(), 0);
  await pump(55);
  await capture('reload-empty-feed');
  assert.equal(await beltCount(), 8);
  await pump(49);
  await capture('reload-empty-charge');
  await pump(50);
  assert.equal(await page.evaluate(() => window.evolysReview.w.ammo.mag), 100);
  assert(
    await page.evaluate(() => {
      const { w } = window.evolysReview;
      w.debugMode = null;
      return w.inspect();
    })
  );
  await pump(54);
  await capture('inspect');
  assert(await page.evaluate(() => window.evolysReview.w.tryFire()), 'fire interrupts inspect');
  await pump(8);
  await checkFireBurst(page, pump, capture, 'evolysReview');
  await page.evaluate(() => {
    const { w } = window.evolysReview;
    w.state.mag = 2;
    w.state.chambered = true;
  });
  await pump(8);
  assert.equal(await beltCount(), 3);
  for (let i = 2; i >= 0; i--) {
    assert(await page.evaluate(() => window.evolysReview.w.tryFire()));
    await pump(8);
    assert.equal(await beltCount(), i, 'post-shot tail reflects actual total ammunition');
  }
  await capture('empty');
  await page.evaluate(() => {
    window.evolysReview.w.setWeaponImmediate('pistol');
  });
  await pump(15);
  await page.evaluate(() => {
    window.evolysReview.w.setWeaponImmediate('lmg');
  });
  await pump(15);
  assert.equal(await beltCount(), 0, 'switch does not respawn empty ammunition');
  assert(await page.evaluate(() => window.evolysReview.w.reload()));
  await pump(90);
  await page.evaluate(() => {
    window.evolysReview.w._onPlayerDeath();
  });
  await pump(8);
  assert(
    await page.evaluate(() => {
      const a = window.evolysReview.w.viewmodel.active.animation;
      return (
        !a.spare.visible &&
        a.pouch.visible &&
        Math.abs(a.cover.rotation.y) < 0.001 &&
        !a.belt.visible
      );
    })
  );
  await page.evaluate(() => {
    const { w } = window.evolysReview;
    w.resetForNewGame();
    w.equipPrimary('lmg');
  });
  await pump(60);
  assert.equal(await beltCount(), 8, 'restart restores full short belt');
  assert.deepEqual(errors, []);
  const counts = await page.evaluate(() => ({
    shots: window.evolysReview.shots,
    shells: window.evolysReview.shells,
  }));
  assert.deepEqual(
    counts,
    { shots: 12, shells: 12 },
    'one shell event per shot, including the three runout shots'
  );
  const report = {
    ok: true,
    ...counts,
    render: await page.evaluate(() => window.__RENDER_INFO__),
    errors,
    warnings,
  };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await close();
}
