#!/usr/bin/env node
/** Review-only M4 camera experiments; never change shipped definitions/assets.
 * node tools/capture-m4-framing.mjs --port=5238 --out=/tmp/m4-framing
 * --quick captures only daylight 1080p; the default also checks dusk/720p.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from './lib/browser-harness.mjs';
import { captureNative, installDevicePolicy, waitForGame } from './lib/native-render.mjs';

const args = parseArgs(),
  port = Number(args.port ?? 5238),
  out = resolve(args.out ?? '/tmp/m4-framing');
mkdirSync(out, { recursive: true });
const variants = [
  { id: 'a-stock', label: 'A · Original baseline', eyeRelief: 0.115, viewFov: 0.86 },
  { id: 'b-fov', label: 'B · FOV only', eyeRelief: 0.115, viewFov: 0.6 },
  { id: 'c-eye', label: 'C · Eye distance only', eyeRelief: 0.075, viewFov: 0.86 },
  { id: 'd-combined', label: 'D · Moderate combination', eyeRelief: 0.085, viewFov: 0.65 },
  // Match D's nominal rear aperture size, but change the front/rear perspective.
  {
    id: 'e-far',
    label: 'E · Far eye / matched aperture',
    eyeRelief: 0.18,
    viewFov: (2 * Math.atan((Math.tan((39 * Math.PI) / 360) * 0.085) / 0.18) * 180) / Math.PI / 60,
  },
  { id: 'f-close', label: 'F · Close eye + FOV', eyeRelief: 0.06, viewFov: 0.7 },
  // Second iteration: larger rear opening without magnifying the front post as much.
  { id: 'g-eye-50', label: 'G · Closer eye / original FOV', eyeRelief: 0.05, viewFov: 0.86 },
  { id: 'h-eye-35', label: 'H · Close-eye limit probe', eyeRelief: 0.035, viewFov: 0.86 },
];
const scenes = [
  { id: 'day-1080', width: 1920, height: 1080, time: 16.5 },
  ...(!args.quick
    ? [
        { id: 'dusk-1080', width: 1920, height: 1080, time: 19.2 },
        { id: 'day-720', width: 1280, height: 720, time: 16.5 },
      ]
    : []),
];
const errors = [],
  warnings = [],
  captures = [];
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({
    headless: true,
    args: [
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--force-color-profile=srgb',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
    ],
  });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await installDevicePolicy(page);
  collectBrowserErrors(page, errors, { warnings });
  page.on('console', (m) => {
    if (
      m.type() === 'warning' &&
      /GPUValidationError|validation error|Error while parsing WGSL/i.test(m.text())
    )
      errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  for (const scene of scenes) {
    for (const variant of variants) {
      // Fresh engine per image: identical RNG, motion phase, exposure and history.
      await page.setViewportSize({ width: scene.width, height: scene.height });
      await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, {
        waitUntil: 'domcontentloaded',
      });
      const device = await waitForGame(page);
      await page.evaluate(
        async ({ scene, variant }) => {
          window.__APPLY_SHOT__('weapon');
          const ctx = window.__ENGINE__.ctx,
            w = ctx.get('weapons'),
            vm = w.viewmodel;
          const shipped = vm.active.def;
          if (shipped.id !== 'rifle') throw new Error('Expected M4 for framing review');
          vm.active.def = { ...shipped, eyeRelief: variant.eyeRelief, viewFov: variant.viewFov };
          ctx.get('sky').setTimeOfDay(scene.time);
          ctx.get('player').setControlEnabled(true);
          w.debugMode = 'ads';
          window.__M4_FRAMING__ = () => {
            const camera = ctx.viewCamera,
              root = vm.active.animation.root;
            root.updateWorldMatrix(true, true);
            const point = camera.position.clone(),
              direction = camera.position.clone();
            const socket = root.getObjectByName('SOCKET_sight');
            const project = (p) => {
              p.project(camera);
              return [((p.x + 1) * innerWidth) / 2, ((1 - p.y) * innerHeight) / 2];
            };
            const aperture = socket.getWorldPosition(point).applyMatrix4(camera.matrixWorldInverse);
            const apertureDepth = -aperture.z;
            const wristAngle = (arm) => {
              direction.copy(arm.hand.position).sub(arm.forePivot.position).normalize();
              point.set(0, 0, -1).applyQuaternion(arm.hand.quaternion);
              return (Math.acos(Math.max(-1, Math.min(1, point.dot(direction)))) * 180) / Math.PI;
            };
            const partBounds = (name) => {
              const mesh = root.getObjectByName(name),
                positions = mesh.geometry.attributes.position;
              const xs = [],
                ys = [],
                depths = [];
              for (let i = 0; i < positions.count; i++) {
                point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
                depths.push(-point.clone().applyMatrix4(camera.matrixWorldInverse).z);
                const [x, y] = project(point);
                xs.push(x);
                ys.push(y);
              }
              return {
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
                nearest: Math.min(...depths),
              };
            };
            return {
              frame: ctx.time.frame,
              ads: vm.adsT,
              worldFov: ctx.camera.fov,
              viewFov: camera.fov,
              worldPosition: ctx.camera.position.toArray(),
              worldRotation: ctx.camera.quaternion.toArray(),
              nearPlane: camera.near,
              apertureDepth,
              // Ideal 2.2 mm bore at the socket plane, not a pixel segmentation of the visible throat.
              nominalAperturePixels:
                (0.0022 * innerHeight) /
                (2 * apertureDepth * Math.tan((camera.fov * Math.PI) / 360)),
              sightPixel: project(socket.getWorldPosition(point)),
              frontPixel: project(
                root.getObjectByName('SOCKET_front_post').getWorldPosition(point)
              ),
              frontPost: partBounds('Front_sight_post'),
              rearCup: partBounds('MaTech_open_aperture'),
              rightWristAngle: wristAngle(vm.armR),
              leftWristAngle: wristAngle(vm.armL),
              rightWristError: vm.armR.hand.position.distanceTo(vm._handPos),
              leftWristError: vm.armL.hand.position.distanceTo(vm._handPosL),
              reticle: vm.reticle.visible,
              scope: vm.scopeOverlay.visible,
            };
          };
          await window.__PUMP__(100);
        },
        { scene, variant }
      );
      const metrics = await page.evaluate(async () => {
        const { checkM4Sights } = await import('/tools/lib/m4-sight-checks.js');
        const geometry = checkM4Sights(
          window.__ENGINE__.ctx.get('weapons').viewmodel.active.animation.root
        );
        await window.__PRESENT__(2);
        return { ...window.__M4_FRAMING__(), geometry };
      });
      assert.equal(metrics.frame, 103);
      assert.equal(metrics.ads, 1);
      assert.equal(metrics.reticle, false);
      assert.equal(metrics.scope, false);
      assert(Math.abs(metrics.viewFov - variant.viewFov * 60) < 0.001);
      const baseline = captures.find((c) => c.scene === scene.id);
      if (baseline) {
        for (const key of ['worldFov', 'worldPosition', 'worldRotation'])
          assert.deepEqual(metrics[key], baseline.metrics[key], `${key} changed with framing`);
      }
      const file = `${scene.id}-${variant.id}.png`;
      await captureNative(page, `${out}/${file}`);
      const motion = [];
      if (scene.id === 'day-1080') {
        // Actual shared ADS / IK / recoil, not a posed replacement rig.
        await page.evaluate(() => {
          window.__ENGINE__.ctx.get('weapons').debugMode = 'idle';
        });
        await page.evaluate(() => window.__PUMP__(40));
        await page.evaluate(() => {
          window.__ENGINE__.ctx.get('weapons').debugMode = 'ads';
        });
        for (let frame = 0; frame < 84; frame++) {
          if (frame >= 24 && frame < 60 && frame % 6 === 0)
            assert(await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').tryFire()));
          if (frame === 60)
            await page.evaluate(() => {
              window.__ENGINE__.ctx.get('weapons').debugMode = 'idle';
            });
          await page.evaluate(() => window.__PUMP__(1));
          motion.push(await page.evaluate(() => window.__M4_FRAMING__()));
          if (frame === 5 || frame === 43) {
            await page.evaluate(() => window.__PRESENT__(2));
            await captureNative(
              page,
              `${out}/${variant.id}-${frame === 5 ? 'aim-in' : 'firing'}.png`
            );
          }
        }
      }
      const samples = [metrics, ...motion];
      const checks = {
        rearCupClear: samples.every((m) => m.rearCup.nearest > m.nearPlane + 0.005),
        handReach: samples.every((m) => Math.max(m.rightWristError, m.leftWristError) < 0.002),
        wristAngles: samples.every((m) => Math.max(m.rightWristAngle, m.leftWristAngle) < 85),
      };
      captures.push({ scene: scene.id, variant, file, device, metrics, checks, motion });
      console.log(
        `${file}: aperture ${metrics.nominalAperturePixels.toFixed(1)} px, post ${metrics.frontPost.width.toFixed(1)} px`,
        checks
      );
      writeFileSync(
        `${out}/report.json`,
        JSON.stringify({ scenes, variants, captures, errors, warnings }, null, 2) + '\n'
      );
    }
  }
  assert.deepEqual(errors, []);
  for (const capture of captures)
    assert(
      Object.values(capture.checks).every(Boolean),
      `${capture.file}: pose/clearance check failed`
    );
  // Existing boot diagnostics are retained, not silently accepting new shader warnings.
  assert(
    warnings.every(
      (warning) =>
        warning ===
          'THREE.TSL: Return statement used in an inline \'Fn()\'. Define a layout struct to allow return values. Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.' ||
        /^Calling \[RenderPassEncoder \(unlabeled\)\]\.Draw with (an index|a vertex) count of 0 is unusual\.$/.test(
          warning
        )
    ),
    'unexpected browser warning'
  );
  assert(
    warnings.filter((warning) => warning.startsWith('THREE.TSL:')).length <= captures.length * 2,
    'more than the two existing inline-Fn warnings per boot'
  );
  // Contact sheets use identical display scale for all candidates. Native-size
  // centre crops are separate from the explicitly half-size full-frame overview.
  const board = await browser.newPage({
    viewport: { width: 1480, height: 1000 },
    deviceScaleFactor: 1,
  });
  for (const scene of scenes) {
    for (const crop of [false, true]) {
      const cards = captures
        .filter((c) => c.scene === scene.id)
        .map((c) => {
          const data = readFileSync(`${out}/${c.file}`).toString('base64');
          const m = c.metrics;
          return `<article><h2>${c.variant.label}</h2><p>Eye ${(c.variant.eyeRelief * 1000).toFixed(0)} mm · weapon FOV ${m.viewFov.toFixed(1)}°<br>
          Nominal bore ${m.nominalAperturePixels.toFixed(1)} px · post ${m.frontPost.width.toFixed(1)} px</p>
          <div class="image"><img src="data:image/png;base64,${data}"></div></article>`;
        })
        .join('');
      const width = crop ? 460 : scene.width / 2,
        height = crop ? 360 : scene.height / 2;
      await board.setViewportSize({ width: 40 + (width + 12) * (crop ? 3 : 2), height: 1000 });
      await board.setContent(`<!doctype html><style>
        *{box-sizing:border-box}body{margin:0;padding:20px;background:#171c23;color:#e6edf3;font:16px system-ui}
        h1{font-size:24px}h2{font-size:19px;margin:0}p{margin:6px 0;color:#c8d0d9}
        section{display:grid;grid-template-columns:repeat(${crop ? 3 : 2},${width}px);gap:12px}
        article{background:#262d36;padding-top:10px}h2,article p{padding:0 10px}
        .image{position:relative;width:${width}px;height:${height}px;overflow:hidden}
        img{position:absolute;max-width:none;width:${crop ? scene.width : width}px;left:50%;top:50%;transform:translate(-50%,-50%)}
      </style><h1>M4 ADS framing · ${scene.id} · ${crop ? 'native-size centre crops (no scaling)' : 'full views at identical 50% scale'}</h1>
        <p>World zoom, geometry, aim datum and blur unchanged. Historical A–H comparison; F selected.</p><section>${cards}</section>`);
      await board.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
      await board.screenshot({
        path: `${out}/${scene.id}-${crop ? 'crops' : 'overview'}.png`,
        fullPage: true,
      });
    }
  }
  await board.close();
  console.log(`M4 framing review: ${out}`);
} finally {
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
