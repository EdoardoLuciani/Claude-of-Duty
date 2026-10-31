// node tests/e2e/pixi-hud.mjs --uncapped --rounds=2 --out=/tmp/pixi-hud
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  collectBrowserErrors,
  stopViteServer,
  parseArgs,
} from '../../tools/lib/browser-harness.mjs';
import { combatLane } from '../../tools/lib/combat-fixture.js';
import { waitForGame, captureNative } from '../../tools/lib/native-render.mjs';
import { createCombatProfile, validateCombatProfile } from '../../tools/lib/profile-combat.js';
import { capturePixi } from '../lib/pixi-capture.mjs';

const args = parseArgs(),
  port = Number(args.port ?? 5197),
  rounds = Number(args.rounds ?? 2),
  out = resolve(String(args.out ?? '/tmp/pixi-hud'));
await mkdir(out, { recursive: true });
const server = await ensureViteServer({ port, preview: Boolean(args.preview) });
const browser = await launchChromium({
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    ...(args.uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
  ],
});
const results = [];
try {
  const modes = [];
  for (let i = 0; i < rounds; i++) modes.push(...(i % 2 ? ['hud', 'dom'] : ['dom', 'hud']));
  modes.push('retina', 'unavailable');
  for (const [run, mode] of modes.entries()) {
    const page = await browser.newPage({
      viewport: mode === 'retina' ? { width: 960, height: 900 } : { width: 1920, height: 1080 },
      deviceScaleFactor: mode === 'retina' ? 2 : 1,
    });
    if (args.preview) {
      await page.goto(`http://localhost:${port}/LICENSE.txt`);
      await page.waitForFunction(
        async () =>
          (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }))?.info
            .isFallbackAdapter === false,
        null,
        { timeout: 15000 }
      );
    }
    const errors = [];
    collectBrowserErrors(page, errors, { validationMessages: true });
    await page.addInitScript((unavailable) => {
      const adapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
      let count = 0;
      navigator.gpu.requestAdapter = (...a) =>
        unavailable && ++count > 1 ? Promise.resolve(null) : adapter(...a);
      window.__GPU_PROBE__ = { devices: 0, destroys: 0, webgl: 0 };
      const make = GPUAdapter.prototype.requestDevice,
        destroy = GPUDevice.prototype.destroy,
        context = HTMLCanvasElement.prototype.getContext;
      GPUAdapter.prototype.requestDevice = function (...a) {
        window.__GPU_PROBE__.devices++;
        return make.apply(this, a);
      };
      GPUDevice.prototype.destroy = function () {
        window.__GPU_PROBE__.destroys++;
        return destroy.call(this);
      };
      HTMLCanvasElement.prototype.getContext = function (type, ...a) {
        if (/^(webgl2?|experimental-webgl)$/.test(type)) window.__GPU_PROBE__.webgl++;
        return context.call(this, type, ...a);
      };
    }, mode === 'unavailable');
    await page.goto(
      `http://localhost:${port}/?capture=1&lockstep=1&q=${args.quality ?? 'high'}${mode === 'dom' ? '' : '&pixi=hud'}`
    );
    const device = await waitForGame(page);
    // Known upstream prewarm warning; all other errors/validation failures fail.
    errors.splice(
      0,
      errors.length,
      ...errors.filter((s) => !/THREE.TSL: Return statement used/.test(s))
    );
    const setup = await page.evaluate(() => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        p = ui.pixiHud;
      window.__NATIVE_COUNTS__ = { map: 0, ammo: 0 };
      for (const [obj, key, name] of [
        [ui.minimap, 'draw', 'map'],
        [ui.ammo, '_updateReadout', 'ammo'],
      ]) {
        const fn = obj[key];
        obj[key] = function (...a) {
          window.__NATIVE_COUNTS__[name]++;
          return fn.apply(this, a);
        };
      }
      return {
        ...window.__GPU_PROBE__,
        pixi: !!p,
        shared: p?.renderer.gpu.device === e.ctx.get('render').renderer.backend.device,
        passive:
          !p ||
          (p.stage.eventMode === 'none' && getComputedStyle(p.canvas).pointerEvents === 'none'),
        nativeMap: getComputedStyle(ui.minimap.root).display !== 'none',
        nativeVitals: getComputedStyle(ui.health.vitals).display !== 'none',
        nativeCrosshair: getComputedStyle(ui.crosshair.root).display !== 'none',
        nativeEquipment: getComputedStyle(ui.ammo.equip).display !== 'none',
        loads: performance
          .getEntriesByType('resource')
          .filter((e) => /pixi/i.test(e.name))
          .map((e) => e.name),
      };
    });
    assert.equal(setup.pixi, mode !== 'dom' && mode !== 'unavailable');
    assert.equal(setup.devices, 1);
    assert.equal(setup.webgl, 0);
    assert(setup.passive && setup.nativeEquipment);
    assert.equal(setup.nativeMap, !setup.pixi);
    assert.equal(setup.nativeVitals, !setup.pixi);
    assert.equal(setup.nativeCrosshair, !setup.pixi);
    if (setup.pixi) assert(setup.shared);
    if (mode === 'dom') assert.deepEqual(setup.loads, [], 'default path does not fetch Pixi');
    let combat = null,
      metrics = null,
      checks = null;
    if (mode === 'dom' || mode === 'hud') {
      await page.addScriptTag({
        content: `window.__PROFILE__={lane:${combatLane.toString()},create:${createCombatProfile.toString()}};`,
      });
      await page.evaluate(async () => {
        const e = window.__ENGINE__;
        e.ctx.get('render').settings.autoExposure = false;
        window.__HUD_FIXTURE__ = window.__PROFILE__.create(e, window.__PROFILE__.lane);
        for (let i = 0; i < 180; i++) {
          window.__HUD_FIXTURE__.before(-1);
          await window.__PUMP__(1);
        }
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const before = (await cdp.send('Performance.getMetrics')).metrics;
      combat = await page.evaluate(async () => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui'),
          f = window.__HUD_FIXTURE__,
          p = ui.pixiHud;
        const steps = [],
          intervals = [],
          updates = [];
        let previous;
        const late = ui.lateUpdate;
        ui.lateUpdate = function (...a) {
          const at = performance.now();
          try {
            return late.apply(this, a);
          } finally {
            updates.push(performance.now() - at);
          }
        };
        try {
          for (let i = 0; i < 900; i++) {
            await new Promise(requestAnimationFrame);
            const at = performance.now();
            if (previous !== undefined) intervals.push(at - previous);
            previous = at;
            f.before(i);
            const start = performance.now();
            e.step();
            steps.push(performance.now() - start);
            f.after();
            const s = ui.state;
            const ammo = p ? p.ammo.current.text : ui.ammo.cur.textContent;
            const hp = p ? p.hp.text : ui.health.hpVal.textContent;
            if (
              Number(ammo) !== s.ammo ||
              Number(hp) !== Math.round(Math.max(0, Math.min(s.maxHealth, s.health)))
            )
              throw Error('live HUD readout mismatch');
            if (
              p &&
              (Math.abs(p.hpFill.scale.x - ui.health.hpShown) > 1e-6 ||
                p.reticle.visible !== ui.crosshair.visible >= 0.004)
            )
              throw Error('live animated state mismatch');
          }
        } finally {
          ui.lateUpdate = late;
          f.dispose();
        }
        const summary = (a) => {
          a.sort((a, b) => a - b);
          return {
            median: a[Math.floor(a.length / 2)],
            p95: a[Math.floor(a.length * 0.95)],
            mean: a.reduce((s, v) => s + v, 0) / a.length,
          };
        };
        return {
          stepMs: summary(steps),
          intervalMs: summary(intervals),
          uiMs: summary(updates),
          report: f.report,
          native: window.__NATIVE_COUNTS__,
          mapUploads: p?.minimap.uploads ?? 0,
          textures: p?.renderer.texture.managedTextures.length ?? 0,
        };
      });
      validateCombatProfile(combat.report);
      const after = (await cdp.send('Performance.getMetrics')).metrics;
      metrics = {};
      for (const key of ['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'])
        metrics[key] =
          (1000 *
            (after.find((m) => m.name === key).value - before.find((m) => m.name === key).value)) /
          900;
      if (setup.pixi) {
        assert.deepEqual(combat.native, { map: 0, ammo: 0 });
        assert.equal(combat.mapUploads, 1);
      }
    }
    // Identical settled capture state for both backends; readback outside timing.
    await page.evaluate(async () => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        ai = e.ctx.get('ai');
      for (const actor of ai.agents) actor.dispose();
      ai.agents.length = 0;
      ai.squads.length = 0;
      e.input.enabled = false;
      e.input.frozen = true;
      e.ctx.get('weapons').resetForNewGame();
      e.ctx.get('player').health.reset(true);
      e.ctx.get('player').health.armour = 150;
      ui.arcs.clear();
      ui.hit.clear();
      await window.__PUMP__(180);
    });
    if (setup.pixi) await capturePixi(page, resolve(out, `${run}-${mode}.png`), 'hud');
    else await captureNative(page, resolve(out, `${run}-${mode}.png`));
    if (setup.pixi) {
      checks = await page.evaluate(async () => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui'),
          p = ui.pixiHud,
          player = e.ctx.get('player'),
          w = e.ctx.get('weapons'),
          ai = e.ctx.get('ai');
        for (const actor of ai.agents) actor.dispose();
        ai.agents.length = 0;
        ai.squads.length = 0;
        e.input.enabled = false;
        e.input.frozen = true;
        w.resetForNewGame();
        player.health.reset(true);
        player.health.armour = 150;
        await window.__PUMP__(60);
        // Native DOM injury feedback stays; this slice only replaces vitals.
        player.applyDamage(10);
        await window.__PUMP__(3);
        const armour = p.plates.map((n) => n.scale.x);
        if (armour.every((v) => v === 1)) throw Error('armour damage not presented');
        player.health.armour = 0;
        player.health.value = 20;
        await window.__PUMP__(30);
        if (p.hp.text !== '20' || p.hp.tint !== 0xff5145) throw Error('critical HP not presented');
        player.health.value = 100;
        await window.__PUMP__(30);
        ui.menu.show();
        await window.__PUMP__(30);
        const draws = p.draws;
        await window.__PUMP__(30);
        if (p.draws !== draws) throw Error('paused static HUD redraws');
        ui.menu.close();
        await window.__PUMP__(30);
        ui.setHudVisible(false);
        await window.__PUMP__(60);
        const hidden = p.draws;
        await window.__PUMP__(20);
        if (p.draws !== hidden) throw Error('hidden HUD redraws');
        ui.setHudVisible(true);
        await window.__PUMP__(60);
        w.state.mag = 7;
        w.state.chambered = true;
        if (!w.reload()) throw Error('reload failed');
        await window.__PUMP__(45);
        if (p.ammo.prompt.text !== 'RELOADING') throw Error('reload progress missing');
        if (!w.setWeapon('pistol')) throw Error('switch failed');
        await window.__PUMP__(100);
        if (!p.ammo.name.text.includes('P320')) throw Error('weapon name missing');
        const counts = [];
        for (let cycle = 0; cycle < 3; cycle++) {
          for (let i = 0; i < 60; i++) {
            w.state.mag = i % 12;
            player.health.value = 20 + i;
            await window.__PUMP__(1);
          }
          await p.renderer.gpu.device.queue.onSubmittedWorkDone();
          counts.push(p.renderer.texture.managedTextures.length);
        }
        player.health.reset(true);
        w.resetForNewGame();
        await window.__PUMP__(60);
        return {
          armour,
          counts,
          uploads: p.minimap.uploads,
          width: p.canvas.width,
          height: p.canvas.height,
          resolution: p.renderer.resolution,
          deviceLost: e.error?.message ?? null,
        };
      });
      assert.equal(checks.uploads, 1);
      assert.equal(checks.counts.at(-1), checks.counts.at(-2), 'text textures plateau');
      assert.equal(checks.deviceLost, null);
      await page.setViewportSize({ width: 800, height: 1000 });
      await page.evaluate(() => window.__PUMP__(3));
      const resize = await page.evaluate(() => {
        const p = window.__ENGINE__.ctx.get('ui').pixiHud;
        return [p.renderer.screen.width, p.renderer.screen.height, p.canvas.width, p.canvas.height];
      });
      assert.deepEqual(resize, [800, 1000, 800 * checks.resolution, 1000 * checks.resolution]);
      checks.lifecycle = await page.evaluate(async () => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui'),
          p = ui.pixiHud;
        const pointerTransparent =
          document.elementFromPoint(innerWidth / 2, innerHeight / 2) === e.canvas;
        ui.debugState('market');
        await window.__PUMP__(30);
        const shop = e.time.scale === 0 && ui.shop.active;
        e.ctx.get('market').closeShop();
        await window.__PUMP__(30);
        e.ctx.get('player').applyDamage(20000, null);
        await window.__PUMP__(90);
        const death = ui.hudVisible < 0.004 && !p.enabled;
        e.events.emit('game:restart', { source: 'pixi-hud-test' });
        await window.__PUMP__(90);
        const restart = ui.hudVisible > 0.99 && p.enabled;
        ui.installStartGate();
        await window.__PUMP__(2);
        const waiting = !p.enabled && e.gameplaySuspended;
        e.fail('ui', 'pixiHudFixture', new Error('intentional HUD terminal check'));
        const terminal = !p.enabled && !!document.getElementById('engine-failure');
        return { pointerTransparent, shop, death, restart, waiting, terminal };
      });
      assert(Object.values(checks.lifecycle).every(Boolean), JSON.stringify(checks.lifecycle));
      errors.splice(
        0,
        errors.length,
        ...errors.filter((s) => !s.includes('[engine] ui pixiHudFixture failed; reload required'))
      );
    }
    const teardown = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        p = e.ctx.get('ui').pixiHud;
      await e.dispose();
      p?.dispose();
      return {
        ...window.__GPU_PROBE__,
        canvases: document.querySelectorAll('.ow-pixi-hud-slice').length,
      };
    });
    assert.equal(teardown.destroys, 1, 'only Three destroys the borrowed device');
    assert.equal(teardown.webgl, 0);
    assert.equal(teardown.canvases, 0);
    assert.deepEqual(errors, []);
    const result = {
      run,
      mode,
      browser: browser.version(),
      quality: args.quality ?? 'high',
      uncapped: !!args.uncapped,
      device,
      setup,
      combat,
      metrics,
      checks,
      teardown,
    };
    results.push(result);
    await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(
      JSON.stringify({
        run,
        mode,
        step: combat?.stepMs,
        interval: combat?.intervalMs,
        ui: combat?.uiMs,
        metrics,
        checks,
      })
    );
    await page.close();
  }
} finally {
  await browser.close();
  stopViteServer(server);
}
