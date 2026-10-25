/** Native arm draws, prewarming and sleeve-only blood; review captures are disposable. */
import assert from 'node:assert/strict';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
  collectBrowserErrors,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';

const port = 5403;
const server = await ensureViteServer({ port });
assert(server, 'use an unused port');
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  collectBrowserErrors(page, errors);
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon&q=high`);
  await waitForGame(page);
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
        report.scopedADS ? 0 : 2,
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
    }
  }
  assert.deepEqual(errors, [], 'no browser/GPU validation errors');
  // Real glove coordinates can lie outside the spatial stain mask even when
  // eligibility is broken. Probe the SAME loaded material with each surface ID
  // at one stain-supported bind coordinate, independent of skin/health/post FX.
  const bloodProbe = await page.evaluate(async () => {
    const { THREE: T } = await import('/tools/arm-material-fixture.js');
    const vm = window.__ENGINE__.ctx.get('weapons').viewmodel;
    const blood = vm.armAsset.blood;
    const renderer = window.__ENGINE__.ctx.get('render').renderer;
    const target = new T.RenderTarget(320, 64, { type: T.FloatType, depthBuffer: false });
    const previous = renderer.getRenderTarget(),
      face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel();
    const amount = blood.amount.value;
    const scene = new T.Scene();
    scene.background = new T.Color(0);
    scene.add(new T.HemisphereLight(0xffffff, 0x777777, 2));
    const light = new T.DirectionalLight(0xffffff, 3);
    light.position.set(0, 0, 2);
    scene.add(light);
    const camera = new T.OrthographicCamera(-1, 9, 1, -1, 0.1, 10);
    camera.position.z = 2;
    const geometries = [];
    const angle = (0.1 - 0.5) * Math.PI * 2;
    for (let surface = 0; surface < 5; surface++) {
      const geometry = new T.PlaneGeometry(1.8, 1.8);
      const count = geometry.attributes.position.count;
      geometry.setAttribute('uv1', geometry.attributes.uv.clone());
      geometry.setAttribute(
        'armSurface',
        new T.Float32BufferAttribute(new Float32Array(count).fill(surface), 1)
      );
      const bind = new Float32Array(count * 3);
      for (let i = 0; i < count; i++)
        bind.set([0.035 * Math.cos(angle), 0.035 * Math.sin(angle), 0.095], i * 3);
      geometry.setAttribute('armBloodPosition', new T.Float32BufferAttribute(bind, 3));
      const material = vm.armAsset.meshes[vm.armAsset.meshes.length === 1 ? 0 : surface].material;
      const mesh = new T.Mesh(geometry, material);
      mesh.position.x = surface * 2;
      scene.add(mesh);
      geometries.push(geometry);
    }
    try {
      const read = async (health) => {
        blood.setHealthFraction(health);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 320, 64);
        if (pixels.length !== 320 * 64 * 4) throw new Error('incomplete native blood probe');
        return pixels;
      };
      const healthy = await read(1);
      const builders = window.__NATIVE_BUILDS__;
      const injured = await read(0.2);
      const surfaces = [
        'Charcoal_woven_glove',
        'Flexible_knuckle_rubber',
        'Grained_suede_reinforcement',
        'Olive_ripstop',
        'Olive_stitch',
      ];
      return {
        uniformOnlyBuilders: window.__NATIVE_BUILDS__ - builders,
        surfaces: surfaces.map((name, surface) => {
          let maxDifference = 0,
            totalDifference = 0,
            healthySignal = 0,
            samples = 0;
          for (let y = 24; y < 40; y++)
            for (let x = surface * 64 + 24; x < surface * 64 + 40; x++)
              for (let channel = 0; channel < 3; channel++) {
                const i = (y * 320 + x) * 4 + channel;
                if (!Number.isFinite(healthy[i]) || !Number.isFinite(injured[i]))
                  throw new Error('nonfinite native blood pixel');
                const difference = Math.abs(healthy[i] - injured[i]);
                maxDifference = Math.max(maxDifference, difference);
                totalDifference += difference;
                healthySignal += healthy[i];
                samples++;
              }
          return {
            name,
            samples,
            maxDifference,
            meanDifference: totalDifference / samples,
            healthySignal: healthySignal / samples,
          };
        }),
      };
    } finally {
      blood.amount.value = amount;
      renderer.setRenderTarget(previous, face, mip);
      for (const geometry of geometries) geometry.dispose();
      target.dispose();
    }
  });
  assert.deepEqual(errors, [], 'no browser/GPU validation errors during readback');
  assert.equal(
    bloodProbe.uniformOnlyBuilders,
    0,
    'blood uniform change must not create a shader variant'
  );
  for (const [surface, result] of bloodProbe.surfaces.entries()) {
    assert(result.healthySignal > 0.001, `${result.name}: probe must draw a lit authored surface`);
    if (surface < 3)
      assert(
        result.maxDifference <= 1e-6,
        `blood eligibility: ${result.name} must remain unchanged`
      );
    else
      assert(result.meanDifference > 0.001, `blood eligibility: ${result.name} must visibly stain`);
  }
  console.log('PASS arm draws/rigs, prewarming and native sleeve-only blood eligibility');
} finally {
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
