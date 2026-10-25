import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  collectBrowserErrors,
  stopViteServer,
  parseArgs,
} from '../../tools/lib/browser-harness.mjs';
import { captureNative, waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5183);
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  collectBrowserErrors(page, errors);
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1`);
  await waitForGame(page);
  // Baseline boot has two upstream inline-Fn warnings; inspection must add none.
  page.on('console', (message) => {
    if (
      message.type() !== 'error' &&
      /GPUValidationError|validation error|THREE\.TSL|Error while parsing WGSL/i.test(
        message.text()
      )
    )
      errors.push(message.text());
  });
  await page.evaluate(async () => {
    window.__ENGINE__.ctx.get('ui').debugState('market');
    await window.__PUMP__(30);
  });
  const state = () =>
    page.evaluate(() => {
      const ctx = window.__ENGINE__.ctx;
      const w = ctx.get('weapons');
      const p = ctx.get('ui').shop.inspection;
      return {
        credits: ctx.get('market').credits,
        primary: w.primaryId,
        secondary: w.secondaryId,
        active: w.activeId,
        scale: ctx.time.scale,
        raw: ctx.time.raw,
        preview: p.activeId,
        model: !!p.model,
        failed: p.failed,
        camera: p.camera.position.toArray(),
        target: p.controls.target.toArray(),
        distance: p.camera.position.distanceTo(p.controls.target),
        min: p.controls.minDistance,
        max: p.controls.maxDistance,
      };
    });
  const initial = await state();
  assert.equal(initial.scale, 0);
  // All seven weapons, including equipped/unaffordable cards, are focusable.
  await page.evaluate(() => {
    window.__ENGINE__.ctx.get('market').credits = 0;
  });
  for (const id of ['pistol', 'smg', 'shotgun', 'rifle', 'mcx', 'lmg', 'sniper']) {
    await page.locator(`[data-item="${id}"]`).focus();
    await page.waitForFunction((id) => {
      const p = window.__ENGINE__.ctx.get('ui').shop.inspection;
      return p.activeId === id && (p.model !== null || p.failed);
    }, id);
    await page.evaluate(() => window.__PUMP__(2));
    const s = await state();
    assert.equal(s.failed, false, id + ' preview renders');
    assert.equal(s.model, true);
    assert.equal(s.credits, 0);
    assert.equal(s.primary, initial.primary);
    assert.equal(s.secondary, initial.secondary);
  }
  // Hover changes previews before selection; click pins without a purchase.
  await page.locator('[data-item="mcx"]').hover();
  await page.waitForFunction(
    () => window.__ENGINE__.ctx.get('ui').shop.inspection.activeId === 'mcx'
  );
  await page.locator('[data-item="mcx"] .ow-market-name').click();
  await page.locator('[data-item="rifle"]').hover();
  assert.equal((await state()).preview, 'mcx', 'selection survives crossing other cards');
  const canvas = page.locator('.ow-market-inspect-canvas');
  await canvas.focus();
  const before = await state();
  await page.keyboard.press('ArrowRight');
  assert.notDeepEqual((await state()).camera, before.camera);
  await page.keyboard.press('Shift+ArrowUp');
  assert.deepEqual((await state()).target, before.target, 'modified arrows never pan');
  await page.keyboard.press('Home');
  const reset = await state();
  assert.deepEqual(reset.target, [0, 0, 0]);
  for (let i = 0; i < 35; i++) await page.keyboard.press('+');
  assert(Math.abs((await state()).distance - reset.min) < 1e-6);
  for (let i = 0; i < 45; i++) await page.keyboard.press('-');
  assert(Math.abs((await state()).distance - reset.max) < 1e-6);
  await page.keyboard.press('Home');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
  assert.notDeepEqual((await state()).camera, reset.camera, 'pointer rotation');
  assert.equal(await page.getByRole('button', { name: 'PAN', exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => window.__ENGINE__.ctx.get('ui').shop.inspection.controls.enablePan),
    false,
    'native mouse and touch panning disabled'
  );
  const rotated = await state();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  assert.deepEqual((await state()).target, [0, 0, 0], 'right-drag cannot pan');
  assert.deepEqual((await state()).camera, rotated.camera, 'right-drag leaves the orbit unchanged');
  for (const modifier of ['Shift', 'Control', 'Meta']) {
    await page.keyboard.down(modifier);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up(modifier);
    assert.deepEqual((await state()).target, [0, 0, 0], modifier + '-drag cannot pan');
  }
  const preZoom = (await state()).distance;
  await page.mouse.wheel(0, -100);
  assert((await state()).distance < preZoom, 'wheel zoom');
  assert.equal((await state()).credits, 0);
  await page.getByRole('button', { name: 'RESET', exact: true }).click();
  await page.evaluate(() => window.__PUMP__(3));
  if (args.out) {
    await page.evaluate(async () => {
      window.__ENGINE__.ctx.get('market').credits = 1850;
      await window.__PUMP__(2);
    });
    await page.evaluate(async () => {
      const p = window.__ENGINE__.ctx.get('ui').shop.inspection;
      const { RenderTarget } = await import('/node_modules/three/src/Three.WebGPU.js');
      const target = new RenderTarget(p.width, p.height);
      const r = p.renderer;
      r.setOutputRenderTarget(target);
      r.render(p.scene, p.camera);
      const pixels = await r.readRenderTargetPixelsAsync(target, 0, 0, p.width, p.height);
      r.setOutputRenderTarget(null);
      target.dispose();
      const overlay = document.createElement('canvas');
      overlay.id = 'inspection-test-capture';
      overlay.width = p.width;
      overlay.height = p.height;
      overlay.style.cssText = 'position:absolute;pointer-events:none;';
      overlay.style.left = p.canvas.offsetLeft + 'px';
      overlay.style.top = p.canvas.offsetTop + 'px';
      overlay
        .getContext('2d')
        .putImageData(new ImageData(new Uint8ClampedArray(pixels), p.width, p.height), 0, 0);
      p.root.append(overlay);
    });
    await captureNative(page, resolve(String(args.out)));
    await page.evaluate(() => document.getElementById('inspection-test-capture').remove());
  }

  // Explicit purchase remains authoritative; resupply retains card-click behavior.
  await page.evaluate(() => {
    window.__ENGINE__.ctx.get('market').credits = 2000;
  });
  await page.evaluate(() => window.__PUMP__(2));
  await page.locator('[data-item="mcx"] .ow-market-buy').click();
  assert.equal((await state()).credits, 900);
  await page.locator('[data-item="grenade"] .ow-market-name').click();
  assert.equal((await state()).credits, 700);
  const renderer = await page.evaluateHandle(
    () => window.__ENGINE__.ctx.get('ui').shop.inspection.renderer
  );
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const p = ctx.get('ui').shop.inspection;
    return {
      open: ctx.get('market').open,
      scale: ctx.time.scale,
      model: p.model,
      enabled: p.controls.enabled,
    };
  });
  assert.deepEqual(closed, { open: false, scale: 1, model: null, enabled: false });
  // Reopen, keyboard-select cards, then restart while an async selection is pending.
  await page.evaluate(() => {
    window.__ENGINE__.ctx.get('market').openShop(4);
  });
  await page.locator('[data-item="rifle"]').focus();
  await page.keyboard.press('Enter');
  assert.equal((await state()).preview, 'rifle');
  await page.locator('[data-item="lmg"]').focus();
  await page.keyboard.press('Space');
  assert.equal((await state()).preview, 'lmg');
  assert.equal((await state()).credits, 700, 'keyboard selection never purchases');
  await page.evaluate(async () => {
    const shop = window.__ENGINE__.ctx.get('ui').shop;
    await Promise.all(['rifle', 'pistol', 'lmg'].map((id) => shop.inspection.select(id, id)));
  });
  assert.equal((await state()).preview, 'lmg');
  assert(
    await page.evaluate(
      (r) => r === window.__ENGINE__.ctx.get('ui').shop.inspection.renderer,
      renderer
    ),
    'one renderer reused'
  );
  await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx;
    const task = ctx.get('ui').shop.inspection.select('sniper', 'sniper');
    ctx.get('market').reset();
    await task;
  });
  assert.equal((await state()).model, false);
  assert.equal((await state()).credits, 0);
  // A failed preview must not disable the ordinary shop.
  await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx;
    ctx.get('market').openShop(5);
    const w = ctx.get('weapons');
    const original = w.createInspectionModel;
    w.createInspectionModel = () => Promise.reject(new Error('fixture preview failure'));
    try {
      await ctx.get('ui').shop.inspection.select('rifle', 'rifle');
    } finally {
      w.createInspectionModel = original;
    }
    ctx.get('market').credits = 2000;
    await window.__PUMP__(2);
  });
  assert.equal((await state()).failed, true);
  await page.locator('[data-item="grenade"] .ow-market-buy').click();
  assert.equal((await state()).credits, 1800);
  await page.keyboard.press('Escape');
  // Terminal failure must stop inspection without resuming the run.
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.get('market').openShop(5);
    ctx.events.emit('engine:error', { message: 'inspection lifecycle test' });
  });
  assert.equal((await state()).model, false);
  assert.equal((await state()).scale, 0);
  assert.deepEqual(errors, []);
  console.log(
    'Market inspection: seven weapons, paused controls, selection, purchases, resource reuse and lifecycle passed.'
  );
} finally {
  await browser.close();
  stopViteServer(server);
}
