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
  // Every supply is inspectable even with a disabled BUY button, without starting WebGPU.
  await page.evaluate(() => {
    window.__ENGINE__.ctx.get('market').credits = 0;
  });
  for (const id of ['bandage', 'ammo', 'grenade', 'armour', 'carpet']) {
    await page.locator(`[data-item="${id}"]`).focus();
    await page.waitForFunction((id) => {
      const p = window.__ENGINE__.ctx.get('ui').shop.inspection;
      return p.activeId === id && p.image?.naturalWidth === 960 && !p.image.hidden;
    }, id);
    assert.equal((await state()).credits, 0);
    assert.equal((await state()).model, false);
    assert.equal(await page.locator('.ow-market-inspect-canvas').isVisible(), false);
    assert.equal(await page.locator('.ow-market-inspect-3d').isVisible(), false);
    assert(await page.locator('.ow-market-inspect-art').getAttribute('alt'));
    assert.equal(
      await page.evaluate(() => window.__ENGINE__.ctx.get('ui').shop.inspection.renderer),
      null,
      'illustrations never initialize the 3D renderer'
    );
    if (args.artOut) {
      await page.evaluate(async () => {
        window.__ENGINE__.ctx.get('market').credits = 1850;
        await window.__PUMP__(2);
      });
      await captureNative(page, resolve(`${args.artOut}-${id}.png`));
      await page.evaluate(async () => {
        window.__ENGINE__.ctx.get('market').credits = 0;
        await window.__PUMP__(2);
      });
    }
  }
  await page.locator('[data-item="bandage"] .ow-market-name').click();
  await page.locator('[data-item="rifle"]').hover();
  assert.equal((await state()).preview, 'bandage', 'supply selection pins without purchasing');
  assert.equal((await state()).credits, 0);
  await page.locator('[data-item="ammo"]').focus();
  await page.keyboard.press('Space');
  assert.equal((await state()).preview, 'ammo', 'keyboard selects supplies without purchasing');
  assert.equal((await state()).credits, 0);
  // A genuine decode error leaves a clear fallback, not a stale image or 3D controls.
  await page.evaluate(() => {
    window.__ENGINE__.ctx.get('ui').shop.inspection.image.src = 'data:image/webp;base64,AA==';
  });
  await page.waitForFunction(() =>
    window.__ENGINE__.ctx
      .get('ui')
      .shop.inspection.status.textContent.includes('Artwork unavailable')
  );
  assert.equal(await page.locator('.ow-market-inspect-art').isVisible(), false);
  assert.equal(await page.locator('.ow-market-inspect-3d').isVisible(), false);
  await page.evaluate(() => {
    const market = window.__ENGINE__.ctx.get('market');
    market.closeShop();
    market.openShop(3);
  });
  assert.equal(await page.locator('.ow-market-inspect-art').count(), 0, 'close clears artwork');

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

  // Rendered clones must release object records/bindings, not just share geometry caches.
  const lifetime = await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx;
    const market = ctx.get('market');
    const p = ctx.get('ui').shop.inspection;
    const records = p.renderer._objects._renderObjects;
    const nodes = (scene) => {
      const result = new Set();
      scene.traverse((node) => result.add(node));
      return result;
    };
    const retained = (owned) => [...records].filter((record) => owned.has(record.object)).length;
    const resources = new Set();
    for (const entry of ctx.get('weapons').viewmodel.weapons.values()) {
      for (const resource of [...entry.model.materials, ...entry.model.textures])
        resources.add(resource);
      for (const mesh of entry.meshes) resources.add(mesh.geometry);
    }
    let borrowedDisposals = 0;
    const onDispose = () => borrowedDisposals++;
    for (const resource of resources) resource.addEventListener('dispose', onDispose);
    try {
      const switches = [];
      let previous = nodes(p.model.scene);
      for (const id of ['rifle', 'pistol', 'rifle', 'pistol', 'rifle', 'pistol']) {
        await p.select(id, id);
        p.update();
        const current = nodes(p.model.scene);
        switches.push({ previous: retained(previous), current: retained(current) });
        previous = current;
      }
      market.closeShop();
      const closed = retained(previous);
      const closedCount = records.size;
      const reopened = [];
      for (let i = 0; i < 4; i++) {
        market.openShop(3);
        await p.select('pistol', 'pistol');
        p.update();
        const current = nodes(p.model.scene);
        const rendered = retained(current);
        market.closeShop();
        reopened.push({ rendered, retained: retained(current), total: records.size });
      }
      market.openShop(3);
      await p.select('mcx', 'MCX VIRTUS');
      p.update();
      return { switches, closed, closedCount, reopened, borrowedDisposals };
    } finally {
      for (const resource of resources) resource.removeEventListener('dispose', onDispose);
    }
  });
  for (const selection of lifetime.switches) {
    assert(selection.current > 0, 'lifetime regression must render the current clone');
    assert.equal(selection.previous, 0, 'selection releases the preceding clone render records');
  }
  assert.equal(lifetime.closed, 0, 'closing releases the current clone render records');
  for (const reopen of lifetime.reopened) {
    assert(reopen.rendered > 0, 'reopened preview is actually rendered');
    assert.equal(reopen.retained, 0, 'repeated close releases all clone records');
    assert.equal(
      reopen.total,
      lifetime.closedCount,
      'reopening does not accumulate render records'
    );
  }
  assert.equal(lifetime.borrowedDisposals, 0, 'rendered cleanup leaves borrowed assets alive');

  // Failure must invalidate a model result that is already being awaited.
  const lateFailure = await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx;
    const w = ctx.get('weapons');
    const p = ctx.get('ui').shop.inspection;
    const probe = new p.constructor(document.createElement('div'), w);
    probe.active = true;
    probe.ready = Promise.resolve();
    const model = await w.createInspectionModel('rifle');
    let disposals = 0;
    const dispose = model.dispose;
    model.dispose = () => {
      disposals++;
      dispose();
    };
    let deliver, started;
    const pending = new Promise((resolve) => {
      deliver = resolve;
    });
    const requested = new Promise((resolve) => {
      started = resolve;
    });
    const original = w.createInspectionModel;
    w.createInspectionModel = () => {
      started();
      return pending;
    };
    try {
      const task = probe.select('rifle', 'rifle');
      await requested;
      probe.fail();
      const status = probe.status.textContent;
      deliver(model);
      await task;
      return {
        failed: probe.failed,
        model: probe.model,
        parent: model.scene.parent,
        disposals,
        status,
        finalStatus: probe.status.textContent,
      };
    } finally {
      w.createInspectionModel = original;
      probe.dispose();
    }
  });
  assert.equal(lateFailure.failed, true);
  assert.equal(lateFailure.model, null, 'failed preview never publishes a late model');
  assert.equal(lateFailure.parent, null, 'late model is not attached');
  assert.equal(lateFailure.disposals, 1, 'late model is disposed exactly once');
  assert.match(lateFailure.status, /3D preview unavailable/);
  assert.equal(lateFailure.finalStatus, lateFailure.status, 'late result preserves failure status');

  // Exercise actual backend init rejection, including Three's rejecting disposal path.
  const initFailure = await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx;
    const p = ctx.get('ui').shop.inspection;
    const probe = new p.constructor(document.createElement('div'), ctx.get('weapons'));
    probe.active = true;
    const Backend = p.renderer.backend.constructor;
    const original = Backend.prototype.init;
    const failure = new Error('fixture adapter unavailable');
    Backend.prototype.init = () => Promise.reject(failure);
    try {
      const init = probe.initRenderer();
      probe.ready = init;
      await probe.select('rifle', 'rifle');
      const originalError = await init.then(
        () => false,
        (error) => error === failure
      );
      // Let any detached cleanup rejection reach the normal pageerror collector.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        originalError,
        failed: probe.failed,
        model: probe.model,
        renderer: probe.renderer,
        enabled: probe.controls.enabled,
        status: probe.status.textContent,
      };
    } finally {
      Backend.prototype.init = original;
      probe.dispose();
    }
  });
  // Switching to artwork must invalidate an already requested weapon clone and its callbacks.
  const artworkRace = await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx;
    const w = ctx.get('weapons');
    const p = ctx.get('ui').shop.inspection;
    const probe = new p.constructor(document.createElement('div'), w);
    probe.active = true;
    probe.ready = Promise.resolve();
    const model = await w.createInspectionModel('rifle');
    let disposals = 0;
    const dispose = model.dispose;
    model.dispose = () => {
      disposals++;
      dispose();
    };
    let deliver, started;
    const pending = new Promise((resolve) => {
      deliver = resolve;
    });
    const requested = new Promise((resolve) => {
      started = resolve;
    });
    const original = w.createInspectionModel;
    w.createInspectionModel = () => {
      started();
      return pending;
    };
    try {
      const task = probe.select('rifle', 'rifle');
      await requested;
      await probe.select('bandage', 'Bandage');
      const oldImage = probe.image;
      const lateImageLoad = oldImage.onload;
      deliver(model);
      await task;
      const cancelled = probe.model === null && model.scene.parent === null && disposals === 1;
      await probe.select('ammo', 'Ammo Refill');
      const status = probe.status.textContent;
      lateImageLoad();
      const afterLateLoad = probe.status.textContent;
      probe.fail();
      const afterFailure = {
        id: probe.activeId,
        hasImage: probe.image !== null,
        status: probe.status.textContent,
      };
      probe.hide();
      return {
        cancelled,
        status,
        afterLateLoad,
        oldImageDetached: oldImage.parentNode === null,
        afterFailure,
        imageAfterClose: probe.image,
      };
    } finally {
      w.createInspectionModel = original;
      probe.dispose();
    }
  });
  assert.equal(artworkRace.cancelled, true, 'artwork disposes a late weapon clone');
  assert.equal(artworkRace.oldImageDetached, true);
  assert.equal(artworkRace.afterLateLoad, artworkRace.status, 'obsolete image loads are ignored');
  assert.deepEqual(
    artworkRace.afterFailure,
    {
      id: 'ammo',
      hasImage: true,
      status: artworkRace.status,
    },
    'a 3D failure preserves the supply illustration'
  );
  assert.equal(artworkRace.imageAfterClose, null);

  assert.equal(initFailure.originalError, true, 'cleanup preserves the original init failure');
  assert.equal(initFailure.failed, true);
  assert.equal(initFailure.model, null);
  assert.equal(initFailure.renderer, null);
  assert.equal(initFailure.enabled, false);
  assert.match(initFailure.status, /3D preview unavailable/);

  // Explicit purchase is authoritative for supplies too; browsing never spends credits.
  await page.evaluate(() => {
    window.__ENGINE__.ctx.get('market').credits = 2000;
  });
  await page.evaluate(() => window.__PUMP__(2));
  await page.locator('[data-item="mcx"] .ow-market-buy').click();
  assert.equal((await state()).credits, 900);
  await page.locator('[data-item="grenade"] .ow-market-name').click();
  assert.equal((await state()).credits, 900, 'selecting a supply never purchases it');
  await page.locator('[data-item="grenade"] .ow-market-buy').click();
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
  await page.evaluate(() =>
    window.__ENGINE__.ctx.get('ui').shop.inspection.select('bandage', 'Bandage')
  );
  await page.waitForFunction(() => {
    const p = window.__ENGINE__.ctx.get('ui').shop.inspection;
    return p.image?.naturalWidth === 960 && !p.image.hidden;
  });
  assert.equal(await page.locator('.ow-market-inspect-3d').isVisible(), false);
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
    'Market inspection: five supply illustrations, seven 3D weapons, safe selection, fallbacks, races, purchases and lifecycle passed.'
  );
} finally {
  await browser.close();
  stopViteServer(server);
}
