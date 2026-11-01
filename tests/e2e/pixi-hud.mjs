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
import { waitForGame } from '../../tools/lib/native-render.mjs';
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
  assert(!args.combat && !args.compass && !args.underlays, 'HTML comparison modes are retired');
  const modes = [
    ...Array.from({ length: rounds }, () => 'hud'),
    'retina',
    'old-flags',
    'unavailable',
  ];
  for (const [run, mode] of modes.entries()) {
    const page = await browser.newPage({
      viewport: mode === 'retina' ? { width: 960, height: 900 } : { width: 1920, height: 1080 },
      deviceScaleFactor: mode === 'retina' ? 2 : 1,
    });
    {
      // Metadata-only preflight avoids cold Chromium adapter startup races.
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
      // Dev-mode module graphs exceed the browser's default 250 resource entries.
      performance.setResourceTimingBufferSize(10000);
      const adapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
      let count = 0;
      navigator.gpu.requestAdapter = (...a) =>
        unavailable && sessionStorage.getItem('allowHud') !== '1' && ++count > 1
          ? Promise.resolve(null)
          : adapter(...a);
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
      `http://localhost:${port}/?capture=1&lockstep=1&q=${args.quality ?? 'high'}${mode === 'old-flags' ? '&pixi=ammo&underlays=html&combat=html&compass=html&icons=text' : ''}`
    );
    if (mode === 'unavailable') {
      await page.waitForSelector('#engine-failure', { timeout: 20000 });
      const failed = await page.evaluate(() => {
        const dialog = document.getElementById('engine-failure');
        return {
          ...window.__GPU_PROBE__,
          message: dialog.textContent,
          reload: !!dialog.querySelector('button'),
          pixi: !!document.querySelector('canvas.ow-pixi-hud'),
          ready: window.__READY__ === true,
          enginePublished: !!window.__ENGINE__,
          legacy: document.querySelectorAll(
            '.ow-ammo,.ow-cross,.ow-vitals,.ow-blood,.ow-compass,.ow-fps,.ow-minimap,.ow-hit,.ow-dmg'
          ).length,
        };
      });
      assert.match(failed.message, /Could not query matching adapter metadata/);
      assert(failed.reload);
      assert.equal(failed.pixi, false);
      assert.equal(failed.ready, false);
      assert.equal(failed.enginePublished, false);
      assert.equal(failed.legacy, 0);
      assert.equal(failed.devices, 1);
      assert.equal(failed.destroys, 0);
      assert.equal(failed.webgl, 0);
      // Unblock the next navigation and activate the real native Reload button.
      await page.evaluate(() => sessionStorage.setItem('allowHud', '1'));
      await Promise.all([
        page.waitForEvent('load'),
        page.locator('#engine-failure button').click(),
      ]);
      await waitForGame(page);
      assert.equal(await page.evaluate(() => !!window.__ENGINE__.ctx.get('ui').pixiHud), true);
      await page.evaluate(() => window.__ENGINE__.dispose());
      assert.equal(await page.evaluate(() => window.__GPU_PROBE__.destroys), 1);
      assert.deepEqual(
        errors.filter(
          (x) =>
            !x.includes('Could not query matching adapter metadata') &&
            !x.includes('THREE.TSL: Return statement used')
        ),
        []
      );
      results.push({ run, mode, failed, reloadRecovered: true });
      await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ run, mode, failed }));
      await page.close();
      continue;
    }
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
      if (!p) throw Error('Required default HUD did not initialize');
      return {
        ...window.__GPU_PROBE__,
        shared: p.renderer.gpu.device === e.ctx.get('render').renderer.backend.device,
        passive:
          p.stage.eventMode === 'none' && getComputedStyle(p.canvas).pointerEvents === 'none',
        legacyElements: document.querySelectorAll(
          '.ow-ammo,.ow-cross,.ow-vitals,.ow-blood,.ow-lowbeat,.ow-hitflash,.ow-compass,.ow-fps,.ow-minimap,.ow-hit,.ow-dmg'
        ).length,
        legacyModels:
          'draw' in ui.minimap ||
          '_updateReadout' in ui.ammo ||
          'root' in ui.crosshair ||
          'vitals' in ui.health ||
          'hurtLayer' in ui ||
          'pixiExperiment' in ui,
        stateOnlyPools: [
          ...ui.hit.pool.items,
          ...ui.arcs.pool.items,
          ...ui.compass.pingPool.items,
        ].every((x) => x.node === null),
        equipmentItems: p.combat.slots.length,
        radioInventoryPresent: 'slotR' in ui.ammo || 'slotRn' in ui.ammo,
        markerUiPresent: 'markers' in ui || 'spawnGrenade' in ui || 'worldLayer' in ui,
        markerElements: document.querySelectorAll('.ow-mk,.ow-nade').length,
        loads: performance
          .getEntriesByType('resource')
          .filter((e) => /pixi/i.test(e.name))
          .map((e) => e.name),
      };
    });
    assert.equal(setup.devices, 1);
    assert.equal(setup.webgl, 0);
    assert(setup.passive);
    assert(setup.shared);
    assert.equal(setup.legacyElements, 0);
    assert.equal(setup.legacyModels, false);
    assert(setup.stateOnlyPools);
    assert.equal(setup.equipmentItems, 2);
    assert.equal(setup.radioInventoryPresent, false);
    assert.equal(
      await page.evaluate(() => {
        const p = window.__ENGINE__.ctx.get('ui').pixiHud;
        return (
          p.hp.style.fontSize === 32 &&
          p.ammo.current.style.fontSize === 32 &&
          p.maxHp.style.fontSize === 16 &&
          p.ammo.reserve.style.fontSize === 16 &&
          p.combat.slots.every((s) => s.label.style.fontSize === 16) &&
          Math.abs(p.vitals.y + p.hp.y - p.ammo.stage.y - p.ammo.current.y) < 1e-6
        );
      }),
      true,
      'shared bottom-HUD typography and aligned numeric baselines'
    );
    assert.equal(setup.markerUiPresent, false);
    assert.equal(setup.markerElements, 0);
    assert(setup.loads.length > 0, 'default path loads Pixi');
    let combat = null,
      metrics = null,
      checks = null;
    if (mode === 'hud') {
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
          viewUpdate = p.compass.update;
        ui.compass.update = function (...a) {
          const t = performance.now();
          try {
            return modelUpdate.apply(this, a);
          } finally {
            compassModel.push(performance.now() - t);
          }
        };
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
            if (p.combat.fps.text !== ui.fpsText) throw Error('FPS presentation mismatch');
            const ammo = p.ammo.current.text,
              hp = p.hp.text;
            if (p.maxHp.text !== '/' + Math.round(s.maxHealth || 100))
              throw Error('health maximum readout mismatch');
            if (
              Number(ammo) !== s.ammo ||
              Number(hp) !== Math.round(Math.max(0, Math.min(s.maxHealth, s.health)))
            )
              throw Error('live HUD readout mismatch');
            if (
              Math.abs(p.hpFill.scale.x - ui.health.hpShown) > 1e-6 ||
              p.reticle.visible !== ui.crosshair.visible >= 0.004
            )
              throw Error('live animated state mismatch');
          }
        } finally {
          ui.lateUpdate = late;
          ui.compass.update = modelUpdate;
          p.compass.update = viewUpdate;
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
          nativeElements: document.querySelectorAll('.ow-ammo,.ow-vitals,.ow-cross,.ow-minimap')
            .length,
          mapUploads: p.minimap.uploads,
          textures: p.renderer.texture.managedTextures.length,
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
      assert.equal(combat.nativeElements, 0);
      assert.equal(combat.mapUploads, 1);
    }
    // Settled validation pose; GPU readback is outside timing.
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
    const pixels = await capturePixi(page, resolve(out, `${run}-${mode}.png`));
    assert.deepEqual(pixels.panelAlpha, [0, 0], 'health/ammo panel areas stay transparent');
    assert(
      pixels.readoutPixels.every((count) => count > 10),
      'floating readouts actually render, including resized/DPR-2 captures'
    );
    const feedback = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        p = ui.pixiHud;
      const oldWeapon = ui._weaponState,
        oldPlayer = ui._playerState,
        oldFps = ui._updateFps;
      const fixture = { oldWeapon, oldPlayer, oldFps };
      window.__COMBAT_FIXTURE__ = fixture;
      ui._updateFps = () => {};
      ui.fpsText = '123 FPS';
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
      await window.__PUMP__(1);
      if (!p.combat.slots.every((slot) => slot.node.alpha === 0.34))
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
        {
          const view = p.combat.hitSlots[item.i],
            state = ui.hit.visuals[item.i];
          if (
            !view.node.visible ||
            view.kind !== kind ||
            view.mark.tint !==
              Number.parseInt(
                { hit: '#f6fafc', armour: '#8fdcff', head: '#ffc247', kill: '#ff4433' }[kind].slice(
                  1
                ),
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
          if (p.combat.slots.map((s) => s.label.text).join() !== '12,3')
            throw Error('equipment count parity');
        }
        if (p.compass.pings.filter((n) => n.visible).length < 2)
          throw Error('heard bearing pings missing');
      }, kind);
      await capturePixi(page, resolve(out, `${run}-${mode}-feedback-${kind}.png`));
    }
    feedback.nativeElements = await page.evaluate(async () => {
      const ui = window.__ENGINE__.ctx.get('ui'),
        f = window.__COMBAT_FIXTURE__;
      ui.hit.clear();
      ui.arcs.clear();
      ui.compass.pingPool.releaseAll();
      const n = document.querySelectorAll('.ow-hit,.ow-dmg,.ow-compass,.ow-equip,.ow-fps').length;
      ui._weaponState = f.oldWeapon;
      ui._playerState = f.oldPlayer;
      ui._updateFps = f.oldFps;
      await window.__PUMP__(60);
      delete window.__COMBAT_FIXTURE__;
      return n;
    });
    assert.equal(feedback.nativeElements, 0, 'retired combat DOM must not exist or be recreated');
    await page.evaluate(async () => {
      const e = window.__ENGINE__;
      e.ctx.get('player').health.armour = 0;
      e.ctx.get('player').applyDamage(65, null);
      await window.__PUMP__(6);
    });
    assert.equal(
      await page.evaluate(
        () => document.querySelectorAll('.ow-blood,.ow-lowbeat,.ow-hitflash').length
      ),
      0,
      'native injury presenter is absent'
    );
    const injured = await capturePixi(page, resolve(out, `${run}-${mode}-injured.png`));
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
        p.injury.mesh.visible &&
        p.injury.mesh.parent === p.stage &&
        p.stage.alpha === 1 &&
        Number(p.canvas.style.opacity || 1) === 1;
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
      // Injury and vitals consume the same existing health state.
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
        {
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
    const teardown = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        p = e.ctx.get('ui').pixiHud;
      await e.dispose();
      p.dispose();
      return {
        ...window.__GPU_PROBE__,
        canvases: document.querySelectorAll('.ow-pixi-hud').length,
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
