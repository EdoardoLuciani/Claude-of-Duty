#!/usr/bin/env node
/** Matched original vs actual shipped ADS framing across the roster.
 * node tools/capture-ads-framing.mjs --port=5239 --out=/tmp/ads-framing
 * --quick: daylight 1080p only. --weapons=rifle,lmg: subset for iteration.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from './lib/browser-harness.mjs';
import { openGameReview } from './lib/game-review.mjs';
import { installDevicePolicy } from './lib/native-render.mjs';

// Frozen pre-#367 settings. After frames always use the real runtime definition.
const original = {
  rifle: { eyeRelief: 0.115, viewFov: 0.86 },
  lmg: { eyeRelief: 0.125, viewFov: 0.84 },
  pistol: { eyeRelief: 0.34, viewFov: 0.92 },
  shotgun: { eyeRelief: 0.28, viewFov: 0.9 },
  smg: { eyeRelief: 0.28, viewFov: 0.145 },
  mcx: { eyeRelief: 0.11, viewFov: 0.86 },
  sniper: { eyeRelief: 0.09, viewFov: 0.72 },
};
const args = parseArgs(),
  port = Number(args.port ?? 5239),
  out = resolve(args.out ?? '/tmp/ads-framing'),
  weapons = args.weapons ? String(args.weapons).split(',') : Object.keys(original);
assert(
  weapons.every((id) => Object.hasOwn(original, id)),
  'unknown weapon'
);
const scenes = [
  { id: 'day-1080', width: 1920, height: 1080, time: 16.5 },
  ...(!args.quick
    ? [
        { id: 'dusk-1080', width: 1920, height: 1080, time: 19.2 },
        { id: 'day-720', width: 1280, height: 720, time: 16.5 },
      ]
    : []),
];
const { page, errors, warnings, boot, pump, capture, close } = await openGameReview({
  port,
  out,
  viewport: scenes[0],
  args: [
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
    '--force-color-profile=srgb',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
  ],
});
await installDevicePolicy(page);
const captures = [];
try {
  for (const scene of scenes) {
    for (const id of weapons) {
      for (const side of ['before', 'after']) {
        await page.setViewportSize({ width: scene.width, height: scene.height });
        await boot();
        await page.evaluate(
          async ({ id, side, scene, original }) => {
            const ctx = window.__ENGINE__.ctx,
              w = ctx.get('weapons');
            await w._restTask;
            window.__APPLY_SHOT__('weapon');
            if (!w.setWeaponImmediate(id)) throw new Error(`Cannot equip ${id}`);
            const vm = w.viewmodel;
            if (side === 'before') {
              vm.active.def = { ...vm.active.def, ...original };
              if (id === 'lmg') {
                vm.active.optic = { ...vm.active.optic };
                for (const key of ['reticle', 'dotMoa', 'minDotPixels', 'dotOpacity'])
                  delete vm.active.optic[key];
              }
            }
            ctx.get('sky').setTimeOfDay(scene.time);
            ctx.get('player').setControlEnabled(true);
            w.debugMode = 'ads';
            window.__ADS_FRAMING__ = () => {
              const cam = ctx.viewCamera,
                root = vm.active.model.root;
              root.updateWorldMatrix(true, true);
              const p = cam.position.clone(),
                direction = p.clone();
              const wristAngle = (arm) => {
                direction.copy(arm.hand.position).sub(arm.forePivot.position).normalize();
                p.set(0, 0, -1).applyQuaternion(arm.hand.quaternion);
                return (Math.acos(Math.max(-1, Math.min(1, p.dot(direction)))) * 180) / Math.PI;
              };
              const sight = root.getObjectByName('SOCKET_sight');
              sight.getWorldPosition(p).applyMatrix4(cam.matrixWorldInverse);
              const sightDepth = -p.z;
              p.applyMatrix4(cam.projectionMatrix);
              const sightNdc = p.toArray();
              let opticNearest = null,
                opticWidth = null,
                opticHeight = null;
              const optic = root.getObjectByName('optic');
              if (optic) {
                let minX = Infinity,
                  maxX = -Infinity,
                  minY = Infinity,
                  maxY = -Infinity;
                opticNearest = Infinity;
                optic.traverse((mesh) => {
                  if (!mesh.isMesh) return;
                  const pos = mesh.geometry.attributes.position;
                  for (let i = 0; i < pos.count; i++) {
                    p.fromBufferAttribute(pos, i)
                      .applyMatrix4(mesh.matrixWorld)
                      .applyMatrix4(cam.matrixWorldInverse);
                    opticNearest = Math.min(opticNearest, -p.z);
                    p.applyMatrix4(cam.projectionMatrix);
                    minX = Math.min(minX, p.x);
                    maxX = Math.max(maxX, p.x);
                    minY = Math.min(minY, p.y);
                    maxY = Math.max(maxY, p.y);
                  }
                });
                opticWidth = ((maxX - minX) * innerWidth) / 2;
                opticHeight = ((maxY - minY) * innerHeight) / 2;
              }
              vm.reticle.getWorldPosition(p).applyMatrix4(cam.matrixWorldInverse);
              const dotPixels = vm.reticle.visible
                ? (vm.dotCore.scale.x * innerHeight) / (-p.z * Math.tan((cam.fov * Math.PI) / 360))
                : null;
              return {
                frame: ctx.time.frame,
                id: w.activeId,
                label: vm.active.def.label,
                eyeRelief: vm.active.def.eyeRelief,
                viewFov: cam.fov,
                ads: vm.adsT,
                worldFov: ctx.camera.fov,
                worldPosition: ctx.camera.position.toArray(),
                worldRotation: ctx.camera.quaternion.toArray(),
                nearPlane: cam.near,
                sightDepth,
                sightNdc,
                opticNearest,
                opticWidth,
                opticHeight,
                dotPixels,
                reticle: vm.reticle.visible,
                ring: vm.dotRing.visible,
                scope: vm.scopeOverlay.visible,
                gunVisible: vm.active.group.visible,
                rightWristAngle: wristAngle(vm.armR),
                leftWristAngle: wristAngle(vm.armL),
                rightWristError: vm.armR.hand.position.distanceTo(vm._handPos),
                leftWristError: vm.armL.hand.position.distanceTo(vm._handPosL),
                rightForearmScale: vm.armR.forePivot.scale.z,
                leftForearmScale: vm.armL.forePivot.scale.z,
              };
            };
            await window.__PUMP__(100);
          },
          { id, side, scene, original: original[id] }
        );
        await page.evaluate(() => window.__PRESENT__(2));
        const metrics = await page.evaluate(() => window.__ADS_FRAMING__());
        assert.equal(metrics.ads, 1);
        assert.equal(metrics.id, id);
        assert.equal(metrics.frame, 103);
        assert(
          Math.abs(
            metrics.viewFov -
              (side === 'before'
                ? original[id].viewFov
                : await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').current.viewFov)) *
                60
          ) < 0.001
        );
        const scoped = id === 'mcx' || id === 'sniper';
        assert.equal(metrics.scope, scoped);
        assert.equal(metrics.gunVisible, !scoped);
        assert.equal(metrics.reticle, id === 'lmg' || id === 'smg');
        // Full ADS scopes aim through their centred fullscreen overlay, not the hidden socket.
        if (!scoped)
          assert(
            Math.abs(metrics.sightNdc[0]) < 0.01 && Math.abs(metrics.sightNdc[1]) < 0.01,
            `${id}: sight socket aligned with the aiming axis`
          );
        const baseline = captures.find((c) => c.scene === scene.id && c.id === id);
        if (baseline)
          for (const key of ['worldFov', 'worldPosition', 'worldRotation'])
            assert.deepEqual(
              metrics[key],
              baseline.metrics[key],
              `${id}: world camera ${key} changed`
            );
        const file = `${scene.id}-${id}-${side}`;
        await capture(file);
        const motion = [];
        if (side === 'after' && scene.id === 'day-1080') {
          await page.evaluate(() => {
            window.__ENGINE__.ctx.get('weapons').debugMode = 'idle';
          });
          await pump(45);
          await page.evaluate(() => {
            window.__ENGINE__.ctx.get('weapons').debugMode = 'ads';
          });
          for (let frame = 0; frame < 36; frame++) {
            await pump(1);
            motion.push(await page.evaluate(() => window.__ADS_FRAMING__()));
          }
          assert.equal(motion.at(-1).ads, 1, `${id}: completed ordinary aim-in`);
          assert(await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').tryFire()));
          const recoveryFrames = id === 'sniper' ? 90 : id === 'shotgun' ? 66 : 18;
          for (let frame = 0; frame < recoveryFrames; frame++) {
            await pump(1);
            motion.push(await page.evaluate(() => window.__ADS_FRAMING__()));
            if (frame === 1) await capture(`${id}-firing`);
          }
          await page.evaluate(() => {
            window.__ENGINE__.ctx.get('weapons').debugMode = 'idle';
          });
          for (let frame = 0; frame < 36; frame++) {
            await pump(1);
            motion.push(await page.evaluate(() => window.__ADS_FRAMING__()));
          }
          assert.equal(motion.at(-1).ads, 0, `${id}: completed ordinary aim-out`);
        }
        captures.push({ scene: scene.id, id, side, file: `${file}.png`, metrics, motion });
        writeFileSync(
          `${out}/report.json`,
          JSON.stringify({ captures, errors, warnings }, null, 2) + '\n'
        );
        console.log(
          `${file}: eye ${metrics.eyeRelief}, FOV ${metrics.viewFov}, dot ${metrics.dotPixels}`
        );
      }
    }
  }
  assert.deepEqual(errors, []);
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
  for (const c of captures.filter((c) => c.side === 'after')) {
    for (const m of [c.metrics, ...c.motion]) {
      assert(Math.max(m.rightWristError, m.leftWristError) < 0.002, `${c.id}: hand reach`);
      assert(Math.max(m.rightWristAngle, m.leftWristAngle) < 85, `${c.id}: wrist angle`);
      assert(Math.max(m.rightForearmScale, m.leftForearmScale) < 1.05, `${c.id}: forearm stretch`);
      assert(m.sightDepth > m.nearPlane + 0.02, `${c.id}: sight near plane`);
      if (m.opticNearest !== null)
        assert(m.opticNearest > m.nearPlane + 0.005, `${c.id}: optic near plane`);
      if ((c.id === 'lmg' || c.id === 'smg') && m.reticle)
        assert(Math.abs(m.dotPixels - (c.id === 'lmg' ? 5 : 6)) < 0.001, `${c.id}: dot footprint`);
    }
  }
  // Simple before/after sheets; never independently reframe or enlarge the after.
  for (const scene of scenes) {
    for (const id of weapons) {
      for (const crop of [false, true]) {
        const pair = captures.filter((c) => c.scene === scene.id && c.id === id);
        const width = crop ? 600 : scene.width / 2,
          height = crop ? 450 : scene.height / 2;
        await page.setViewportSize({ width: 40 + 2 * (width + 12), height: 900 });
        const cards = pair
          .map(
            (
              c
            ) => `<article><h2>${c.side === 'before' ? 'Before' : 'After'} · ${c.metrics.label}</h2>
          <p>Eye ${Math.round(c.metrics.eyeRelief * 1000)} mm · weapon FOV ${c.metrics.viewFov.toFixed(1)}° · world FOV ${c.metrics.worldFov.toFixed(1)}°</p>
          <div class="image"><img src="data:image/png;base64,${readFileSync(`${out}/${c.file}`).toString('base64')}"></div></article>`
          )
          .join('');
        await page.setContent(`<!doctype html><style>
          *{box-sizing:border-box}body{margin:0;padding:20px;background:#171c23;color:#e6edf3;font:16px system-ui}
          h1{font-size:24px}h2{font-size:20px;margin:10px}p{margin:10px;color:#c8d0d9}
          section{display:flex;gap:12px}article{background:#262d36}.image{position:relative;width:${width}px;height:${height}px;overflow:hidden}
          img{position:absolute;max-width:none;width:${crop ? scene.width : width}px;left:50%;top:50%;transform:translate(-50%,-50%)}
          </style><h1>${pair[0].metrics.label} · ${scene.id} · ${crop ? 'native-size centre crops' : 'full views at identical 50% scale'}</h1>
          <p>World zoom, assets, recoil and blur unchanged. Framing candidates for review.</p><section>${cards}</section>`);
        await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
        await page.screenshot({
          path: `${out}/${scene.id}-${id}-${crop ? 'crops' : 'comparison'}.png`,
          fullPage: true,
        });
      }
    }
  }
  console.log(`ADS framing review: ${out}`);
} finally {
  await close();
}
