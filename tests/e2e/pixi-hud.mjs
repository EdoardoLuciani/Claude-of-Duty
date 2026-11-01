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
  for (let i = 0; i < rounds; i++)
    modes.push(
      ...(args.combat || args.compass
        ? i % 2
          ? ['hud', args.compass ? 'bearing' : 'legacy']
          : [args.compass ? 'bearing' : 'legacy', 'hud']
        : args.underlays
          ? i % 2
            ? ['hud', 'html']
            : ['html', 'hud']
          : i % 2
            ? ['hud', 'dom']
            : ['dom', 'hud'])
    );
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
      `http://localhost:${port}/?capture=1&lockstep=1&q=${args.quality ?? 'high'}${mode === 'dom' ? '' : '&pixi=hud'}${mode === 'html' ? '&underlays=html' : ''}${mode === 'legacy' ? '&combat=html' : mode === 'bearing' ? '&compass=html' : ''}${args.icons ? '&icons=' + encodeURIComponent(String(args.icons)) : ''}`
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
        nativeInjury: getComputedStyle(ui.hurtLayer).display !== 'none',
        markerUiPresent:
          'markers' in ui ||
          'spawnGrenade' in ui ||
          'worldLayer' in ui ||
          (!!p && 'worldMarkers' in p),
        markerElements: document.querySelectorAll('.ow-mk, .ow-nade').length,
        gpuUnderlays: p?.gpuUnderlays ?? false,
        gpuCombat: p?.gpuCombat ?? false,
        iconStyle: p?.combat.iconStyle ?? null,
        gpuCompass: p?.gpuCompass ?? false,
        nativeCompass: getComputedStyle(ui.compass.root).display !== 'none',
        nativeFps: getComputedStyle(ui.fps).display !== 'none',
        nativeMap: getComputedStyle(ui.minimap.root).display !== 'none',
        nativeVitals: getComputedStyle(ui.health.vitals).display !== 'none',
        nativeCrosshair: getComputedStyle(ui.crosshair.root).display !== 'none',
        nativeEquipment: getComputedStyle(ui.ammo.equip).display !== 'none',
        equipmentItems: ui.ammo.equip.childElementCount,
        radioInventoryPresent:
          'slotR' in ui.ammo || 'slotRn' in ui.ammo || (p?.combat.slots.length ?? 2) !== 2,
        loads: performance
          .getEntriesByType('resource')
          .filter((e) => /pixi/i.test(e.name))
          .map((e) => e.name),
      };
    });
    assert.equal(setup.pixi, mode !== 'dom' && mode !== 'unavailable');
    assert.equal(setup.devices, 1);
    assert.equal(setup.webgl, 0);
    assert(setup.passive);
    assert.equal(setup.gpuCombat, setup.pixi && mode !== 'legacy');
    assert.equal(setup.gpuCompass, setup.gpuCombat && mode !== 'bearing');
    assert.equal(setup.nativeEquipment, !setup.gpuCombat);
    assert.equal(setup.equipmentItems, 2, 'HTML inventory contains only bandage and grenade');
    assert.equal(setup.radioInventoryPresent, false);
    assert.equal(setup.nativeFps, !setup.gpuCombat);
    assert.equal(setup.nativeCompass, !setup.gpuCompass);
    assert.equal(setup.nativeMap, !setup.pixi);
    assert.equal(setup.nativeVitals, !setup.pixi);
    assert.equal(setup.nativeCrosshair, !setup.pixi);
    if (setup.pixi) {
      assert(setup.shared);
      assert.equal(
        setup.iconStyle,
        ['text', 'original'].includes(args.icons) ? args.icons : 'simple'
      );
    }
    assert.equal(setup.gpuUnderlays, setup.pixi && mode !== 'html');
    assert.equal(setup.nativeInjury, !setup.gpuUnderlays);
    assert.equal(setup.markerUiPresent, false);
    assert.equal(setup.markerElements, 0);
    if (mode === 'dom') assert.deepEqual(setup.loads, [], 'default path does not fetch Pixi');
    let combat = null,
      metrics = null,
      checks = null;
    if (!['retina', 'unavailable'].includes(mode)) {
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
          updates = [],
          compassModel = [],
          compassView = [];
        let previous;
        const late = ui.lateUpdate;
        const modelUpdate = ui.compass.update,
          viewUpdate = p?.compass.update;
        ui.compass.update = function (...a) {
          const t = performance.now();
          try {
            return modelUpdate.apply(this, a);
          } finally {
            compassModel.push(performance.now() - t);
          }
        };
        if (p?.gpuCompass)
          p.compass.update = function (...a) {
            const t = performance.now();
            try {
              return viewUpdate.apply(this, a);
            } finally {
              compassView.push(performance.now() - t);
            }
          };
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
            if (p?.gpuCombat && p.combat.fps.text !== ui.fpsText)
              throw Error('FPS presentation mismatch');
            const ammo = p ? p.ammo.current.text : ui.ammo.cur.textContent;
            const hp = p ? p.hp.text : ui.health.hpVal.textContent;
            if (p && p.maxHp.text !== '/' + Math.round(s.maxHealth || 100))
              throw Error('health maximum readout mismatch');
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
          ui.compass.update = modelUpdate;
          if (p) p.compass.update = viewUpdate;
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
          compassModelMs: summary(compassModel),
          compassViewMs: compassView.length ? summary(compassView) : null,
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
    if (setup.pixi) {
      const pixels = await capturePixi(page, resolve(out, `${run}-${mode}.png`), 'hud');
      assert.deepEqual(pixels.panelAlpha, [0, 0], 'health/ammo panel areas stay transparent');
      assert(
        pixels.readoutPixels.every((count) => count > 10),
        'floating readouts actually render, including resized/DPR-2 captures'
      );
    } else await captureNative(page, resolve(out, `${run}-${mode}.png`));
    if (setup.pixi) {
      const feedback = await page.evaluate(async () => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui'),
          p = ui.pixiHud;
        const oldWeapon = ui._weaponState,
          oldPlayer = ui._playerState,
          oldFps = ui._updateFps;
        const fixture = { oldWeapon, oldPlayer, oldFps, mutations: 0 };
        window.__COMBAT_FIXTURE__ = fixture;
        ui._updateFps = () => {};
        ui.fpsText = '123 FPS';
        if (!p.gpuCombat) ui.fps.textContent = ui.fpsText;
        let empty = true;
        ui._weaponState = function () {
          return {
            ...oldWeapon.call(this),
            lethalCount: empty ? 0 : 3,
            cooking: !empty,
            grenadeEquipped: false,
          };
        };
        ui._playerState = function () {
          return { ...oldPlayer.call(this), bandages: empty ? 0 : 12, healing: !empty };
        };
        const observer = new MutationObserver((records) => {
          fixture.mutations += records.length;
        });
        const roots = [];
        if (p.gpuCombat)
          roots.push(
            ui.ammo.equip,
            ui.fps,
            ...ui.hit.pool.items.map((it) => it.node),
            ...ui.arcs.pool.items.map((it) => it.node)
          );
        if (p.gpuCompass) roots.push(ui.compass.root);
        for (const root of roots)
          observer.observe(root, {
            subtree: true,
            attributes: true,
            childList: true,
            characterData: true,
          });
        fixture.observer = observer;
        await window.__PUMP__(1);
        if (p.gpuCombat && !p.combat.slots.every((slot) => slot.node.alpha === 0.34))
          throw Error('empty equipment opacity');
        empty = false;
        ui.compass.ping(ui.compass.heading - 35);
        ui.compass.ping(ui.compass.heading + 35);
        ui.arcs.spawn(1, 0, 1);
        ui.arcs.spawn(-1, -1, 0.6);
        await window.__PUMP__(3);
        return { empty: true };
      });
      for (const kind of ['hit', 'armour', 'head', 'kill']) {
        await page.evaluate(async (kind) => {
          const ui = window.__ENGINE__.ctx.get('ui'),
            p = ui.pixiHud;
          ui.hit.clear();
          const item = ui.hit.spawn(kind);
          await window.__PUMP__(3);
          if (p.gpuCombat) {
            const view = p.combat.hitSlots[item.i],
              state = ui.hit.visuals[item.i];
            if (
              !view.node.visible ||
              view.kind !== kind ||
              view.mark.tint !==
                Number.parseInt(
                  { hit: '#f6fafc', armour: '#8fdcff', head: '#ffc247', kill: '#ff4433' }[
                    kind
                  ].slice(1),
                  16
                ) ||
              view.node.scale.x !== state.scale ||
              view.ring.alpha !== state.ringAlpha
            )
              throw Error('hit style/animation parity');
            for (let i = 0; i < 6; i++)
              if (
                ui.arcs.pool.items[i].alive &&
                p.combat.arcSlots[i].rotation !== ui.arcs.visuals[i].rotation
              )
                throw Error('damage arc direction');
            if (
              p.combat.slots.map((s) => s.label.text).join() !==
              (p.combat.iconStyle === 'text' ? 'BANDAGES 12,FRAGS 3' : '12,3')
            )
              throw Error('equipment count parity');
          }
          if (p.gpuCompass && p.compass.pings.filter((n) => n.visible).length < 2)
            throw Error('heard bearing pings missing');
        }, kind);
        await capturePixi(page, resolve(out, `${run}-${mode}-feedback-${kind}.png`), 'hud');
      }
      feedback.mutations = await page.evaluate(async () => {
        const ui = window.__ENGINE__.ctx.get('ui'),
          f = window.__COMBAT_FIXTURE__;
        ui.hit.clear();
        ui.arcs.clear();
        ui.compass.pingPool.releaseAll(ui.compass.present);
        const n = f.mutations + f.observer.takeRecords().length;
        f.observer.disconnect();
        ui._weaponState = f.oldWeapon;
        ui._playerState = f.oldPlayer;
        ui._updateFps = f.oldFps;
        await window.__PUMP__(60);
        delete window.__COMBAT_FIXTURE__;
        return n;
      });
      assert.equal(
        feedback.mutations,
        0,
        'replaced combat DOM must never update, including spawn/clear/FPS/pulses'
      );
      await page.evaluate(async () => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui');
        window.__UNDERLAY_MUTATIONS__ = 0;
        window.__UNDERLAY_OBSERVER__ = new MutationObserver((records) => {
          window.__UNDERLAY_MUTATIONS__ += records.length;
        });
        for (const root of [ui.hurtLayer])
          window.__UNDERLAY_OBSERVER__.observe(root, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true,
          });
        e.ctx.get('player').health.armour = 0;
        e.ctx.get('player').applyDamage(65, null);
        await window.__PUMP__(6);
      });
      const underlayMutations = await page.evaluate(() => {
        const n = window.__UNDERLAY_MUTATIONS__ + window.__UNDERLAY_OBSERVER__.takeRecords().length;
        window.__UNDERLAY_OBSERVER__.disconnect();
        return n;
      });
      if (setup.gpuUnderlays)
        assert.equal(underlayMutations, 0, 'migrated native layers are not updated behind Pixi');
      else assert(underlayMutations > 0);
      const injured = await capturePixi(page, resolve(out, `${run}-${mode}-injured.png`), 'hud');
      if (setup.gpuUnderlays)
        assert(
          injured.cornerAlpha.some((alpha) => alpha > 0),
          'injury really renders into GPU target'
        );
      const independentInjury = await page.evaluate(async () => {
        const ui = window.__ENGINE__.ctx.get('ui'),
          p = ui.pixiHud;
        ui.setHudVisible(false);
        await window.__PUMP__(60);
        const ok =
          !p.chrome.visible &&
          (!p.gpuUnderlays ||
            (p.injury.mesh.visible &&
              p.injury.mesh.parent === p.stage &&
              p.stage.alpha === 1 &&
              Number(p.canvas.style.opacity || 1) === 1));
        ui.setHudVisible(true);
        return ok;
      });
      assert(independentInjury, 'HUD fading must not fade injury feedback');
      await page.evaluate(async () => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui');
        e.ctx.get('player').health.reset(true);
        ui.arcs.clear();
        ui.hit.clear();
        await window.__PUMP__(180);
      });
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
        // Injury and vitals share the existing health state in both renderers.
        player.applyDamage(10);
        await window.__PUMP__(3);
        const armour = p.armourFill.scale.x;
        if (armour >= 1 || Math.abs(armour - ui.state.armour / (ui.state.maxArmour || 150)) > 1e-8)
          throw Error('armour damage/count not presented');
        player.health.armour = 0;
        player.health.value = 20;
        await window.__PUMP__(30);
        if (p.hp.text !== '20' || p.hp.tint !== 0xff5145) throw Error('critical HP not presented');
        player.health.value = 100;
        await window.__PUMP__(30);
        ui.menu.show();
        // HUD opacity is now a GPU group fade, separate from injury opacity.
        await window.__PUMP__(60);
        const sampleFps = ui._updateFps;
        ui._updateFps = () => {}; // unchanged-content test; live FPS changes tested separately below
        try {
          const draws = p.draws;
          await window.__PUMP__(30);
          if (p.draws !== draws) throw Error('paused static HUD redraws');
          if (p.gpuCombat) {
            ui.fpsText = '123 FPS';
            await window.__PUMP__(1);
            if (p.combat.fps.text !== '123 FPS' || p.draws !== draws + 1)
              throw Error('paused FPS must invalidate once');
            await window.__PUMP__(5);
            if (p.draws !== draws + 1) throw Error('unchanged FPS redraws');
          }
        } finally {
          ui._updateFps = sampleFps;
        }
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
        const counts = [],
          originalYaw = player.yaw;
        for (let cycle = 0; cycle < 3; cycle++) {
          for (let i = 0; i < 60; i++) {
            w.state.mag = i % 12;
            player.health.value = 20 + i;
            player.movement.yaw = (i * Math.PI) / 30; // warm every cardinal and cross north repeatedly
            await window.__PUMP__(1);
          }
          await p.renderer.gpu.device.queue.onSubmittedWorkDone();
          counts.push(p.renderer.texture.managedTextures.length);
        }
        player.movement.yaw = originalYaw;
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
        const death = ui.hudVisible < 0.004 && !p.chrome.visible;
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
      underlayComparison: !!args.underlays,
      combatComparison: !!args.combat,
      compassComparison: !!args.compass,
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
