// Native startup state and first-use coverage, including the readiness frames.
import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
import { waitForGame, captureNative } from '../../tools/lib/native-render.mjs';
const args = parseArgs(), port = Number(args.port ?? 5393);
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (args.negative) {
    assert.equal(args.negative, 'weapons');
    await page.route('**/src/weapons/index.js', async route => {
      const response = await route.fetch(), body = await response.text();
      const marker = '  async prewarmMaterials() {';
      assert.equal(body.split(marker).length, 2);
      await route.fulfill({ response, body: body.replace(marker,
        marker + '\n    globalThis.__WEAPON_WARMUP_OMITTED__ = true; return { ok: true };') });
    });
  }
  if (args.failure) {
    assert.equal(args.failure, 'prewarm');
    await page.route('**/src/weapons/index.js', async route => {
      const response = await route.fetch(), body = await response.text();
      const marker = '  async prewarmMaterials() {';
      assert.equal(body.split(marker).length, 2);
      await route.fulfill({ response, body: body.replace(marker,
        marker + '\n    throw new Error("maintenance warmup failure");') });
    });
  }
  // Observe the real function, not a replay after boot (which would already be warm).
  await page.route('**/src/core/prewarm.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'export async function prewarm(';
    assert.equal(body.split(marker).length, 2);
    const probe = async function(engine, options) {
      const snapshot = () => ({ time: { ...engine.time },
        camera: [engine.camera.position.toArray(), engine.camera.quaternion.toArray(), engine.camera.fov],
        rng: { ...engine.rng }, agents: engine.ctx.get('ai').agents.length,
        health: [engine.ctx.get('player').health.value, engine.ctx.get('player').health.armour] });
      const before = snapshot(), rng = engine.rng.constructor.prototype, u32 = rng.u32;
      const renderer = engine.ctx.get('render').renderer, target = renderer.getRenderTarget();
      let rngCalls = 0, result;
      rng.u32 = function() { rngCalls++; return u32.call(this); };
      try { result = await observedPrewarm(engine, options); }
      finally { rng.u32 = u32; }
      window.__STARTUP_CHECK__ = { before, after: snapshot(), rngCalls,
        targetRestored: renderer.getRenderTarget() === target, builds: [], ok: result.ok,
        duplicate: Object.hasOwn(engine, '__prewarmHooks') };
      const previous = renderer.debug.onNodeBuilderCreated;
      renderer.debug.onNodeBuilderCreated = (...args) => {
        const [builder, owner] = args;
        window.__STARTUP_CHECK__.builds.push({ material: owner.material?.name,
          object: builder.object?.name, frame: engine.time.frame });
        previous?.(...args);
      };
      return result;
    };
    await route.fulfill({ response, body: body.replace(marker, 'async function observedPrewarm(') +
      `\nexport const prewarm = ${probe};\n` });
  });
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&q=${args.quality ?? 'high'}`);
  if (args.failure) {
    await assert.rejects(waitForGame(page), /Native material warmup failed/);
    const failed = await page.evaluate(() => ({
      ready: window.__READY__ === true, report: window.__PREWARM__, boot: window.__STARTUP_CHECK__,
    }));
    assert.equal(failed.ready, false); assert.equal(failed.boot.duplicate, false);
    assert.equal(failed.report.ok, false);
    assert.equal(failed.report.hooks.weapons.reason, 'maintenance warmup failure');
    assert.deepEqual(failed.boot.before, failed.boot.after);
    assert.equal(failed.boot.rngCalls, 0); assert.equal(failed.boot.targetRestored, true);
    console.log(JSON.stringify({ failedBoot: true, report: failed.report, ready: failed.ready }));
    // The normal __ENGINE__ handshake is intentionally not published on failed boot.
  } else {
    await waitForGame(page);
    if (args.negative) {
      assert.equal(await page.evaluate(() => window.__WEAPON_WARMUP_OMITTED__), true);
      console.log('weapons warmup omission installed and executed');
    }
    const boot = await page.evaluate(() => window.__STARTUP_CHECK__);
    assert(boot?.ok, 'startup probe must execute and warmup must succeed');
    assert.deepEqual(boot.after, boot.before, 'warmup must preserve gameplay state');
    assert.equal(boot.rngCalls, 0, 'including subsystem RNG forks');
    assert.equal(boot.targetRestored, true);
    assert.deepEqual(boot.builds, [], 'first readiness frames must already be warm');
    const weapons = await page.evaluate(async () => {
      const e = window.__ENGINE__, w = e.ctx.get('weapons'), player = e.ctx.get('player');
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      window.__APPLY_SHOT__('ads');
      const ids = ['rifle', 'pistol', 'mcx', 'smg', 'lmg', 'shotgun', 'sniper'];
      for (const id of ids) {
        check(w.setWeaponImmediate(id), `${id}: equip failed`);
        w.debugMode = 'ads'; await window.__PUMP__(60);
        if (id === 'sniper') check(w.viewmodel.scopeOverlay.visible, 'scope overlay not exercised');
        w.debugMode = 'idle'; await window.__PUMP__(60);
        check(w.tryFire(), `${id}: fire refused`); await window.__PUMP__(120);
        w.state.mag = 0; w.state.chambered = false; w.state.reserve = w.state.def.magSize * 2;
        check(w.reload(), `${id}: empty reload refused`);
        for (let frames = 0; w.reloading && frames < 900; frames += 30) await window.__PUMP__(30);
        check(!w.reloading && w.state.mag > 0, `${id}: reload did not complete`);
        await window.__PUMP__(30);
        check(!e.error && !player.dead, `${id}: gameplay failed`);
        check(window.__STARTUP_CHECK__.builds.length === 0,
          `${id}: late builders ${JSON.stringify(window.__STARTUP_CHECK__.builds)}`);
      }
      return ids;
    });
    // Alternate readback targets may build capture-only variants: capture last,
    // never warm/reset the first-use counter through a diagnostic render.
    if (args.shot) await captureNative(page, String(args.shot));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ quality: args.quality ?? 'high', statePreserved: true,
      rngCalls: boot.rngCalls, readinessBuilders: boot.builds.length,
      weapons, checks: ['equip', 'ADS/optics', 'fire/FX', 'complete empty reload'], lateBuilders: 0 }));
    await page.evaluate(() => window.__ENGINE__.dispose());
  }
} finally {
  try { await browser?.close(); } finally { stopViteServer(server); }
}
