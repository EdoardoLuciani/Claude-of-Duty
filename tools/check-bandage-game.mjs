#!/usr/bin/env node
/** In-engine bandage capture + cancellation/geometry regression. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs();
const port = Number(args.port ?? 5198), out = resolve(args.out ?? '/tmp/cod-bandage-capture');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await page.evaluate(() => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx;
    ctx.get('player').health.value = 30;
    ctx.get('player').setControlEnabled(true);
    ctx.input.enabled = true;
    ctx.input.frozen = false;
  });
  await page.evaluate(() => window.__PUMP__(25));
  await page.keyboard.down('KeyH');
  const frames = args.video ? 195 : 65;
  const step = args.video ? 1 : 3;
  const regrips = [];
  for (let i = 0; i < frames; i++) {
    await page.evaluate(n => window.__PUMP__(n), step);
    await page.evaluate(() => window.__PRESENT__());
    await page.screenshot({ path: `${out}/frame-${String(i).padStart(3, '0')}.png` });
    const state = await page.evaluate(() => {
      const ctx = window.__ENGINE__.ctx, vm = ctx.get('weapons').viewmodel;
      const a = vm.bandageAsset;
      const wrist = (arm) => arm.hand.position.clone().applyMatrix4(vm.rig.matrixWorld)
        .project(ctx.viewCamera);
      const left = wrist(vm.armL), right = wrist(vm.armR);
      return { active: vm._bandageState, count: a.wrap.geometry.drawRange.count,
        tail: a.tail.visible, health: ctx.get('player').health.value, rightY: right.y,
        crossed: vm._bandageState === 1 && right.x < left.x + .015,
        finite: a.tail.geometry.attributes.position.array.every(Number.isFinite) };
    });
    assert(state.finite && !state.crossed && state.count >= 0 && state.count <= 2880,
      `wrapping wrist crossed supporting arm: ${JSON.stringify(state)}`);
    if (i === 20 * (3 / step)) assert(state.active === 1 && state.count > 0 && state.tail, JSON.stringify(state));
    if (args.video && [63, 66, 115, 118].includes(i)) regrips.push(state);
    if (i === frames - 1) assert(state.health > 30 && state.active === 0, JSON.stringify(state));
  }
  if (args.video) {
    for (let i = 0; i < regrips.length; i += 2) {
      assert.equal(regrips[i].count, regrips[i+1].count, 'cloth waits for the right hand to regrip');
      assert(Math.abs(regrips[i].rightY - regrips[i+1].rightY) > .01,
        'right hand visibly moves to regrip while payout stops');
    }
  }
  await page.keyboard.up('KeyH');
  // A second attempt is canceled by release: the model and loose cloth must
  // clear immediately with no extra bandage spent.
  const count = await page.evaluate(() => window.__ENGINE__.ctx.get('player').bandages);
  await page.keyboard.down('KeyH');
  await page.evaluate(() => window.__PUMP__(30));
  await page.keyboard.up('KeyH');
  await page.evaluate(() => window.__PUMP__(3));
  assert(await page.evaluate(count => {
    const ctx = window.__ENGINE__.ctx, vm = ctx.get('weapons').viewmodel;
    return ctx.get('player').bandages === count && vm._bandageState === 0 &&
      vm.bandageAsset.wrap.geometry.drawRange.count === 0 && !vm.bandageAsset.roll.visible;
  }, count), 'cancel clears dressing without consuming it');
  assert.deepEqual(errors, []);
  console.log(`Bandage: ${frames} frames captured to ${out}; healed and stowed; no browser errors`);
} finally {
  await browser.close(); stopViteServer(server);
}
