import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { ensureViteServer, launchChromium, stopViteServer, parseArgs } from '../../tools/lib/browser-harness.mjs';

const args = parseArgs(), port = Number(args.port ?? 5212), out = args.out ?? '/tmp/cod-engine-failure';
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&telemetry=1`);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await page.evaluate(() => window.__PUMP__(30));
  assert.deepEqual(errors, []);
  // Observe actual event subscriptions, not just the recorder's serialization helper.
  const heal = await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx, player = ctx.get('player'), rec = ctx.get('telemetry');
    const { meta } = await ctx.get('models').worldPrefetch;
    await rec._provenanceReady;
    player.health.value = 40;
    player.controlEnabled = true;
    player.healCtrl.tryStart(); rec._samplePlayer(); player.cancelHeal('test');
    player.healCtrl.tryStart(); player.healCtrl.complete();
    return { events: rec.events.filter(e => e.type === 'player:heal'),
      sample: rec.playerSamples.at(-1), loaded: meta.sourceHash, recorded: rec.meta.provenance.world.sourceHash };
  });
  assert.equal(heal.loaded, heal.recorded);
  assert.deepEqual(heal.events.map(e => e.phase), ['start', 'cancel', 'start', 'complete']);
  assert.equal(heal.sample.healing, true);
  assert.equal(heal.events.at(-1).bandages, heal.sample.bandages - 1);
  await page.screenshot({ path: `${out}/before.png` });
  const result = await page.evaluate(async () => {
    const e = window.__ENGINE__, rec = e.ctx.get('telemetry');
    let late = 0, renders = 0;
    const weapons = e.ctx.get('weapons'), render = e.ctx.get('render'), draw = render.render.bind(render);
    weapons.update = () => { throw new Error('Injected subsystem failure'); };
    weapons.lateUpdate = () => { late++; };
    render.render = ctx => { renders++; draw(ctx); };
    let rejected = false;
    try { await window.__PUMP__(1); } catch { rejected = true; }
    const elapsed = e.time.elapsed;
    e.time.scale = 1; // Even a pause/menu action cannot restart the simulation.
    for (let i = 0; i < 3; i++) e.step();
    return { rejected, error: e.error, frozen: e.time.elapsed === elapsed, late, renders,
      inputDisabled: !e.input.enabled && e.input.frozen,
      events: rec.events.filter(event => event.type === 'engine:error') };
  });
  assert.equal(result.rejected, true);
  assert.equal(result.error.system, 'weapons');
  assert.equal(result.error.method, 'update');
  assert.equal(result.frozen, true); assert.equal(result.inputDisabled, true);
  assert.equal(result.late, 0); assert.equal(result.renders, 4);
  assert.equal(result.events.length, 1);
  assert.equal(await page.locator('#engine-failure').count(), 1);
  await page.evaluate(() => {
    window.addEventListener('keydown', () => { window.__LEAKED_KEY__ = true; });
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => !!window.__LEAKED_KEY__), false, 'no global menu hotkeys after failure');
  assert.equal(await page.locator('#engine-failure').evaluate(el => el.open), true, 'failure cannot be dismissed');
  assert.equal(await page.getByRole('button', { name: 'Reload game' }).isVisible(), true);
  await page.screenshot({ path: `${out}/after.png` });
  assert.equal(errors.length, 1); assert.match(errors[0], /Injected subsystem failure/);
  console.log(JSON.stringify(result));

  for (const fault of ['event', 'resize']) {
    errors.length = 0;
    await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`);
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
    await page.evaluate(() => window.__PUMP__(3));
    assert.deepEqual(errors, []);
    const boundary = await page.evaluate(async fault => {
      const e = window.__ENGINE__, p = e.ctx.get('player'), w = e.ctx.get('weapons');
      let later = 0, listeners = 0, fatal = 0, at = 0, once = false, continued = 0, resized = 0;
      e.events.on('engine:error', () => fatal++);
      w.lateUpdate = () => later++;
      e.ctx.get('ui').resize = () => resized++;
      e.events.on('resize', () => resized++);
      if (fault === 'event') {
        // Exercise the player's real damage subscription and abort its producer.
        p._onDamageDealt = () => { at = e.time.elapsed; throw new Error('Injected damage failure'); };
        e.events.on('damage:dealt', () => listeners++);
        w.update = () => {
          if (once) return;
          once = true;
          e.events.emit('damage:dealt', { target: 'player', amount: 1 });
          continued++;
        };
      } else {
        w.resize = () => { at = e.time.elapsed; throw new Error('Injected resize failure'); };
        window.dispatchEvent(new Event('resize'));
      }
      let rejected = false;
      try { await window.__PUMP__(4); } catch { rejected = true; }
      e.time.scale = 1;
      for (let i = 0; i < 3; i++) e.step();
      e.resize();
      return { fault, later, listeners, fatal, continued, resized, rejected, error: e.error,
        advancedMs: 1000 * (e.time.elapsed - at) };
    }, fault);
    assert.equal(boundary.rejected, true);
    assert.equal(boundary.error.system, fault === 'event' ? 'events' : 'weapons');
    assert.equal(boundary.error.method, fault === 'event' ? 'damage:dealt' : 'resize');
    for (const key of ['later', 'listeners', 'continued', 'resized', 'advancedMs']) assert.equal(boundary[key], 0, key);
    assert.equal(boundary.fatal, 1);
    assert.equal(await page.locator('#engine-failure').evaluate(el => el.open), true);
    assert.equal(errors.length, 1); assert.match(errors[0], /Injected/);
    console.log(JSON.stringify(boundary));
  }
} finally { await browser.close(); stopViteServer(server); }
