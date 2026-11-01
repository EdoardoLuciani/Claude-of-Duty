// Isolated Pixi minimap CPU cost. Build both checkouts first; no HTML comparison.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  stopViteServer,
  launchChromium,
  collectBrowserErrors,
  parseArgs,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';
import { capturePixi } from '../lib/pixi-capture.mjs';

async function measureMap(engine, scenario) {
  const ui = engine.ctx.get('ui'),
    owner = ui.minimap,
    map = ui.pixiHud.minimap,
    r = ui.pixiHud.renderer;
  if (!owner.baked) throw Error('authored map has not baked');
  const parent = map.stage.parent,
    index = parent.getChildIndex(map.stage),
    x = map.stage.x,
    y = map.stage.y;
  parent.removeChild(map.stage);
  map.stage.position.set(0, 0);
  // Fixture creation, trigonometry and allocation are outside every CPU scope.
  const states = Array.from({ length: 1024 }, (_, tick) => {
    const moving = scenario !== 'turn',
      x = 13 + (moving ? Math.sin(tick / 120) * 8 : 0),
      z = 20 + (moving ? Math.cos(tick / 120) * 8 : 0);
    return {
      x,
      z,
      heading: (tick * 1.5) % 360,
      fov: moving && scenario !== 'pan' ? 65 + 15 * Math.sin(tick / 45) : 80,
      playerY: 0,
      pulseTime: tick / 60,
      objectives: [],
      blips: Array.from({ length: scenario === 'busy' ? 48 : 5 }, (_, i) => {
        const a = i * 0.7 + tick / 80;
        return {
          x: x + Math.cos(a) * (8 + (i % 20)),
          z: z + Math.sin(a) * (8 + (i % 20)),
          kind: i % 4 ? 'enemy' : 'friend',
          heading: (tick + i * 25) % 360,
          fade: 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(tick / 60 + i)),
        };
      }),
      pulses: moving
        ? Array.from({ length: scenario === 'busy' ? 3 : 1 }, (_, i) => ({
            x: 10 + i * 8,
            z: 20 + i * 6,
            y: i ? 5 : 0,
            radius:
              12 +
              (scenario === 'busy' || scenario === 'pan-fov' ? Math.sin(tick / 60 + i) * 2 : 0),
          }))
        : [],
    };
  });
  let tick = 0,
    target;
  const next = () => states[tick++ % states.length];
  try {
    map.update(owner, states[0]);
    target = r.textureGenerator.generateTexture({
      target: map.stage,
      frame: new r.screen.constructor(0, 0, 178, 202),
      resolution: 1,
    });
    const options = { container: map.stage, target, clear: true };
    for (let i = 0; i < 240; i++) {
      for (let n = 0; n < 20; n++) map.update(owner, next());
      r.render(options);
    }
    await r.gpu.device.queue.onSubmittedWorkDone(); // outside timing, once
    const updates = [],
      draw = [],
      total = [];
    for (let i = 0; i < 1200; i++) {
      if (i % 60 === 0) await new Promise(requestAnimationFrame);
      // Batch short update scopes against coarse performance.now resolution.
      let at = performance.now();
      for (let n = 0; n < 20; n++) map.update(owner, next());
      updates.push((performance.now() - at) / 20);
      const state = next();
      at = performance.now();
      map.update(owner, state);
      const start = performance.now();
      r.render(options);
      const end = performance.now();
      draw.push(end - start);
      total.push(end - at);
    }
    const stats = (a) => {
      const v = [...a].sort((a, b) => a - b);
      return {
        mean: v.reduce((s, n) => s + n, 0) / v.length,
        median: v[Math.floor(v.length / 2)],
        p95: v[Math.floor(v.length * 0.95)],
      };
    };
    let nodes = 0,
      instructions = 0;
    const visit = (n) => {
      nodes++;
      instructions += n.context?.instructions?.length ?? 0;
      for (const c of n.children ?? []) visit(c);
    };
    visit(map.stage);
    return {
      scenario,
      samples: 1200,
      updateBatch: 20,
      updateCpu: stats(updates),
      drawCpu: stats(draw),
      inclusiveCpu: stats(total),
      nodes,
      instructions,
      uploads: map.uploads,
      labels: owner.labels.length,
      contacts: states[0].blips.length,
      pulses: states[0].pulses.length,
      expectedLabels: owner.labels.map((l) => (l.text ? `${l.text}\n${l.code}` : l.code)),
      actualLabels: map.labels.map(
        (l) => l.node.text ?? l.node.children.map((n) => n.text).join('\n')
      ),
      raw: { updates, draw, total },
    };
  } finally {
    target?.destroy(true);
    parent.addChildAt(map.stage, index);
    map.stage.position.set(x, y);
  }
}

const args = parseArgs(),
  port = Number(args.port ?? 5241),
  out = resolve(String(args.out ?? '/tmp/pixi-map-cost'));
const before = resolve(String(args.before ?? '../Claude-of-Duty-pixi-minimap-before'));
await mkdir(out, { recursive: true });
const servers = [],
  results = [];
let browser;
try {
  servers.push(await ensureViteServer({ root: before, port, preview: true }));
  if (!args.baseline) servers.push(await ensureViteServer({ port: port + 1, preview: true }));
  browser = await launchChromium({
    headless: true,
    args: ['--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
  });
  const order = args.baseline
    ? ['before']
    : Array.from({ length: Number(args.rounds ?? 1) }, () => [
        'before',
        'after',
        'after',
        'before',
      ]).flat();
  const scenarios = args.scenario
    ? String(args.scenario).split(',')
    : ['turn', 'pan', 'ads', 'pan-fov', 'busy'];
  assert(scenarios.every((s) => ['turn', 'pan', 'ads', 'pan-fov', 'busy'].includes(s)));
  for (const scenario of scenarios)
    for (const version of order) {
      const page = await browser.newPage({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 1,
        }),
        errors = [];
      const url = `http://localhost:${port + (version === 'after' ? 1 : 0)}`;
      await page.goto(`${url}/models/world/level.json`);
      await page.waitForFunction(
        async () =>
          (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }))?.info
            .isFallbackAdapter === false
      );
      collectBrowserErrors(page, errors, { validationMessages: true });
      await page.goto(`${url}/?capture=1&lockstep=1&q=high&pixi=hud`);
      const device = await waitForGame(page);
      errors.splice(
        0,
        errors.length,
        ...errors.filter((s) => !s.includes('THREE.TSL: Return statement used'))
      );
      await page.evaluate(() => window.__PUMP__(180));
      await page.addScriptTag({ content: `window.__MEASURE_MAP__=${measureMap.toString()};` });
      const result = await page.evaluate(
        (s) => window.__MEASURE_MAP__(window.__ENGINE__, s),
        scenario
      );
      assert.deepEqual(
        result.actualLabels,
        result.expectedLabels,
        'all building names/codes retained'
      );
      await writeFile(resolve(out, `${results.length}-timings.json`), JSON.stringify(result.raw));
      delete result.raw;
      await page.evaluate(async () => {
        const e = window.__ENGINE__,
          ui = e.ctx.get('ui');
        e.ctx.get('player').health.reset(true);
        e.ctx.get('weapons').resetForNewGame();
        ui._updateFps = () => {};
        ui.fpsText = '123 FPS';
        await window.__PUMP__(90);
      });
      await capturePixi(page, resolve(out, `${results.length}-${version}-${scenario}.png`), 'hud');
      await page.evaluate(() => window.__ENGINE__.dispose());
      assert.deepEqual(errors, []);
      results.push({ version, browser: browser.version(), device, ...result });
      await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ version, ...result }));
      await page.close();
    }
} finally {
  if (browser) await browser.close();
  for (const server of servers) stopViteServer(server);
}
