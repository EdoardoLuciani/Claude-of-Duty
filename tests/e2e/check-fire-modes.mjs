#!/usr/bin/env node
// Issue 471: selectable SEMI/AUTO through the real B binding and left mouse
// button, with the HUD badge read back from the DOM. Scripted `tryFire()` calls
// prove nothing about input, so this drives the browser event path instead.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../../tools/lib/browser-harness.mjs';
import { openGameReview } from '../../tools/lib/game-review.mjs';

const args = parseArgs(),
  port = Number(args.port ?? 5243),
  out = resolve(args.out ?? '.tmp-rend/fire-modes');
const { page, errors, warnings, pump, boot, close } = await openGameReview({ port, out });

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
  // Capture mode freezes input for scripted shots; this check exercises the
  // real keyboard/mouse path, so hand live control back to the player.
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx,
      w = ctx.get('weapons');
    window.fireModes = { w, shots: 0 };
    ctx.events.on('weapon:fire', () => window.fireModes.shots++);
    ctx.input.frozen = false;
    ctx.input.enabled = true;
    ctx.get('player').setControlEnabled(true);
    if (!w.equipPrimary('lmg')) throw new Error('EVOLYS failed to equip');
  });
  await pump(30);

  const badge = () => page.evaluate(() => document.querySelector('.ow-ammo-mode').textContent);
  const mode = () => page.evaluate(() => window.fireModes.w.fireMode);
  const shots = () => page.evaluate(() => window.fireModes.shots);
  const { width, height } = page.viewportSize();
  const hold = async (frames) => {
    await page.mouse.down();
    await pump(frames);
    const fired = await shots();
    await page.mouse.up();
    await pump(20);
    return fired;
  };

  assert.equal(await mode(), 'auto', 'EVOLYS starts on its authored first mode');
  assert.equal(await badge(), 'AUTO', 'HUD badge reads AUTO');

  // A canvas click is the gameplay focus/lock request; it fires, so take the
  // baseline afterwards.
  await page.mouse.click(width / 2, height / 2);
  await pump(30);

  // B through the real keyboard path selects SEMI and the HUD follows.
  await page.keyboard.press('b');
  await pump(2);
  assert.equal(await mode(), 'semi', 'B selects SEMI on the EVOLYS');
  assert.equal(await badge(), 'SEMI', 'HUD badge follows the selector immediately');

  // Held trigger in SEMI: exactly one round, then nothing.
  const semi0 = await shots();
  const heldOnce = await hold(60);
  assert.equal(heldOnce - semi0, 1, 'holding fire in SEMI fires one round');
  await page.screenshot({ path: `${out}/evolys-semi.png` });

  // Release + press fires the next single round.
  const pressAgain = await hold(20);
  assert.equal(pressAgain - semi0, 2, 'a fresh press fires the next single round');

  // B returns to AUTO: the held trigger is continuous again.
  await page.keyboard.press('b');
  await pump(2);
  assert.equal(await mode(), 'auto', 'B cycles back to AUTO');
  assert.equal(await badge(), 'AUTO', 'HUD badge follows the selector back');
  const auto0 = await shots();
  const heldAuto = await hold(60);
  assert(heldAuto - auto0 >= 8, `AUTO stays continuous while held (${heldAuto - auto0} rounds)`);
  await page.screenshot({ path: `${out}/evolys-auto.png` });

  // The M4A1 burst is unchanged by the selector work.
  await page.evaluate(() => {
    const w = window.fireModes.w;
    w.setWeaponImmediate('rifle');
    w.state.modeIndex = 0;
    w.state.mode = w.state.def.modes[0];
  });
  await pump(20);
  await page.keyboard.press('b');
  await pump(2);
  assert.equal(await mode(), 'burst', 'B selects BURST on the M4A1');
  assert.equal(await badge(), 'BURST');
  const burst0 = await shots();
  const heldBurst = await hold(45);
  assert.equal(heldBurst - burst0, 3, 'one press still delivers a three-round burst');

  const report = {
    ok: true,
    modes: await page.evaluate(() =>
      Object.fromEntries([...window.fireModes.w.states].map(([id, state]) => [id, state.def.modes]))
    ),
    rounds: {
      semiHeldTrigger: 1,
      semiTwoPresses: 2,
      autoHeldTrigger: heldAuto - auto0,
      burstSinglePress: heldBurst - burst0,
    },
    errors,
    warnings,
  };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await close();
}
