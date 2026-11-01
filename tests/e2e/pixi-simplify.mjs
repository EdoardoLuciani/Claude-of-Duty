// Production Pixi -> Pixi comparison. Build both roots before running.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  REPO_ROOT,
  ensureViteServer,
  stopViteServer,
  launchChromium,
  collectBrowserErrors,
  parseArgs,
} from '../../tools/lib/browser-harness.mjs';
import { combatLane } from '../../tools/lib/combat-fixture.js';
import { waitForGame } from '../../tools/lib/native-render.mjs';
import { createCombatProfile, validateCombatProfile } from '../../tools/lib/profile-combat.js';
import { capturePixi } from '../lib/pixi-capture.mjs';
import { measurePixiGpu } from '../lib/pixi-gpu-timing.mjs';

// Only test code changes FPS samples and optionally poses busy combat feedback.
// The world's seeded combat/simulation remains the same in both builds.
function createReplay(engine, lane) {
  const f = window.__PROFILE__.create(engine, lane),
    ui = engine.ctx.get('ui');
  const fps = ui._updateFps,
    weapon = ui._weaponState,
    player = ui._playerState,
    compass = ui.compass.update;
  let tick = 0;
  ui._updateFps = function () {
    this.fpsText = `${120 + (Math.floor(tick / 30) % 4)} FPS`;
  };
  if (window.__BUSY__) {
    ui._weaponState = function () {
      return {
        ...weapon.call(this),
        cooking: true,
        lethalCount: 3,
      };
    };
    ui._playerState = function () {
      return { ...player.call(this), healing: true, bandages: 12 };
    };
    ui.compass.update = function (_heading, objectives, dt) {
      return compass.call(this, tick * 1.5, objectives, dt);
    };
  }
  return {
    report: f.report,
    before(frame) {
      f.before(frame);
      tick++;
      if (window.__BUSY__) {
        if (tick % 8 === 0)
          ui.hit.spawn(['hit', 'armour', 'head', 'kill'][Math.floor(tick / 8) % 4]);
        if (tick % 24 === 0) ui.arcs.spawn(Math.sin(tick), Math.cos(tick), 0.8);
        if (tick % 30 === 0) ui.compass.ping(ui.compass.heading + 25);
      }
    },
    after() {
      f.after();
    },
    dispose() {
      ui._updateFps = fps;
      ui._weaponState = weapon;
      ui._playerState = player;
      ui.compass.update = compass;
      f.dispose();
    },
  };
}

// Deterministic UI-only replay: same snapshots/cues, no world/AI/simulation work.
// This isolates CPU submission cost, not gameplay FPS.
async function measureUiOnly(e) {
  const ui = e.ctx.get('ui'),
    p = ui.pixiHud,
    clock = e.ctx.time;
  const original = {
    weapon: ui._weaponState,
    player: ui._playerState,
    fps: ui._updateFps,
    compass: ui.compass.update,
    render: p.renderer.render,
    raw: clock.raw,
    elapsed: clock.elapsed,
    lastRaw: ui._lastRaw,
    enabled: e.input.enabled,
    frozen: e.input.frozen,
  };
  const weapon = {
    ...ui._weaponState(),
    ammo: 30,
    reserve: 210,
    magSize: 30,
    cooking: true,
    lethalCount: 3,
  };
  const player = {
    ...ui._playerState(),
    maxHealth: 100,
    health: 100,
    armour: 150,
    bandages: 12,
    healing: true,
  };
  let tick = 0;
  const total = [],
    renderTimes = [];
  ui._weaponState = () => weapon;
  ui._playerState = () => player;
  ui._updateFps = () => {
    ui.fpsText = window.__ICON_BENCH__ ? '123 FPS' : `${120 + (Math.floor(tick / 30) % 4)} FPS`;
  };
  const heading = ui.compass.heading;
  ui.compass.update = function (_h, objectives, dt) {
    return original.compass.call(
      this,
      window.__ICON_BENCH__ ? heading : tick * 1.5,
      objectives,
      dt
    );
  };
  e.input.enabled = false;
  e.input.frozen = true;
  ui.hit.clear();
  ui.arcs.clear();
  const advance = () => {
    tick++;
    clock.raw += 1 / 60;
    clock.elapsed += 1 / 60;
    if (window.__ICON_BENCH__) {
      player.health = 100;
      player.armour = 150;
      player.hurt = player.pulse = 0;
      player.bandages = window.__STOCK_STRESS__ ? tick % 20 : 12;
      weapon.lethalCount = window.__STOCK_STRESS__ ? tick % 4 : 3;
      weapon.ammo = 30;
      weapon.reloading = false;
      return;
    }
    player.health = 20 + (tick % 80);
    player.armour = tick % 151;
    player.healProgress = (tick % 240) / 240;
    weapon.ammo = tick % 31;
    weapon.reloading = tick % 120 < 60;
    weapon.reloadProgress = (tick % 60) / 59;
    if (tick % 8 === 0) ui.hit.spawn(['hit', 'armour', 'head', 'kill'][Math.floor(tick / 8) % 4]);
    if (tick % 24 === 0) ui.arcs.spawn(Math.sin(tick), Math.cos(tick), 0.8);
    if (tick % 30 === 0) ui.compass.ping(tick * 1.5 + 25);
  };
  try {
    await p.renderer.gpu.device.queue.onSubmittedWorkDone(); // outside timed samples
    for (let i = 0; i < 240; i++) {
      advance();
      ui.lateUpdate(1 / 60, e.ctx);
    }
    p.renderer.render = function (...a) {
      const t = performance.now();
      try {
        return original.render.apply(this, a);
      } finally {
        renderTimes.push(performance.now() - t);
      }
    };
    for (let i = 0; i < 1200; i++) {
      if (i % 60 === 0) await new Promise(requestAnimationFrame);
      advance();
      const t = performance.now();
      ui.lateUpdate(1 / 60, e.ctx);
      total.push(performance.now() - t);
    }
    const stats = (a) => {
      const v = [...a].sort((a, b) => a - b);
      return {
        mean: v.reduce((s, n) => s + n, 0) / v.length,
        median: v[Math.floor(v.length / 2)],
        p95: v[Math.floor(v.length * 0.95)],
      };
    };
    return {
      samples: total.length,
      ui: stats(total),
      renderer: stats(renderTimes),
      cues: window.__ICON_BENCH__
        ? { hits: 0, arcs: 0, pings: 0 }
        : { hits: 180, arcs: 60, pings: 48 },
      accessoryInputsOnly: !!window.__ICON_BENCH__,
      stockStress: !!window.__STOCK_STRESS__,
      ticks: tick,
    };
  } finally {
    ui._weaponState = original.weapon;
    ui._playerState = original.player;
    ui._updateFps = original.fps;
    ui.compass.update = original.compass;
    p.renderer.render = original.render;
    clock.raw = original.raw;
    clock.elapsed = original.elapsed;
    ui._lastRaw = original.lastRaw;
    e.input.enabled = original.enabled;
    e.input.frozen = original.frozen;
  }
}

const args = parseArgs(),
  port = Number(args.port ?? 5221),
  beforeRoot = resolve(String(args.before ?? '../Claude-of-Duty-pixi-simplify-before')),
  out = resolve(String(args.out ?? '/tmp/pixi-simplify'));
await mkdir(out, { recursive: true });
const servers = [],
  results = [];
let browser;
try {
  servers.push(
    await ensureViteServer({ root: args.icons ? REPO_ROOT : beforeRoot, port, preview: true })
  );
  if (!args.baseline && !args.icons)
    servers.push(await ensureViteServer({ port: port + 1, preview: true }));
  browser = await launchChromium({
    headless: true,
    args: [
      '--ignore-gpu-blocklist',
      ...(args.capped ? [] : ['--disable-frame-rate-limit', '--disable-gpu-vsync']),
    ],
  });
  const order = args.icons
    ? Array.from({ length: Number(args.rounds ?? 3) }, (_, i) => {
        const a = [
          ['text', 'original', 'simple'],
          ['original', 'simple', 'text'],
          ['simple', 'text', 'original'],
        ][i % 3];
        return [...a, ...a.toReversed()];
      }).flat()
    : args.baseline
      ? ['before']
      : Array.from({ length: Number(args.rounds ?? 2) }, () => [
          'before',
          'after',
          'after',
          'before',
        ]).flat();
  for (const workload of args.busy || args.ui ? ['busy'] : ['combat', 'busy'])
    for (const version of order) {
      const index = results.length,
        page = await browser.newPage({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 1,
        });
      const errors = [];
      const url = `http://localhost:${port + (!args.icons && version === 'after' ? 1 : 0)}`;
      await page.goto(`${url}/models/world/level.json`);
      await page.waitForFunction(
        async () =>
          (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }))?.info
            .isFallbackAdapter === false
      );
      collectBrowserErrors(page, errors, { validationMessages: true });
      await page.goto(
        `${url}/?capture=1&lockstep=1&q=high&pixi=hud${args.icons ? '&icons=' + version : ''}`
      );
      const device = await waitForGame(page);
      errors.splice(
        0,
        errors.length,
        ...errors.filter((s) => !s.includes('THREE.TSL: Return statement used'))
      );
      await page.addScriptTag({
        content: `window.__PROFILE__={create:${createCombatProfile.toString()},lane:${combatLane.toString()},replay:${createReplay.toString()}}; window.__GPU_TIMING__=${measurePixiGpu.toString()}; window.__BUSY__=${workload === 'busy'}; window.__ICON_BENCH__=${!!args.icons}; window.__STOCK_STRESS__=${!!args.stock};`,
      });
      await page.evaluate(async () => {
        const e = window.__ENGINE__;
        e.ctx.get('render').settings.autoExposure = false;
        window.__REPLAY__ = window.__PROFILE__.replay(e, window.__PROFILE__.lane);
        for (let i = 0; i < 180; i++) {
          window.__REPLAY__.before(-1);
          await window.__PUMP__(1);
        }
      });
      if (args.ui) {
        await page.addScriptTag({ content: `window.__UI_ONLY__=${measureUiOnly.toString()};` });
        const isolated = await page.evaluate(() => window.__UI_ONLY__(window.__ENGINE__));
        await page.evaluate(() => {
          window.__REPLAY__.dispose();
          return window.__ENGINE__.dispose();
        });
        assert.deepEqual(errors, []);
        results.push({
          index,
          version,
          workload: 'ui-only',
          iconComparison: !!args.icons,
          device,
          browser: browser.version(),
          isolated,
        });
        await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
        console.log(JSON.stringify({ index, version, isolated }));
        await page.close();
        continue;
      }
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const start = (await cdp.send('Performance.getMetrics')).metrics;
      const cpu = await page.evaluate(async () => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui'),
          p = ui.pixiHud,
          f = window.__REPLAY__;
        const scopes = { ui: [], renderer: [], compass: [], combat: [] },
          restores = [];
        for (const [object, key, name] of [
          [ui, 'lateUpdate', 'ui'],
          [p.renderer, 'render', 'renderer'],
          [p.compass, 'update', 'compass'],
          [p.combat, 'update', 'combat'],
        ]) {
          const fn = object[key];
          restores.push(() => {
            object[key] = fn;
          });
          object[key] = function (...a) {
            const at = performance.now();
            try {
              return fn.apply(this, a);
            } finally {
              scopes[name].push(performance.now() - at);
            }
          };
        }
        const intervals = [],
          engine = [];
        let previous;
        try {
          for (let i = 0; i < 900; i++) {
            await new Promise(requestAnimationFrame);
            const at = performance.now();
            if (previous !== undefined) intervals.push(at - previous);
            previous = at;
            f.before(i);
            const t = performance.now();
            e.step();
            engine.push(performance.now() - t);
            f.after();
            if (p.combat.fps.text !== ui.fpsText || Number(p.ammo.current.text) !== ui.state.ammo)
              throw Error('live HUD parity');
          }
        } finally {
          for (const restore of restores) restore();
          f.dispose();
        }
        const stats = (a) => {
          const v = [...a].sort((a, b) => a - b);
          return {
            mean: v.reduce((s, n) => s + n, 0) / v.length,
            median: v[Math.floor(v.length / 2)],
            p95: v[Math.floor(v.length * 0.95)],
          };
        };
        return {
          interval: stats(intervals),
          engine: stats(engine),
          scopes: Object.fromEntries(Object.entries(scopes).map(([k, v]) => [k, stats(v)])),
          report: f.report,
        };
      });
      validateCombatProfile(cpu.report);
      const end = (await cdp.send('Performance.getMetrics')).metrics;
      const taskMs =
        (1000 *
          (end.find((m) => m.name === 'TaskDuration').value -
            start.find((m) => m.name === 'TaskDuration').value)) /
        900;
      // Separate timestamp replay: never include probes/fences/readback in throughput.
      const gpu = args.gpu
        ? await page.evaluate(() =>
            window.__GPU_TIMING__(
              window.__ENGINE__,
              window.__PROFILE__.replay,
              window.__PROFILE__.lane
            )
          )
        : null;
      if (gpu?.supported) validateCombatProfile(gpu.report);
      const resources = await page.evaluate(() => {
        const p = window.__ENGINE__.ctx.get('ui').pixiHud;
        let nodes = 0,
          instructions = 0;
        const visit = (n) => {
          nodes++;
          instructions += n.context?.instructions?.length ?? 0;
          for (const c of n.children ?? []) visit(c);
        };
        visit(p.stage);
        return {
          nodes,
          instructions,
          textures: p.renderer.texture.managedTextures.length,
          ticks: p.compass.ticks.length,
          mapUploads: p.minimap.uploads,
        };
      });
      // Identical explicit appearance fixture, outside measurements.
      await page.evaluate(async () => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui'),
          ai = e.ctx.get('ai');
        for (const a of ai.agents) a.dispose();
        ai.agents.length = 0;
        ai.squads.length = 0;
        e.input.enabled = false;
        e.input.frozen = true;
        e.ctx.get('player').health.reset(true);
        e.ctx.get('weapons').resetForNewGame();
        ui.hit.clear();
        ui.arcs.clear();
        ui._updateFps = () => {};
        ui.fpsText = '123 FPS'; // appearance fixture only, not an observed performance counter
        await window.__PUMP__(90);
        ui.hit.spawn('head');
        ui.arcs.spawn(1, 0, 1);
        ui.compass.ping(ui.compass.heading + 25);
        await window.__PUMP__(3);
      });
      await capturePixi(page, resolve(out, `${index}-${version}-${workload}.png`), 'hud');
      await page.evaluate(() => window.__ENGINE__.dispose());
      assert.deepEqual(errors, []);
      results.push({
        index,
        version,
        workload,
        capped: !!args.capped,
        iconComparison: !!args.icons,
        browser: browser.version(),
        device,
        cpu,
        taskMs,
        gpu,
        resources,
      });
      await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
      console.log(
        JSON.stringify({
          index,
          version,
          workload,
          interval: cpu.interval.mean,
          ui: cpu.scopes.ui.mean,
          renderer: cpu.scopes.renderer.mean,
          taskMs,
          gpu: gpu?.gpuPassMs,
          resources,
        })
      );
      await page.close();
    }
} finally {
  if (browser) await browser.close();
  for (const server of servers) stopViteServer(server);
}
