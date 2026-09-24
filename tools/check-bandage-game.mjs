#!/usr/bin/env node
/** In-engine bandage capture + cancellation/geometry regression. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BANDAGE_TURNS, BANDAGE_SEGMENTS, BANDAGE_CONTACT, BANDAGE_PATH } from '../src/weapons/bandage-path.js';
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
  let fixedLeft = null, lastOrbit = null;
  // Seed exact authored starts: the 20 fps capture can skip the first working
  // sample, but should still account for its angle rather than loosening 360°.
  let lastAngle = Math.atan2(BANDAGE_CONTACT[0][1], BANDAGE_CONTACT[0][0]);
  let lastWristAngle = Math.atan2(BANDAGE_PATH[0][1], BANDAGE_PATH[0][0]);
  let sweep = 0, wristSweep = 0, windingFrames = 0;
  let previousElbow = null;
  for (let i = 0; i < frames; i++) {
    await page.evaluate(n => window.__PUMP__(n), step);
    await page.evaluate(() => window.__PRESENT__());
    await page.screenshot({ path: `${out}/frame-${String(i).padStart(3, '0')}.png` });
    const state = await page.evaluate(() => {
      const ctx = window.__ENGINE__.ctx, vm = ctx.get('weapons').viewmodel;
      const a = vm.bandageAsset;
      vm.armL.forePivot.updateWorldMatrix(true, false);
      const inverse = vm.armL.forePivot.matrixWorld.clone().invert();
      const local = vm.armR.hand.getWorldPosition(a.roll.position.clone()).applyMatrix4(inverse);
      const roll = a.roll.getWorldPosition(a.roll.position.clone()).applyMatrix4(inverse);
      const fore = vm.armL.hand.position.clone().sub(vm.armL.forePivot.position).normalize();
      const upper = vm.armL.forePivot.position.clone().sub(vm.armL.shoulder).normalize();
      const fixed = [...vm.armL.hand.position, ...vm.armL.hand.quaternion,
        ...vm.armL.forePivot.position, ...vm.armL.forePivot.quaternion,
        ...vm.rig.position, ...vm.rig.quaternion];
      return { active: vm._bandageState, count: a.wrap.geometry.drawRange.count,
        tail: a.tail.visible, health: ctx.get('player').health.value,
        progress: vm._bandageProgress, fixed, horizontal: fore.x, bend: upper.dot(fore),
        angle: Math.atan2(roll.y, roll.x), wristAngle: Math.atan2(local.y, local.x),
        rollRadial: Math.hypot(roll.x, roll.y),
        radial: Math.hypot(local.x, local.y), rightElbow: vm.armR.forePivot.position.toArray(),
        lengthError: Math.max(...[vm.armL, vm.armR].flatMap(arm => [
          Math.abs(arm.forePivot.position.distanceTo(arm.shoulder) - arm.l1),
          Math.abs(arm.hand.position.distanceTo(arm.forePivot.position) - arm.l2)])),
        finite: a.tail.geometry.attributes.position.array.every(Number.isFinite) };
    });
    assert(state.finite && state.count >= 0 && state.count <= BANDAGE_SEGMENTS * 24,
      `bandage geometry went bad: ${JSON.stringify(state)}`);
    assert(state.active !== 1 || state.radial > .055,
      `wrapping wrist reached into the support sleeve: ${JSON.stringify(state)}`);
    if (state.active) {
      assert(state.lengthError < 1e-5, 'authored elbow hints must preserve both bone lengths');
      if (args.video && previousElbow) assert(Math.hypot(...state.rightElbow.map((v, j) => v - previousElbow[j])) < .12,
        `wrapping elbow must not snap: p=${state.progress}, ${previousElbow} -> ${state.rightElbow}`);
      previousElbow = state.rightElbow;
    }
    if (i === 20 * (3 / step)) assert(state.active === 1 && state.count > 0 && state.tail, JSON.stringify(state));
    if (state.active && state.progress >= .20 - 1e-6 && state.progress <= .82 + 1e-6) {
      windingFrames++;
      fixedLeft ??= state.fixed;
      assert(state.fixed.every((v, j) => Math.abs(v - fixedLeft[j]) < 1e-6),
        'left wrist, elbow, orientation and rig must stay fixed while winding');
      assert(state.horizontal > .999 && Math.abs(state.bend) < .5,
        `left forearm must be horizontal with a bent elbow: ${JSON.stringify(state)}`);
      assert(state.rollRadial > .055, 'roll must stay outside the support sleeve');
      const delta = Math.atan2(Math.sin(state.angle - lastAngle), Math.cos(state.angle - lastAngle));
      const wristDelta = Math.atan2(Math.sin(state.wristAngle - lastWristAngle), Math.cos(state.wristAngle - lastWristAngle));
      assert(delta <= .002 && wristDelta <= .002,
        'right hand and roll must wind in one direction, never retrace a near-side arc');
      sweep -= delta;
      wristSweep -= wristDelta;
      lastAngle = state.angle;
      lastWristAngle = state.wristAngle;
      if (lastOrbit) assert(state.count >= lastOrbit.count, 'dressing must not rewind');
      lastOrbit = state;
    }
    if (i === frames - 1) assert(state.health > 30 && state.active === 0, JSON.stringify(state));
  }
  assert(windingFrames > 30 && Math.abs(sweep - BANDAGE_TURNS * Math.PI * 2) < .005 &&
    Math.abs(wristSweep - BANDAGE_TURNS * Math.PI * 2) < .005,
    `expected ${BANDAGE_TURNS} full turns; roll=${sweep / (Math.PI * 2)}, wrist=${wristSweep / (Math.PI * 2)}`);
  await page.keyboard.up('KeyH');
  // Cancel another attempt mid-orbit (including the far side): the model and
  // loose cloth must clear immediately with no extra bandage spent.
  const count = await page.evaluate(() => window.__ENGINE__.ctx.get('player').bandages);
  await page.keyboard.down('KeyH');
  await page.evaluate(() => window.__PUMP__(65));
  await page.keyboard.up('KeyH');
  await page.evaluate(() => window.__PUMP__(3));
  assert(await page.evaluate(count => {
    const ctx = window.__ENGINE__.ctx, vm = ctx.get('weapons').viewmodel;
    return ctx.get('player').bandages === count && vm._bandageState === 0 &&
      vm.bandageAsset.wrap.geometry.drawRange.count === 0 && !vm.bandageAsset.roll.visible;
  }, count), 'cancel clears dressing without consuming it');
  assert.deepEqual(errors, []);
  console.log(`Bandage: ${frames} frames captured to ${out}; roll ${sweep / (2 * Math.PI)} turns, wrist ${wristSweep / (2 * Math.PI)} turns; fixed bent left arm; healed and stowed; no browser errors`);
} finally {
  await browser.close(); stopViteServer(server);
}
