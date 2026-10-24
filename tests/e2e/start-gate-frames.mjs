// Compare the exact first composed frames, without re-rendering for capture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
const out = resolve(String(args.out ?? '/tmp/issue488-frames'));
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
await mkdir(out, { recursive: true });
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
        const output = new r.viewRt.constructor(r.screenSize.width, r.screenSize.height);
        const setTarget = r.renderer.setRenderTarget.bind(r.renderer);
        r.renderer.setRenderTarget = (target, ...args) => setTarget(target ?? output, ...args);
        window.__FRAME_DRAWS__ = 0;
        this.viewScene.traverse(o => { if (o.isMesh && !o.__FRAME_PROBE__) { o.__FRAME_PROBE__ = true; const before = o.onBeforeRender; o.onBeforeRender = function(...args) { window.__FRAME_DRAWS__++; before.apply(this,args); }; } });
        try { ${marker} } finally { r.renderer.setRenderTarget = setTarget; setTarget(null); }
        const view = r._graph.viewPass.renderTarget;
        const result = { run: window.__FRAME_RUN__, index, frame: this.time.frame,
          poseFrame: window.__POSE_FRAME__, draws: window.__FRAME_DRAWS__,
          viewVisible: this.viewScene.visible, camera: this.viewCamera.position.toArray(),
          anchor: this.ctx.get('weapons').viewmodel.anchor.position.toArray(),
          clip: this.ctx.get('weapons').viewmodel.clipName,
          clipT: this.ctx.get('weapons').viewmodel.clipT,
          rig: this.ctx.get('weapons').viewmodel.rig.position.toArray() };
        window.__COMPOSED__.push(Promise.all([
          r.renderer.readRenderTargetPixelsAsync(output, 0, 0, output.width, output.height),
          r.renderer.readRenderTargetPixelsAsync(view, 0, 0, view.width, view.height)
        ]).then(([pixels, viewPixels]) => {
          const canvas = document.createElement('canvas'); canvas.width = output.width; canvas.height = output.height;
          canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), output.width, output.height), 0, 0);
          let alpha = 0; for (let i = 3; i < viewPixels.length; i += 4) if (viewPixels[i] !== 0) alpha++;
          output.dispose(); return {...result, alpha, image: canvas.toDataURL()};
        }));
      } else { ${marker} }
      `
      ),
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?deterministic=1`);
  await waitForGame(page, { timeout: 180000 });
  if (!args.baseline) {
    assert.equal(await page.evaluate(() => window.__ENGINE__.gameplaySuspended), true);
    await page.getByRole('button', { name: 'START', exact: true }).click();
  }
  await page.waitForFunction(() => window.__FRAME_INDEX__ >= 12);
  const saveFrames = async (label) => {
    const records = await page.evaluate(() => Promise.all(window.__COMPOSED__));
    for (const record of records) {
      const { image, ...metadata } = record;
      await writeFile(
        resolve(out, `${label}-${record.index}.png`),
        Buffer.from(image.split(',')[1], 'base64')
      );
      assert.deepEqual(metadata.camera, metadata.anchor, 'pose and view camera synced');
      assert.equal(metadata.poseFrame, metadata.frame, 'normal pose hook precedes render');
      assert(metadata.draws > 0, 'view meshes submitted on earliest active frame');
    }
    return records.map((record) => {
      const metadata = { ...record };
      delete metadata.image;
      return metadata;
    });
  };
  const start = await saveFrames('start');
  if (args.baseline) await page.locator('#game').click({ position: { x: 20, y: 20 } });
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
    if (deny && !args.baseline) {
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
  const heldRestart = await saveFrames('held-restart');
  await reset(true);
  const retryRestart = await saveFrames('retry-restart');
  for (const sequence of [start, heldRestart, retryRestart]) {
    assert.equal(sequence.length, 12);
    assert.equal(
      sequence.findIndex((frame) => frame.alpha > 0),
      7,
      'existing draw clip enters view on eighth active 60Hz frame'
    );
    assert(sequence.every((frame) => frame.viewVisible && frame.clip === 'draw'));
  }
  const summary = {
    root,
    revision,
    timing:
      'Engine diagnostic step forced to 1/60s on both revisions; native final output redirected, no extra draw',
    start,
    heldRestart,
    retryRestart,
  };
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'frames.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
  stopViteServer(server);
}
