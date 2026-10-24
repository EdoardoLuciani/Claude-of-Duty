// Populated loot, not the high-HP combat fixture. Run paired checkouts under the
// shared validation flock; --root supports a read-only control without edits.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  port = Number(args.port ?? 5404),
  frames = Number(args.frames ?? 300),
  warmup = 120,
  gpu = !!args.gpu,
  legacy = !!args.legacy;
assert(Number.isInteger(frames) && frames > 0 && frames <= 3600, 'frames must be 1..3600');
mkdirSync(out, { recursive: true });
const report = {
  fixture: 'stationary-populated-loot-v1',
  root,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  settings: { width: 1280, height: 720, dpr: 1, quality: 'high', frames, warmup, gpu, legacy },
  failure: 'incomplete',
};
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
let server, browser;
const errors = [],
  warnings = [];
function distribution(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const at = (p) => +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(3);
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
}
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
  report.pools = [];
  for (const population of [0, 8, 32]) {
    const result = await page.evaluate(
      async ({ population, frames, warmup, gpu }) => {
        const e = window.__ENGINE__,
          ctx = e.ctx,
          r = ctx.get('render'),
          renderer = r.renderer;
        const pickups = ctx.get('weapons').pickups;
        pickups.clear();
        for (const p of window.__LOOT_POSITIONS__.slice(0, population)) pickups.spawn(p);
        const samples = [],
          gpuSamples = [];
        let renderMs = 0,
          pending = null,
          gpuFailure = null,
          closed = false;
        const originalRender = r.render,
          tracked = renderer.backend.trackTimestamp;
        const tick = () =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              cancelAnimationFrame(id);
              reject(Error('loot rAF timeout'));
            }, 15000);
            const id = requestAnimationFrame((at) => {
              clearTimeout(timer);
              resolve(at);
            });
          });
        if (gpu && !renderer.backend.device.features.has('timestamp-query'))
          throw Error('timestamp-query unavailable');
        r.render = function (...args) {
          const start = performance.now();
          try {
            return originalRender.apply(this, args);
          } finally {
            renderMs = performance.now() - start;
          }
        };
        renderer.backend.trackTimestamp = gpu;
        try {
          let last = null;
          for (let i = -warmup; i <= frames; i++) {
            const at = await tick(),
              callbackAt = performance.now();
            if (last) {
              last.frameTimeMs = at - last.at;
              last.callbackIntervalMs = callbackAt - last.callbackAt;
            }
            if (i === frames) break;
            const builders = window.__NATIVE_BUILDS__,
              draws = renderer.info.render.drawCalls;
            const start = performance.now();
            e.step();
            const cpuMs = performance.now() - start;
            if (e.error) throw Error(JSON.stringify(e.error));
            if (pickups.items.length !== population) throw Error('unexpected pickup loss');
            if (gpu && !pending) {
              const frame = renderer.info.frame;
              pending = Promise.all(
                ['render', 'compute'].map((type) => renderer.resolveTimestampsAsync(type))
              )
                .then(([renderMs, computeMs]) => {
                  if (i >= 0 && !closed)
                    gpuSamples.push({
                      frame,
                      renderMs,
                      computeMs,
                      renderFrame: renderer.backend.getTimestampFrames('render').at(-1) ?? null,
                      computeFrame: renderer.backend.getTimestampFrames('compute').at(-1) ?? null,
                    });
                })
                .catch((error) => {
                  gpuFailure = String(error);
                })
                .finally(() => {
                  pending = null;
                });
            }
            if (i >= 0) {
              last = {
                at,
                callbackAt,
                cpuMs,
                renderMs,
                draws: renderer.info.render.drawCalls - draws,
                builders: window.__NATIVE_BUILDS__ - builders,
              };
              samples.push(last);
            }
          }
          if (pending) {
            let timer;
            try {
              await Promise.race([
                pending,
                new Promise((_, reject) => {
                  timer = setTimeout(() => reject(Error('GPU drain timeout')), 5000);
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
          }
        } finally {
          closed = true;
          r.render = originalRender;
          renderer.backend.trackTimestamp = tracked;
        }
        if (gpuFailure) throw Error(gpuFailure);
        // Count successful *native draws*, not authoring groups or callbacks.
        // The observer is deliberately absent from all CPU timing frames.
        const meshes = new Set();
        if (pickups._batches) for (const mesh of pickups._batches) meshes.add(mesh);
        else
          for (const item of pickups.items)
            item.group.traverse((o) => {
              if (o.isMesh) meshes.add(o);
            });
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
          samples,
          gpuSamples,
          census,
          meshes: meshes.size,
          totalBuilders: window.__NATIVE_BUILDS__,
          buildInfo: window.__NATIVE_BUILD_INFO__,
        };
      },
      { population, frames, warmup, gpu }
    );
    assert.equal(result.census.beauty, population ? (legacy ? population * 5 : 4) : 0);
    assert.equal(result.census.prepass, population ? (legacy ? population * 4 : 3) : 0);
    // All items in this compact lane intersect the three high-quality CSM
    // cascades. The ring must never enter either opaque depth or shadows.
    assert.equal(result.census.shadow, population ? (legacy ? population * 12 : 9) : 0);
    assert.equal(Object.keys(result.census.shadowCameras).length, population ? 3 : 0);
    assert.equal(result.census.triangles.beauty ?? 0, population * 384);
    assert.equal(result.census.triangles.prepass ?? 0, population * 48);
    assert.equal(result.census.triangles.shadow ?? 0, population * 144);
    assert.equal(result.census.other, 0);
    assert.equal(result.totalBuilders, 0, 'no post-readiness builders, including first use/warmup');
    assert.equal(
      result.samples.reduce((n, s) => n + s.builders, 0),
      0,
      'late builders during measured frames'
    );
    if (gpu) {
      assert(result.gpuSamples.length > 0);
      for (const s of result.gpuSamples) {
        assert.equal(s.renderFrame, s.frame);
        assert(Number.isFinite(s.renderMs));
        if (s.computeMs !== null) assert.equal(s.computeFrame, s.frame);
      }
    }
    result.summary = {
      cpuStepMs: distribution(result.samples.map((s) => s.cpuMs)),
      cpuRenderSubmitMs: distribution(result.samples.map((s) => s.renderMs)),
      callbackIntervalMs: distribution(result.samples.map((s) => s.callbackIntervalMs)),
      frameTimeMs: distribution(result.samples.map((s) => s.frameTimeMs)),
      draws: distribution(result.samples.map((s) => s.draws)),
      cpuBudgetMissCount: result.samples.filter((s) => s.cpuMs > 1000 / 60).length,
      gpuPassSumMs: gpu
        ? distribution(
            result.gpuSamples
              .filter((s) => s.computeMs !== null)
              .map((s) => s.renderMs + s.computeMs)
          )
        : null,
      gpuFrameMs: null,
    };
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
  if (!legacy) assert.deepEqual(report.interaction.instancesAfterClear, [0, 0, 0, 0]);
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
    report.pools.map(({ population, census, summary }) => ({ population, census, summary })),
    null,
    2
  )
);
