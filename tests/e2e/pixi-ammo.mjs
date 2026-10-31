// Real combat A/B + targeted state/lifecycle checks. No performance pass threshold.
// node tests/e2e/pixi-ammo.mjs --rounds=2 --out=/tmp/pixi-ammo
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
  port = Number(args.port ?? 5196),
  out = resolve(String(args.out ?? '/tmp/pixi-ammo'));
const rounds = Number(args.rounds ?? 2);
await mkdir(out, { recursive: true });
const server = await ensureViteServer({ port, preview: Boolean(args.preview) });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist'] });
const results = [];
try {
  const modes = [];
  for (let i = 0; i < rounds; i++) modes.push(...(i % 2 ? ['ammo', 'dom'] : ['dom', 'ammo']));
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
      const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
      let adapters = 0;
      navigator.gpu.requestAdapter = (...a) =>
        unavailable && ++adapters > 1 ? Promise.resolve(null) : request(...a);
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
      `http://localhost:${port}/?capture=1&lockstep=1&q=low${mode === 'dom' ? '' : '&pixi=ammo'}`
    );
    const device = await waitForGame(page);
    errors.splice(
      0,
      errors.length,
      ...errors.filter((s) => !/THREE.TSL: Return statement used/.test(s))
    );
    const setup = await page.evaluate(() => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        p = ui.ammo.pixi;
      window.__AMMO_CHECK__ = () => {
        const s = ui.state,
          a = ui.ammo,
          p = a.pixi;
        const value = p ? p.current.text : a.cur.textContent;
        const reserve = p ? p.reserve.text : `/ ${a.res.textContent}`;
        const name = p ? p.name.text : a.name.textContent;
        if (Number(value) !== s.ammo || reserve !== `/ ${s.reserve}` || name !== s.weaponName)
          throw new Error(
            `HUD mismatch: ${value}/${reserve}/${name} vs ${s.ammo}/${s.reserve}/${s.weaponName}`
          );
        return {
          ammo: Number(value),
          reserve: s.reserve,
          name,
          reloading: s.reloading,
          prompt: p
            ? p.prompt.text
            : getComputedStyle(a.reload).display === 'none'
              ? ''
              : a.reload.textContent,
        };
      };
      return {
        ...window.__GPU_PROBE__,
        pixi: !!p,
        shared: p ? p.renderer.gpu.device === e.ctx.get('render').renderer.backend.device : null,
        nativeReadout: getComputedStyle(ui.ammo.cur.parentElement).display !== 'none',
        originalLayer: ui.ammo.root.parentElement === ui.chromeLayer,
        passive: p
          ? getComputedStyle(p.canvas).pointerEvents === 'none' && p.stage.eventMode === 'none'
          : true,
      };
    });
    assert.equal(setup.pixi, mode !== 'dom' && mode !== 'unavailable');
    assert.equal(setup.devices, 1);
    assert.equal(setup.webgl, 0);
    assert.equal(setup.nativeReadout, !setup.pixi);
    assert(setup.originalLayer && setup.passive);
    if (mode === 'unavailable') {
      assert.deepEqual(errors, []);
      results.push({ run, mode, setup, device });
      await page.close();
      continue;
    }
    await page.addScriptTag({
      content: `window.__AMMO_PROFILE__ = { lane: ${combatLane.toString()}, create: ${createCombatProfile.toString()} };`,
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    let combat = null,
      taskMetrics = null;
    if (mode !== 'retina') {
      await page.evaluate(async () => {
        const e = window.__ENGINE__,
          api = window.__AMMO_PROFILE__;
        window.__AMMO_FIXTURE__ = api.create(e, api.lane);
        for (let i = 0; i < 90; i++) {
          window.__AMMO_FIXTURE__.before(-1);
          await window.__PUMP__(1);
        }
      });
      const before = (await cdp.send('Performance.getMetrics')).metrics;
      combat = await page.evaluate(async () => {
        const e = window.__ENGINE__,
          fixture = window.__AMMO_FIXTURE__,
          ui = e.ctx.get('ui'),
          gpu = ui.ammo.pixi;
        const steps = [],
          intervals = [],
          updates = [],
          views = [];
        const update = ui.ammo.update;
        let previous;
        ui.ammo.update = function (...a) {
          const start = performance.now();
          try {
            return update.apply(this, a);
          } finally {
            updates.push(performance.now() - start);
          }
        };
        const textures = gpu?.renderer.texture.managedTextures.length;
        try {
          for (let i = 0; i < 900; i++) {
            await new Promise(requestAnimationFrame);
            const at = performance.now();
            if (previous !== undefined) intervals.push(at - previous);
            previous = at;
            fixture.before(i);
            const start = performance.now();
            e.step();
            steps.push(performance.now() - start);
            fixture.after();
            // Check values every frame; avoid layout queries in the timing loop.
            const s = ui.state,
              ammo = gpu ? gpu.current.text : ui.ammo.cur.textContent;
            const reserve = gpu ? gpu.reserve.text : `/ ${ui.ammo.res.textContent}`;
            const name = gpu ? gpu.name.text : ui.ammo.name.textContent;
            const prompt = gpu
              ? gpu.prompt.text
              : s.reloading || s.ammo === 0
                ? ui.ammo.reload.textContent
                : '';
            const expectedPrompt = s.reloading
              ? 'RELOADING'
              : s.ammo === 0
                ? 'PRESS R TO RELOAD'
                : '';
            if (
              Number(ammo) !== s.ammo ||
              reserve !== `/ ${s.reserve}` ||
              name !== s.weaponName ||
              prompt !== expectedPrompt
            )
              throw new Error('combat readout mismatch');
            if (i % 60 === 0)
              views.push({ frame: i, ammo: s.ammo, reload: s.reloading, name: s.weaponName });
          }
        } finally {
          ui.ammo.update = update;
          fixture.dispose();
        }
        const summary = (a) => {
          a.sort((x, y) => x - y);
          return { median: a[Math.floor(a.length / 2)], p95: a[Math.floor(a.length * 0.95)] };
        };
        return {
          stepMs: summary(steps),
          frameIntervalMs: summary(intervals),
          ammoUpdateMs: summary(updates),
          report: fixture.report,
          views,
          texturesBefore: textures ?? null,
          texturesAfter: gpu?.renderer.texture.managedTextures.length ?? null,
        };
      });
      validateCombatProfile(combat.report);
      const after = (await cdp.send('Performance.getMetrics')).metrics;
      taskMetrics = {};
      for (const name of [
        'TaskDuration',
        'ScriptDuration',
        'LayoutDuration',
        'RecalcStyleDuration',
      ])
        taskMetrics[name] =
          (1000 *
            (after.find((m) => m.name === name).value -
              before.find((m) => m.name === name).value)) /
          900;
    }
    await page.evaluate(async () => {
      const e = window.__ENGINE__,
        ai = e.ctx.get('ai');
      for (const actor of ai.agents) actor.dispose();
      ai.agents.length = 0;
      ai.squads.length = 0;
      e.input.enabled = false;
      e.input.frozen = true;
      e.ctx.get('weapons').resetForNewGame();
      await window.__PUMP__(60);
    });
    const shot = async (name) => {
      if (mode === 'dom') await captureNative(page, resolve(out, `${mode}-${run}-${name}.png`));
      else await capturePixi(page, resolve(out, `${mode}-${run}-${name}.png`), 'ammo');
    };
    const idle = await page.evaluate(async () => {
      const p = window.__ENGINE__.ctx.get('ui').ammo.pixi,
        before = p?.draws;
      await window.__PUMP__(30);
      return p ? p.draws - before : 0;
    });
    assert.equal(idle, 0, 'settled live HUD has no extra redraws');
    await shot('idle');
    await page.evaluate(async () => {
      const w = window.__ENGINE__.ctx.get('weapons');
      w.state.mag = 7;
      w.state.chambered = true;
      if (!w.reload()) throw new Error('reload did not start');
      await window.__PUMP__(55);
    });
    assert.equal((await page.evaluate(() => window.__AMMO_CHECK__())).reloading, true);
    await shot('reload');
    await page.evaluate(async () => {
      const w = window.__ENGINE__.ctx.get('weapons');
      if (!w.setWeapon('pistol')) throw new Error('switch did not interrupt');
      await window.__PUMP__(100);
    });
    const switched = await page.evaluate(() => window.__AMMO_CHECK__());
    assert.equal(switched.reloading, false);
    assert.match(switched.name, /P320/);
    await page.evaluate(async () => {
      const w = window.__ENGINE__.ctx.get('weapons');
      w.state.mag = 0;
      w.state.chambered = true;
      if (!w.tryFire()) throw new Error('empty fixture shot failed');
      await window.__PUMP__(15);
    });
    const empty = await page.evaluate(() => window.__AMMO_CHECK__());
    assert.equal(empty.ammo, 0);
    assert.equal(empty.prompt, 'PRESS R TO RELOAD');
    await shot('empty');
    await page.evaluate(async () => {
      const w = window.__ENGINE__.ctx.get('weapons');
      if (!w.reload()) throw new Error('empty reload failed');
      await window.__PUMP__(230);
      if (!w.equipSecondary('shotgun')) throw new Error('shotgun equip failed');
      w.state.mag = 2;
      w.state.reserve = 4;
      w.reload();
      await window.__PUMP__(60);
      w.setWeapon('rifle');
      await window.__PUMP__(100);
    });
    assert.equal((await page.evaluate(() => window.__AMMO_CHECK__())).reloading, false);
    const resourceStress = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        p = ui.ammo.pixi;
      if (!p) return null;
      const counts = [p.renderer.texture.managedTextures.length];
      for (let cycle = 0; cycle < 3; cycle++) {
        for (let i = 0; i < 60; i++)
          p.update(1 / 60, {
            ...ui.state,
            ammo: i % 31,
            reserve: 90 - i,
            magSize: i % 2 ? 30 : 17,
            weaponName: i % 2 ? 'M4A1' : 'P320 Compact',
            fireMode: i % 2 ? 'auto' : 'semi',
            reloading: i % 3 === 0,
            reloadProgress: (i % 10) / 10,
          });
        await p.renderer.gpu.device.queue.onSubmittedWorkDone();
        counts.push(p.renderer.texture.managedTextures.length);
      }
      await window.__PUMP__(30);
      return counts;
    });
    if (resourceStress)
      assert.equal(
        resourceStress.at(-1),
        resourceStress.at(-2),
        'pooled resources must plateau after warmup'
      );
    const sizing = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        r = e.ctx.get('render'),
        p = e.ctx.get('ui').ammo.pixi,
        sizes = [];
      if (!p) return sizes;
      for (const renderScale of [1, 0.8, 0.72]) {
        r.q = { ...r.q, renderScale };
        e.resize();
        await window.__PUMP__(1);
        sizes.push({
          renderScale,
          world: [e.canvas.width, e.canvas.height],
          hud: [p.canvas.width, p.canvas.height],
          resolution: p.renderer.resolution,
        });
      }
      return sizes;
    });
    if (sizing.length)
      for (const size of sizing)
        assert.deepEqual(size.hud, sizing[0].hud, 'world scaling must not soften the HUD');
    await page.setViewportSize({ width: mode === 'retina' ? 720 : 1280, height: 720 });
    await page.evaluate(async () => {
      window.__ENGINE__.resize();
      await window.__PUMP__(2);
    });
    await shot('resized');
    const lifecycle = await page.evaluate(async () => {
      const e = window.__ENGINE__,
        ui = e.ctx.get('ui'),
        p = ui.ammo.pixi;
      ui.menu.show();
      await window.__PUMP__(60);
      const before = p?.draws,
        time = e.time.elapsed;
      await window.__PUMP__(30);
      const paused = e.time.scale === 0 && e.time.elapsed === time && (!p || p.draws === before);
      ui.menu.close();
      await window.__PUMP__(30);
      ui.debugState('market');
      await window.__PUMP__(30);
      const shop = e.time.scale === 0 && ui.shop.active;
      e.ctx.get('market').closeShop();
      await window.__PUMP__(30);
      e.ctx.get('player').applyDamage(20000, null);
      await window.__PUMP__(90);
      const hidden = ui.hudVisible < 0.004 && (!p || !p.enabled);
      e.ctx.events.emit('game:restart', { source: 'pixi-ammo-test' });
      await window.__PUMP__(90);
      const restarted = ui.hudVisible > 0.99 && (!p || p.enabled);
      const canvas = p?.canvas,
        rect = canvas?.getBoundingClientRect();
      const pointerTransparent =
        !p ||
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === e.canvas;
      ui.installStartGate();
      await window.__PUMP__(2);
      const waiting = !p || !p.enabled;
      return {
        paused,
        shop,
        hidden,
        restarted,
        pointerTransparent,
        waiting,
        error: e.error,
        ...window.__GPU_PROBE__,
        canvas: canvas ? [canvas.width, canvas.height] : null,
      };
    });
    assert.deepEqual(
      Object.fromEntries(
        ['paused', 'shop', 'hidden', 'restarted', 'pointerTransparent', 'waiting'].map((key) => [
          key,
          lifecycle[key],
        ])
      ),
      {
        paused: true,
        shop: true,
        hidden: true,
        restarted: true,
        pointerTransparent: true,
        waiting: true,
      }
    );
    assert.equal(lifecycle.error, null);
    assert.equal(lifecycle.devices, 1);
    assert.equal(lifecycle.webgl, 0);
    await page.evaluate(() => window.__ENGINE__.dispose());
    assert.equal(await page.evaluate(() => window.__GPU_PROBE__.destroys), 1);
    assert.deepEqual(errors, []);
    const result = {
      run,
      mode,
      device,
      setup,
      idle,
      combat,
      taskMetrics,
      resourceStress,
      sizing,
      lifecycle,
    };
    results.push(result);
    console.log(
      JSON.stringify({
        run,
        mode,
        step: combat?.stepMs,
        interval: combat?.frameIntervalMs,
        update: combat?.ammoUpdateMs,
        taskMetrics,
        textures: [combat?.texturesBefore, combat?.texturesAfter],
        lifecycle,
      })
    );
    await page.close();
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
} finally {
  await browser.close();
  stopViteServer(server);
}
