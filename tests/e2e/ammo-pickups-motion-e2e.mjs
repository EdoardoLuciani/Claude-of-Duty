// Render transitions through ordinary engine frames: native history is indexed
// by instance slot, so current-matrix smoke checks alone cannot protect TRAA.
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
import { waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs(),
  out = resolve(String(args.out ?? '/tmp/ammo-pickups-motion-e2e')),
  port = Number(args.port ?? 5404);
assert(!args.negative || ['history', 'motion'].includes(args.negative));
mkdirSync(out, { recursive: true });
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim(),
  settings: { width: 1280, height: 720, dpr: 1, quality: 'high', negative: args.negative ?? null },
  failure: 'incomplete',
};
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
const errors = [],
  warnings = [];
let server, browser;
try {
  server = await ensureViteServer({ port });
  assert(server, 'motion check must own the checkout/server');
  browser = await launchChromium({
    headless: true,
    executablePath: args.executable,
    args: ['--ignore-gpu-blocklist', '--mute-audio'],
  });
  report.browser = browser.version();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  collectBrowserErrors(page, errors, { warnings });
  page.on('console', (m) => {
    if (
      m.type() !== 'error' &&
      /GPUValidationError|validation error|Error while parsing WGSL/i.test(m.text())
    )
      errors.push(m.text());
  });
  let mutations = 0;
  if (args.negative)
    await page.route('**/src/weapons/ammo-pickups.ts', async (route) => {
      const response = await route.fetch(),
        body = await response.text();
      const marker = /attribute\(["']ammoHistoryValid["'],\s*["']float["']\)/g;
      assert.equal(
        [...body.matchAll(marker)].length,
        1,
        'one served public history-mask expression'
      );
      const mutated = body.replace(marker, `$&.mul(0).add(${args.negative === 'history' ? 1 : 0})`);
      mutations++;
      await route.fulfill({ response, body: mutated });
    });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=high`);
  report.device = await waitForGame(page);
  await page.addScriptTag({ content: `window.__LOOT_LANE__ = ${combatLane.toString()};` });
  report.result = await page.evaluate(async () => {
    const e = window.__ENGINE__,
      ctx = e.ctx,
      r = ctx.get('render'),
      ai = ctx.get('ai');
    const player = ctx.get('player'),
      p = ctx.get('weapons').pickups;
    for (const actor of ai.agents) actor.dispose();
    ai.agents.length = 0;
    ai.squads.length = 0;
    const lane = window.__LOOT_LANE__(
      ai,
      ctx.get('world'),
      ctx.get('physics'),
      Array.from({ length: 32 }, (_, i) => [3 + Math.floor(i / 8) * 0.8, ((i % 8) - 3.5) * 0.5])
    );
    const base = lane.positions[0];
    player.teleport(
      { x: base.x, y: base.y + player.eyeHeight, z: base.z },
      { x: -0.28, y: Math.atan2(-lane.fx, -lane.fz) }
    );
    ctx.get('sky').setTimeOfDay(16.5);
    p.clear();
    await window.__PUMP__(3); // settle the fixture camera, not any loot transition
    ctx.time.scale = 0;
    const update = p.update;
    p.update = () => p._syncVisuals(); // freeze poses, still publish native slot/mask changes
    const rt = r._graph.prePass.renderTarget;
    const attachment = rt.textures.indexOf(r._graph.prePass.getTextureNode('velocity').value);
    if (attachment < 0) throw Error('native velocity attachment missing');
    const half = (h) => {
      const sign = h & 0x8000 ? -1 : 1,
        ex = (h >> 10) & 31,
        m = h & 1023;
      return (
        sign *
        (ex === 0
          ? (2 ** -14 * m) / 1024
          : ex === 31
            ? m
              ? NaN
              : Infinity
            : 2 ** (ex - 15) * (1 + m / 1024))
      );
    };
    const frames = [],
      checks = [];
    const require = (ok, message) => {
      checks.push({ message, ok });
    };
    const snapshot = (items) =>
      items.map((item) => ({
        id: item.id,
        slot: item.slot,
        position: item.group.position.toArray(),
        quaternion: item.group.quaternion.toArray(),
      }));
    const unchanged = (before) =>
      require(JSON.stringify(before) ===
        JSON.stringify(
          snapshot(p.items.filter((item) => before.some((old) => old.id === item.id)))
        ), 'surviving identities/slots/poses unchanged');
    async function frame(label, expectedX = 0) {
      const before = window.__NATIVE_BUILDS__;
      const census = { beauty: 0, prepass: 0, shadow: 0 };
      const draw = r.renderer.backend.draw;
      r.renderer.backend.draw = function (object, info) {
        const before = info.render.drawCalls;
        const result = draw.apply(this, arguments);
        if (p._batches.includes(object.object)) {
          const pass = object.material.isShadowPassMaterial
            ? 'shadow'
            : object.context.renderTarget === rt
              ? 'prepass'
              : 'beauty';
          census[pass] += info.render.drawCalls - before;
        }
        return result;
      };
      try {
        await window.__PUMP__(1);
      } finally {
        r.renderer.backend.draw = draw;
      }
      if (label === 'first-population-render')
        require(census.beauty === 4 &&
          census.prepass === 3 &&
          census.shadow ===
            9, 'populated loot retains four beauty, three prepass and nine cascade draws');
      if (label === 'empty-after-clear')
        require(Object.values(census).every(
          (count) => count === 0
        ), 'cleared loot submits no draws');
      if (e.error) throw Error(JSON.stringify(e.error));
      const data = await r.renderer.readRenderTargetPixelsAsync(
        rt,
        0,
        0,
        rt.width,
        rt.height,
        attachment
      );
      if (!(data instanceof Uint16Array || data instanceof Float32Array))
        throw Error(`unexpected velocity format ${data.constructor.name}`);
      const decode = data instanceof Uint16Array ? half : (n) => n;
      let max = 0,
        above = 0,
        wrong = 0;
      for (let i = 0; i < data.length; i += 4) {
        const x = decode(data[i]),
          y = decode(data[i + 1]),
          n = Math.hypot(x, y);
        if (!Number.isFinite(n)) throw Error('nonfinite native velocity');
        max = Math.max(max, n);
        if (n > 0.001) {
          above++;
          // A camera-right-only translation has horizontal velocity, with a
          // bounded perspective variation across this small box's depth.
          if (
            expectedX &&
            (Math.abs(x - expectedX) > Math.abs(expectedX) * 0.2 + 0.0002 || Math.abs(y) > 0.0002)
          )
            wrong++;
        }
      }
      const builders = window.__NATIVE_BUILDS__ - before;
      frames.push({ label, max, above001: above, wrongMotionPixels: wrong, expectedX, builders });
      require(builders === 0, `${label}: no first-use/transition node builders`);
      if (expectedX)
        require(above > 5 &&
          wrong === 0, `${label}: moving survivor retains predicted nonzero motion`);
      else
        require(max <= 0.00001 &&
          above === 0, `${label}: stationary/fresh instances have no spurious velocity`);
    }
    try {
      for (const pos of lane.positions.slice(1)) p.spawn(pos);
      await frame('first-population-render');
      await frame('steady');
      for (const which of ['first', 'middle', 'last']) {
        const index =
          which === 'first'
            ? 0
            : which === 'middle'
              ? Math.floor(p.items.length / 2)
              : p.items.length - 1;
        const removed = p.items[index],
          survivors = snapshot(p.items.filter((item) => item !== removed));
        p._remove(removed);
        unchanged(survivors);
        await frame(`remove-${which}`);
        await frame(`settle-${which}`);
      }
      const beforeReuse = snapshot(p.items);
      p.spawn(lane.positions[32]); // lowest free slot, far from its previous identity
      unchanged(beforeReuse);
      await frame('reuse-hole-first-render');
      await frame('reuse-hole-established');
      while (p.items.length < 32) p.spawn(lane.positions[1 + (p.items.length % 32)]);
      await frame('refill');
      const oldest = p.items[0],
        survivors = snapshot(p.items.slice(1));
      const replacement = p.spawn(lane.positions[32]);
      require(replacement.slot === oldest.slot &&
        p.items.length === 32, 'oldest-cap replacement reuses only evicted slot');
      unchanged(survivors);
      await frame('oldest-cap-replacement');
      await frame('cap-established');
      const moving = p.items[10],
        removed = p.items[0];
      const delta = moving.group.position
        .clone()
        .setFromMatrixColumn(ctx.camera.matrixWorld, 0)
        .multiplyScalar(0.1);
      const start = moving.group.position.clone().add({ x: 0, y: 0.12, z: 0 }).project(ctx.camera);
      moving.group.position.add(delta);
      const end = moving.group.position.clone().add({ x: 0, y: 0.12, z: 0 }).project(ctx.camera);
      const still = snapshot(p.items.filter((item) => item !== moving && item !== removed));
      p._remove(removed);
      unchanged(still);
      await frame('moving-survivor-during-removal', end.x - start.x);
      await frame('moving-survivor-settled');
      // Exercise real expiry without adding bob motion to the stationary
      // oracle (the camera-right translation can contain roundoff in Y).
      for (const item of p.items) {
        item.baseY = item.group.position.y;
        item.phase = -ctx.time.elapsed * 1.8;
      }
      const expired = p.items[0];
      const beforeExpiry = snapshot(p.items.slice(1));
      expired.expires = ctx.time.elapsed;
      update.call(p, 0);
      unchanged(beforeExpiry);
      require(!p.items.includes(expired), 'real lifetime update expires only the selected item');
      await frame('expiry-removal');
      p.clear();
      await frame('empty-after-clear');
      p.spawn(lane.positions[30]);
      p.spawn(lane.positions[31]);
      await frame('restart-reuse-first-render');
      await frame('restart-established');
      require(window.__NATIVE_BUILDS__ ===
        0, 'no post-readiness builders including fixture/first-use');
      require(ctx.config.q.taa, 'world TAA remains enabled');
      return {
        frames,
        checks,
        attachment,
        format: 'native prepass RG velocity in NDC',
        totalBuilders: window.__NATIVE_BUILDS__,
        buildInfo: window.__NATIVE_BUILD_INFO__,
      };
    } finally {
      p.update = update;
      p.clear();
    }
  });
  report.mutations = mutations;
  if (args.negative) assert.equal(mutations, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    report.result.checks.filter((c) => !c.ok),
    [],
    'native transition invariants'
  );
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
console.log(JSON.stringify(report.result, null, 2));
