// Verify native first-person frames and pose order without an extra render.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  portOpen,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5489);
const root = resolve(String(args.root ?? '.'));
assert.equal(await portOpen(port), false);
const server = await ensureViteServer({ port, root });
const browser = await launchChromium({ headless: true });
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
    const source = await response.text();
    assert(source.includes('step(now = performance.now()) {'));
    const body = source
      .replace(
        'step(now = performance.now()) {',
        'step(now = performance.now()) { this._last = now - 1000 / 60;'
      )
      .replace(
        'sys[method]?.(arg, this.ctx);',
        `sys[method]?.(arg, this.ctx); if (method === 'lateUpdate' && sys === this.ctx.peek('weapons')) window.__POSE_FRAME__ = this.time.frame;`
      );
    const marker = 'renderSystem.render(this.ctx);';
    assert(body.includes(marker));
    await route.fulfill({
      response,
      body: body.replace(
        marker,
        `
      const r = renderSystem;
      window.__FRAME_RUN__ ??= 0;
      window.__FRAME_INDEX__ ??= 0;
      window.__COMPOSED__ ??= [];
      if (!this.gameplaySuspended && window.__FRAME_INDEX__ < 12) {
        const index = window.__FRAME_INDEX__++;
        window.__FRAME_DRAWS__ = 0;
        this.viewScene.traverse(o => { if (o.isMesh && !o.__FRAME_PROBE__) { o.__FRAME_PROBE__ = true; const before = o.onBeforeRender; o.onBeforeRender = function(...args) { window.__FRAME_DRAWS__++; before.apply(this,args); }; } });
        ${marker}
        const view = r._graph.viewPass.renderTarget;
        const result = { run: window.__FRAME_RUN__, index, frame: this.time.frame,
          poseFrame: window.__POSE_FRAME__, draws: window.__FRAME_DRAWS__,
          viewVisible: this.viewScene.visible, camera: this.viewCamera.position.toArray(),
          anchor: this.ctx.get('weapons').viewmodel.anchor.position.toArray(),
          clip: this.ctx.get('weapons').viewmodel.clipName,
          clipT: this.ctx.get('weapons').viewmodel.clipT,
          rig: this.ctx.get('weapons').viewmodel.rig.position.toArray() };
        window.__COMPOSED__.push(
          r.renderer.readRenderTargetPixelsAsync(view, 0, 0, view.width, view.height).then(pixels => {
            let alpha = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) alpha++;
            return {...result, alpha};
          })
        );
      } else { ${marker} }
      `
      ),
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?deterministic=1`);
  await waitForGame(page, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.__ENGINE__.gameplaySuspended), true);
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.waitForFunction(() => window.__FRAME_INDEX__ >= 12);
  const checkFrames = async () => {
    const records = await page.evaluate(() => Promise.all(window.__COMPOSED__));
    for (const frame of records) {
      assert.deepEqual(frame.camera, frame.anchor, 'pose and view camera synced');
      assert.equal(frame.poseFrame, frame.frame, 'normal pose hook precedes render');
      assert(frame.draws > 0, 'view meshes submitted on earliest active frame');
    }
    return records;
  };
  const start = await checkFrames();
  await page.waitForFunction(() => document.pointerLockElement === window.__ENGINE__.canvas);
  // Real New Game callback with actual held lock, then a denied/retried reset.
  const reset = async (deny) => {
    await page.evaluate((deny) => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui');
      window.__FRAME_RESET_OFF__?.();
      window.__FRAME_RESET_OFF__ = e.events.on('game:restart', () => {
        window.__FRAME_RUN__++;
        window.__FRAME_INDEX__ = 0;
        window.__COMPOSED__ = [];
      });
      if (deny) {
        e.ctx.get('player').applyDamage(10000, null);
        window.__REQUEST_LOCK__ = e.canvas.requestPointerLock.bind(e.canvas);
        e.canvas.requestPointerLock = () => Promise.resolve();
      }
      ui.gameOver.active = true;
      ui.gameOver.elapsed = ui.gameOver.delay;
    }, deny);
    if (deny) await page.waitForFunction(() => !document.pointerLockElement);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__ENGINE__.gameplaySuspended), true);
    assert.equal(await page.evaluate(() => window.__FRAME_INDEX__), 0);
    await page.getByRole('button', { name: 'START', exact: true }).focus();
    await page.keyboard.press('Space');
    if (deny) {
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__FRAME_INDEX__), 0);
      await page.evaluate(() => {
        window.__ENGINE__.canvas.requestPointerLock = window.__REQUEST_LOCK__;
      });
      await page.getByRole('button', { name: 'RETRY START' }).click();
    }
    await page.waitForFunction(() => window.__FRAME_INDEX__ >= 12);
  };
  await reset(false);
  const heldRestart = await checkFrames();
  await reset(true);
  const retryRestart = await checkFrames();
  for (const sequence of [start, heldRestart, retryRestart]) {
    assert.equal(sequence.length, 12);
    assert.equal(
      sequence.findIndex((frame) => frame.alpha > 0),
      7,
      'existing draw clip enters view on eighth active 60Hz frame'
    );
    assert(sequence.every((frame) => frame.viewVisible && frame.clip === 'draw'));
  }
  assert.deepEqual(errors, []);
  console.log('PASS initial/held-lock/retry frames: native visibility, draw timing and pose order');
} finally {
  await browser.close();
  stopViteServer(server);
}
