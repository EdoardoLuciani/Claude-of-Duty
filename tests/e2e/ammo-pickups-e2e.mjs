// Native populated-loot draw/interaction regression. Performance sampling belongs to tools/profile.mjs.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  REPO_ROOT,
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { combatLane } from '../../tools/lib/combat-fixture.js';
import { captureNative, waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs(),
  root = resolve(String(args.root ?? REPO_ROOT)),
  out = resolve(String(args.out ?? '/tmp/ammo-pickups-e2e')),
  port = Number(args.port ?? 5404);
mkdirSync(out, { recursive: true });
const report = { pools: [] };
let server, browser;
const errors = [],
  warnings = [];
try {
  server = await ensureViteServer({ port, root });
  assert(server, 'use an unused port: fixture must own its checkout/server');
  browser = await launchChromium({
    headless: true,
    executablePath: args.executable,
    args: [
      '--ignore-gpu-blocklist',
      '--mute-audio',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
    ],
  });
  report.browser = browser.version();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(180000);
  collectBrowserErrors(page, errors, { warnings });
  page.on('console', (message) => {
    if (
      message.type() !== 'error' &&
      /GPUValidationError|validation error|Error while parsing WGSL/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=high`);
  report.device = await waitForGame(page);
  await page.addScriptTag({ content: `window.__LOOT_LANE__ = ${combatLane.toString()};` });
  report.placement = await page.evaluate(() => {
    const e = window.__ENGINE__,
      ctx = e.ctx,
      ai = ctx.get('ai'),
      player = ctx.get('player');
    for (const actor of ai.agents) actor.dispose();
    ai.agents.length = 0;
    ai.squads.length = 0;
    const offsets = Array.from({ length: 32 }, (_, i) => [
      3 + Math.floor(i / 8) * 0.8,
      ((i % 8) - 3.5) * 0.5,
    ]);
    const lane = window.__LOOT_LANE__(ai, ctx.get('world'), ctx.get('physics'), offsets);
    const base = lane.positions[0];
    player.teleport(
      { x: base.x, y: base.y + player.eyeHeight, z: base.z },
      {
        x: -0.28,
        y: Math.atan2(-lane.fx, -lane.fz),
      }
    );
    ctx.get('sky').setTimeOfDay(16.5);
    window.__LOOT_POSITIONS__ = lane.positions.slice(1);
    return lane.positions.map((p) => p.toArray());
  });
  for (const population of [0, 8, 32]) {
    const result = await page.evaluate(async (population) => {
      const e = window.__ENGINE__,
        ctx = e.ctx,
        r = ctx.get('render'),
        renderer = r.renderer;
      const pickups = ctx.get('weapons').pickups;
      pickups.clear();
      for (const p of window.__LOOT_POSITIONS__.slice(0, population)) pickups.spawn(p);
      await window.__PUMP__(120);
      if (e.error) throw Error(JSON.stringify(e.error));
      if (pickups.items.length !== population) throw Error('unexpected pickup loss');
      const meshes = new Set(pickups._batches);
      const census = {
        beauty: 0,
        prepass: 0,
        shadow: 0,
        other: 0,
        triangles: {},
        shadowCameras: {},
      };
      const draw = renderer.backend.draw;
      renderer.backend.draw = function (object, info) {
        const before = info.render.drawCalls;
        const result = draw.apply(this, arguments);
        const delta = info.render.drawCalls - before;
        if (meshes.has(object.object) && delta) {
          const pass = object.material.isShadowPassMaterial
            ? 'shadow'
            : object.context.renderTarget === r._graph.worldPass.renderTarget
              ? 'beauty'
              : object.context.renderTarget === r._graph.prePass.renderTarget
                ? 'prepass'
                : 'other';
          census[pass] += delta;
          const params = object.getDrawParameters();
          census.triangles[pass] =
            (census.triangles[pass] ?? 0) + (params.vertexCount / 3) * params.instanceCount;
          if (pass === 'shadow')
            census.shadowCameras[object.camera.uuid] =
              (census.shadowCameras[object.camera.uuid] ?? 0) + delta;
        }
        return result;
      };
      try {
        await window.__PUMP__(1);
      } finally {
        renderer.backend.draw = draw;
      }
      return {
        population,
        census,
        meshes: meshes.size,
        totalBuilders: window.__NATIVE_BUILDS__,
        buildInfo: window.__NATIVE_BUILD_INFO__,
      };
    }, population);
    assert.equal(result.census.beauty, population ? 4 : 0);
    assert.equal(result.census.prepass, population ? 3 : 0);
    // All items in this compact lane intersect the three high-quality CSM
    // cascades. The ring must never enter either opaque depth or shadows.
    assert.equal(result.census.shadow, population ? 9 : 0);
    assert.equal(Object.keys(result.census.shadowCameras).length, population ? 3 : 0);
    assert.equal(result.census.triangles.beauty ?? 0, population * 384);
    assert.equal(result.census.triangles.prepass ?? 0, population * 48);
    assert.equal(result.census.triangles.shadow ?? 0, population * 144);
    assert.equal(result.census.other, 0);
    assert.equal(result.totalBuilders, 0, 'no post-readiness builders, including first use/warmup');
    report.pools.push(result);
  }
  await captureNative(page, `${out}/afternoon.png`);
  await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx;
    ctx.get('sky').setTimeOfDay(23);
    ctx.get('player').setFlashlightEnabled(true);
    await window.__PUMP__(60);
  });
  await captureNative(page, `${out}/flashlight.png`);
  report.interaction = await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx,
      weapons = ctx.get('weapons'),
      pickups = weapons.pickups;
    const player = ctx.get('player'),
      input = ctx.input;
    const nearest = pickups.items[15];
    player.teleport(
      {
        x: nearest.group.position.x,
        y: nearest.baseY + player.eyeHeight,
        z: nearest.group.position.z,
      },
      0
    );
    weapons.state.reserve = 0;
    input.enabled = true;
    input.frozen = false;
    const action = input.action;
    input.action = (name) => name === 'use' || action.call(input, name);
    let event = null;
    const off = ctx.events.on('ammo:pickup', (e) => {
      event = { amount: e.amount, position: e.position.toArray() };
    });
    try {
      pickups.update(0.5);
    } finally {
      input.action = action;
      off();
    }
    const result = { count: pickups.items.length, reserve: weapons.state.reserve, event };
    pickups.clear();
    result.afterClear = pickups.items.length;
    result.prompting = pickups._prompting;
    result.instancesAfterClear = pickups._batches?.map((m) => m.count) ?? null;
    return result;
  });
  assert.equal(report.interaction.count, 31);
  assert.equal(report.interaction.reserve, 45);
  assert.equal(report.interaction.event.amount, 45);
  assert.equal(report.interaction.afterClear, 0);
  assert.equal(report.interaction.prompting, false);
  assert.deepEqual(report.interaction.instancesAfterClear, [0, 0, 0, 0]);
  assert.deepEqual(errors, []);
  report.failure = null;
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  report.errors = errors;
  report.warnings = warnings;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  stopViteServer(server);
}
console.log(
  JSON.stringify(
    report.pools.map(({ population, census }) => ({ population, census })),
    null,
    2
  )
);
