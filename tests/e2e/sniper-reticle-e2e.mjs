/** Pixel oracle for the shipped sniper material, not a screenshot/report generator. */
import assert from 'node:assert/strict';

import {
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { installDevicePolicy, waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5231);
const scenes = [
  { id: 'day-1080', width: 1920, height: 1080, time: 16.5 },
  { id: 'day-720', width: 1280, height: 720, time: 16.5 },
  { id: 'day-ultrawide', width: 2560, height: 1080, time: 16.5 },
];
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({
    headless: true,
    args: [
      '--ignore-gpu-blocklist',
      '--force-color-profile=srgb',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
    ],
  });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await installDevicePolicy(page);
  const errors = [],
    captures = [];
  collectBrowserErrors(page, errors, { validationMessages: true });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  for (const scene of scenes) {
    await page.setViewportSize({ width: scene.width, height: scene.height });
    await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForGame(page);
    const state = await page.evaluate(async (time) => {
      window.__APPLY_SHOT__('weapon');
      const ctx = window.__ENGINE__.ctx,
        w = ctx.get('weapons');
      await w._restTask;
      w.debugPose('ads');
      if (!w.setWeaponImmediate('sniper')) throw Error('sniper not mounted');
      ctx.get('sky').setTimeOfDay(time);
      ctx.get('player').setControlEnabled(true);
      await window.__PUMP__(100);
      await window.__PRESENT__(2);
      return {
        fov: ctx.camera.fov,
        reticle: w.viewmodel.scopeOverlay.visible,
        optic: w.viewmodel.active.optic.reticle,
      };
    }, scene.time);
    assert.equal(state.reticle, true);
    assert.equal(state.optic, 'p4fl');
    assert(Math.abs(state.fov - 20) < 0.001, 'shipped ADS zoom is unchanged');

    // Borrow the shipped material on white: isolates actual WGSL pixel coverage
    // from scene detail/postprocessing. Never substitute a JS rendering of it.
    const probe = await page.evaluate(async () => {
      const { THREE: T } = await import('/tools/arm-material-fixture.js');
      const ctx = window.__ENGINE__.ctx,
        r = ctx.get('render'),
        vm = ctx.get('weapons').viewmodel;
      const { width, height } = r.screenSize;
      const scene = new T.Scene();
      scene.background = new T.Color(1, 1, 1);
      scene.add(vm.scopeReticle.clone()); // borrowed geometry/material, not disposed
      const target = new T.RenderTarget(width, height);
      const previous = r.renderer.getRenderTarget();
      const face = r.renderer.getActiveCubeFace(),
        mip = r.renderer.getActiveMipmapLevel();
      let pixels;
      try {
        r.renderer.setRenderTarget(target);
        await r.renderer.renderAsync(scene, ctx.viewCamera);
        pixels = await r.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
      } finally {
        r.renderer.setRenderTarget(previous, face, mip);
        target.dispose();
      }
      const cx = width / 2,
        cy = height / 2;
      const pixelsPerMrad = (vm.reticleUniforms.uMradScale.value * height) / 2;
      const darkness = (x, y) => 1 - pixels[(Math.floor(y) * width + Math.floor(x)) * 4] / 255;
      const peak = (x, y, horizontal) => {
        let best = 0;
        for (let d = -1; d <= 1; d++)
          best = Math.max(best, darkness(x + (horizontal ? d : 0), y + (horizontal ? 0 : d)));
        return best;
      };
      const offset = Math.floor(cy - pixelsPerMrad * 0.7) + 0.5 - cy;
      const ticks = [5, 10, 15, 20].map((mrad) => ({
        mrad,
        right: peak(cx + mrad * pixelsPerMrad, cy + offset, true),
        left: peak(cx - mrad * pixelsPerMrad, cy + offset, true),
        up: peak(cx + offset, cy - mrad * pixelsPerMrad, false),
        down: peak(cx + offset, cy + mrad * pixelsPerMrad, false),
        between: darkness(cx + (mrad + 1.25) * pixelsPerMrad, cy + offset),
      }));
      const postX = Math.floor(cx + 40 * pixelsPerMrad);
      const fineX = Math.floor(cx + 1.25 * pixelsPerMrad);
      const widthAt = (x) => {
        let coverage = 0;
        for (let y = cy - 8; y < cy + 8; y++) coverage += darkness(x, y);
        return coverage;
      };
      const fineWidth = widthAt(fineX);
      // Integrate the whole hash, then subtract the continuous axis underneath.
      // A single off-axis sample can miss a short minor at 720p pixel phase.
      const hashExcess = (mrad, horizontal) => {
        const alongCenter = Math.floor((horizontal ? cx : cy) + mrad * pixelsPerMrad);
        let coverage = 0;
        for (let along = alongCenter - 2; along <= alongCenter + 2; along++)
          for (let across = -8; across < 8; across++)
            coverage += horizontal ? darkness(along, cy + across) : darkness(cx + across, along);
        return coverage - 5 * fineWidth;
      };
      const hashPair = (mrad, horizontal) => ({
        minor: hashExcess(mrad, horizontal),
        major: hashExcess(mrad - Math.sign(mrad) * 2.5, horizontal),
      });
      const minorTicks = [-12.5, -7.5, 7.5, 12.5].map((mrad) => ({
        mrad,
        horizontal: hashPair(mrad, true),
        vertical: hashPair(mrad, false),
      }));
      return {
        ticks,
        minorTicks,
        pixelsPerMrad,
        fineWidth,
        postWidth: widthAt(postX),
        outside: darkness(cx + height * 0.4, cy),
      };
    });
    for (const tick of probe.ticks) {
      for (const side of ['left', 'right', 'up', 'down'])
        assert(tick[side] > 0.45, `${scene.id}: ${tick.mrad} mrad ${side}`);
      assert(tick.between < 0.15, `${scene.id}: ticks must remain separate`);
    }
    for (const tick of probe.minorTicks)
      for (const axis of ['horizontal', 'vertical']) {
        const { minor, major } = tick[axis];
        assert(minor > 0.5, `${scene.id}: ${tick.mrad} mrad ${axis} minor must extend beyond axis`);
        assert(
          major > minor * 1.5,
          `${scene.id}: ${tick.mrad} mrad ${axis} minor must be shorter than major`
        );
      }
    assert(probe.fineWidth >= 0.9 && probe.fineWidth < 1.6, 'readable pixel-width center');
    assert(probe.postWidth > probe.fineWidth * 2, 'heavier outer posts');
    assert(probe.outside < 0.01, 'reticle clipped to aperture');
    captures.push(probe);
    console.log(`PASS ${scene.id}`);
  }
  // Existing boot warning, traced with Node.captureStackTrace to
  // render/volumetric-shadow.ts, not the reticle (which uses no inline Fn).
  // Retain it in the report and bound its count; all other diagnostics fail.
  const knownWarning =
    'THREE.TSL: Return statement used in an inline \'Fn()\'. Define a layout struct to allow return values. Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.';
  const knownWarnings = errors.filter((message) => message === knownWarning);
  assert(knownWarnings.length <= scenes.length * 2, 'no additional inline-Fn warnings');
  assert.deepEqual(
    errors.filter((message) => message !== knownWarning),
    []
  );
  assert.equal(
    captures[0].pixelsPerMrad,
    captures[2].pixelsPerMrad,
    'ultrawide must not stretch markings'
  );
} finally {
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
