import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  portOpen,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame, captureNative } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5488);
assert.equal(await portOpen(port), false, 'use a dedicated server for this worktree');
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true });
const out = args.out ? resolve(String(args.out)) : null;
if (out) await mkdir(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /GPUValidationError|validation error|Error while parsing WGSL/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.route('**/src/core/engine.ts', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const marker = 'renderSystem.render(this.ctx);';
    assert(body.includes(marker));
    await route.fulfill({
      response,
      body: body.replace(
        marker,
        `
      window.__RUN_RENDERS__ ??= [];
      if (window.__RUN_RENDERS__.length < 1000) window.__RUN_RENDERS__.push({
        suspended: this.gameplaySuspended, visible: this.viewScene.visible,
        elapsed: this.time.elapsed, dt: this.time.dt,
        pose: this.ctx.get('weapons').__TEST_POSES__ ?? 0,
        input: [...this.input.down], wheel: this.input.wheel
      });
      ${marker}`
      ),
    });
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await waitForGame(page, { timeout: 180000 });
  await page.evaluate(() => {
    const e = window.__ENGINE__,
      w = e.ctx.get('weapons');
    window.__CLEAR_HOOKS__ = [e.viewScene.onBeforeRender, e.viewScene.onAfterRender];
    window.__RUN_EVENTS__ = { fire: 0, damage: 0 };
    e.events.on('weapon:fire', () => window.__RUN_EVENTS__.fire++);
    e.events.on('damage:taken', () => window.__RUN_EVENTS__.damage++);
    const pose = w.lateUpdate.bind(w);
    w.lateUpdate = (...args) => {
      w.__TEST_POSES__ = (w.__TEST_POSES__ ?? 0) + 1;
      return pose(...args);
    };
  });
  const snapshot = () =>
    page.evaluate(() => {
      const e = window.__ENGINE__;
      return {
        elapsed: e.time.elapsed,
        player: e.ctx.get('player').position.toArray(),
        health: e.ctx.get('player').health.value,
        agents: e.ctx.get('ai').agents.map((a) => a.position.toArray()),
        events: { ...window.__RUN_EVENTS__ },
        pose: e.ctx.get('weapons').__TEST_POSES__ ?? 0,
      };
    });
  const before = await snapshot();
  await page.keyboard.down('KeyW');
  await page.keyboard.press('Escape');
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(1000);
  assert.deepEqual(
    await snapshot(),
    before,
    'no AI/movement/fire/damage/clock/pose while awaiting intent'
  );
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').menu.open), false);
  assert(await page.getByRole('button', { name: 'START', exact: true }).isVisible());
  const viewPixels = () =>
    page.evaluate(async () => {
      const r = window.__ENGINE__.ctx.get('render');
      const target = r._graph.viewPass.renderTarget;
      const pixels = await r.renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        target.width,
        target.height
      );
      let alpha = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) alpha++;
      return alpha;
    });
  assert.equal(
    await viewPixels(),
    0,
    'actual waiting view pass is transparent, not a stale weapon'
  );
  if (out) await captureNative(page, resolve(out, 'after-awaiting-start.png'));
  // Resolving a request without actual acquisition is deliberately insufficient.
  await page.evaluate(() => {
    const canvas = window.__ENGINE__.canvas;
    window.__REQUEST_LOCK__ = canvas.requestPointerLock.bind(canvas);
    canvas.requestPointerLock = () => Promise.resolve();
  });
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.waitForTimeout(300);
  assert.deepEqual(await snapshot(), before);
  // Denied request, then a repeated accessible keyboard retry.
  await page.evaluate(() => {
    window.__ENGINE__.canvas.requestPointerLock = () => Promise.reject(Error('test denial'));
  });
  await page.getByRole('button', { name: 'RETRY START' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('status').filter({ hasText: 'Mouse capture unavailable' }).waitFor();
  assert.deepEqual(await snapshot(), before);
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.canvas.requestPointerLock = window.__REQUEST_LOCK__;
    e.input._pendingDown.add('Mouse0');
    e.input._pendingDown.add('Space');
    e.input._pendingDown.add('KeyW');
    e.input._pendingWheel = 1;
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.__ENGINE__.gameplaySuspended);
  await page.keyboard.up('KeyW');
  await page.waitForFunction(() => window.__RUN_RENDERS__.some((r) => !r.suspended));
  const firstActive = await page.evaluate(() => window.__RUN_RENDERS__.find((r) => !r.suspended));
  assert.equal(firstActive.visible, true);
  assert(firstActive.pose > 0, 'normal pose hooks run before first active render');
  assert.deepEqual(firstActive.input, []);
  assert.equal(firstActive.wheel, 0);
  assert.equal(await page.evaluate(() => window.__RUN_EVENTS__.fire), 0);
  // The existing draw clip starts below the screen. The separate frame-sequence
  // regression compares earliest composed frames against the pre-integration base.
  await page.waitForFunction(() => window.__ENGINE__.ctx.get('weapons').viewmodel.clipT >= 0.2);
  assert((await viewPixels()) > 0, 'normal draw animation brings first-person geometry into view');
  if (out) await captureNative(page, resolve(out, 'after-active.png'));
  // Existing pointer-loss pause and shop cleanup remain authoritative once active.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => window.__ENGINE__.ctx.get('ui').menu.open);
  assert.equal(await page.evaluate(() => window.__ENGINE__.time.scale), 0);
  await page.locator('.ow-menu .ow-btn.primary').click();
  await page.waitForFunction(() => document.pointerLockElement === window.__ENGINE__.canvas);
  await page.evaluate(() => window.__ENGINE__.ctx.get('market').openShop(1));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__ENGINE__.ctx.get('market').open);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').menu.open), false);
  // Exercise the real New Game callback for three resets, including an already-held lock.
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate(() => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui');
      window.__RESET_SUSPENDED__ = null;
      window.__RESET_OFF__?.();
      window.__RESET_OFF__ = e.events.on('game:restart', () => {
        window.__RESET_SUSPENDED__ = e.gameplaySuspended;
      });
      ui.gameOver.active = true;
      ui.gameOver.elapsed = ui.gameOver.delay;
    });
    // New Game's public keyboard consumer is the same synchronous path as its native button.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__RESET_SUSPENDED__ === true);
    if (await page.evaluate(() => window.__ENGINE__.gameplaySuspended)) {
      await page.getByRole('button', { name: 'RETRY START' }).click();
    }
    await page.waitForFunction(() => !window.__ENGINE__.gameplaySuspended);
    assert.equal(
      await page.evaluate(() => document.pointerLockElement === window.__ENGINE__.canvas),
      true
    );
    assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('player').dead), false);
  }
  assert.equal(
    await page.evaluate(() => {
      const e = window.__ENGINE__;
      return (
        window.__CLEAR_HOOKS__[0] === e.viewScene.onBeforeRender &&
        window.__CLEAR_HOOKS__[1] === e.viewScene.onAfterRender
      );
    }),
    true,
    'do not replace renderer clear callbacks'
  );
  assert.deepEqual(errors, []);
  // A queued held-lock restart followed synchronously by terminal failure may not activate.
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.ctx.get('ui').startGate.restart();
    e.fail('start-gate-test', 'validation', Error('intentional terminal failure'));
  });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__ENGINE__.gameplaySuspended), true);
  assert.equal(await page.evaluate(() => window.__ENGINE__.input.enabled), false);
  assert(await page.locator('#engine-failure').evaluate((el) => el.matches(':modal')));
  assert.equal(await page.locator('#run-start').evaluate((el) => el.open), false);
  await page.evaluate(() => window.__ENGINE__.dispose());
  assert.equal(await page.locator('#run-start').count(), 0);
  console.log(
    'start-gate-e2e: ok (normal wait, transparent view, pending/denied/retry, input flush, active pose/render, pause/shop, 3 held-lock restarts, terminal/dispose)'
  );
} finally {
  await browser.close();
  stopViteServer(server);
}
