#!/usr/bin/env node
/** Native arm draw census and weapon/pose review. --root allows exact-base control.
 * node tests/e2e/check-arm-surfaces.mjs --port=5403 --out=/tmp/arms
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
  collectBrowserErrors,
  parseArgs,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame, captureNative } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5403),
  out = resolve(args.out ?? '/tmp/arm-surfaces');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port, ...(args.root ? { root: resolve(args.root) } : {}) });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = [],
    warnings = [],
    reports = [];
  collectBrowserErrors(page, errors, { warnings });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon&q=high`);
  const device = await waitForGame(page);
  await page.evaluate(async () => {
    window.__APPLY_SHOT__('weapon');
    await window.__PUMP__(35);
    const w = window.__ENGINE__.ctx.get('weapons');
    w.update = w.fixedUpdate = w.lateUpdate = () => {};
    w.viewmodel.onClipEvent = () => {};
  });
  for (const weapon of ['rifle', 'pistol', 'mcx', 'smg', 'lmg', 'shotgun', 'sniper']) {
    for (const action of ['idle', 'ads', 'reload-early', 'reload-middle', 'reload-late']) {
      const report = await page.evaluate(
        async ({ weapon, action }) => {
          const e = window.__ENGINE__,
            w = e.ctx.get('weapons'),
            vm = w.viewmodel;
          w.setWeaponImmediate(weapon);
          vm.stopClip();
          vm.endRadio();
          vm.endGrenade();
          vm.adsT = vm.sprintT = 0;
          const state = {
            ads: 0,
            sprint: 0,
            lowReady: false,
            speed: 0,
            crouch: false,
            airborne: false,
            trigger: 0,
            empty: false,
          };
          for (let i = 0; i < 60; i++) vm.update(1 / 60, state);
          let frames = 60;
          if (action === 'ads') state.ads = 1;
          if (action.startsWith('reload')) {
            const duration = vm.play('reloadEmpty');
            if (!duration) throw new Error(`${weapon}: authored reload unavailable`);
            const fraction = { 'reload-early': 0.15, 'reload-middle': 0.5, 'reload-late': 0.85 }[
              action
            ];
            frames = Math.round(duration * fraction * 60);
          }
          for (let i = 0; i < frames; i++) vm.update(1 / 60, state);
          vm.anchor.updateMatrixWorld(true);
          const renderer = e.ctx.get('render').renderer;
          const backend = renderer.backend,
            draw = backend.draw;
          const skins = [vm.armL, vm.armR].flatMap((arm) => arm.skins);
          const draws = [];
          backend.draw = function (object, ...rest) {
            if (skins.includes(object.object))
              draws.push({
                name: object.object.name,
                triangles: object.object.geometry.index.count / 3,
              });
            return draw.call(this, object, ...rest);
          };
          try {
            await window.__PUMP__(1);
          } finally {
            backend.draw = draw;
          }
          if (e.error) throw e.error;
          return {
            weapon,
            action,
            draws,
            scopedADS: action === 'ads' && vm.active.optic?.kind === 'scope',
            armRootsVisible: vm.armL.root.visible && vm.armR.root.visible,
            triangles: skins.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0),
            lateBuilders: window.__NATIVE_BUILDS__,
            boneNames: vm.armL.skeleton.bones.map((bone) => bone.name),
            independentSkeletons: vm.armL.skeleton !== vm.armR.skeleton,
          };
        },
        { weapon, action }
      );
      assert.equal(
        report.draws.length,
        report.scopedADS ? 0 : Number(args['expected-draws'] ?? 2),
        `${weapon} ${action}: actual native arm draws`
      );
      assert.equal(
        report.armRootsVisible,
        !report.scopedADS,
        'preserve scoped-ADS arm visibility policy'
      );
      assert(report.independentSkeletons);
      assert.equal(report.boneNames.length, 28);
      assert.equal(report.lateBuilders, 0, 'native first-use/history stays prewarmed');
      reports.push(report);
      // Ordinary screenshots avoid creating a diagnostic readback shader context.
      // Native readback is done only after the first-use coverage is complete.
    }
  }
  assert.deepEqual(errors, [], 'no browser/GPU validation errors');
  for (const weapon of ['rifle', 'pistol', 'mcx']) {
    for (const action of ['idle', 'ads', 'reload']) {
      await page.evaluate(
        async ({ weapon, action }) => {
          const w = window.__ENGINE__.ctx.get('weapons'),
            vm = w.viewmodel;
          w.setWeaponImmediate(weapon);
          vm.stopClip();
          vm.adsT = 0;
          const state = {
            ads: action === 'ads' ? 1 : 0,
            sprint: 0,
            lowReady: false,
            speed: 0,
            crouch: false,
            airborne: false,
            trigger: 0,
            empty: false,
          };
          for (let i = 0; i < 60; i++) vm.update(1 / 60, state);
          if (action === 'reload') {
            const duration = vm.play('reloadEmpty');
            for (let i = 0; i < duration * 30; i++) vm.update(1 / 60, state);
          }
          await window.__PUMP__(1);
        },
        { weapon, action }
      );
      await captureNative(page, `${out}/${weapon}-${action}.png`);
    }
  }
  // Injury remains the same graph; glove pixels must stay clean while cloth stains.
  await page.evaluate(async () => {
    const w = window.__ENGINE__.ctx.get('weapons'),
      vm = w.viewmodel;
    w.setWeaponImmediate('rifle');
    vm.stopClip();
    vm.adsT = 0;
    const state = {
      ads: 0,
      sprint: 0,
      lowReady: false,
      speed: 0,
      crouch: false,
      airborne: false,
      trigger: 0,
      empty: false,
    };
    for (let i = 0; i < 60; i++) vm.update(1 / 60, state);
    await window.__PUMP__(1);
  });
  await captureNative(page, `${out}/clean.png`);
  await page.evaluate(() => {
    window.__ENGINE__.ctx.get('weapons').viewmodel.armAsset.blood.setHealthFraction(0.2);
  });
  await captureNative(page, `${out}/injured.png`);
  assert.deepEqual(errors, [], 'no browser/GPU validation errors during readback');
  writeFileSync(
    `${out}/report.json`,
    JSON.stringify({ device, reports, errors, warnings }, null, 2) + '\n'
  );
  console.log(
    `Arms: ${reports.length} weapon/pose native draw checks, independent 28-bone rigs, no late builders/errors; captures ${out}`
  );
} finally {
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
