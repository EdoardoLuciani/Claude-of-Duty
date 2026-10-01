/** Real collision/aim/input probe for all 14 sites. Optional SHOT_DIR writes review PNGs. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { ensureViteServer, launchChromium, stopViteServer } from '../../tools/lib/browser-harness.mjs';

const port = Number(process.env.PORT ?? 8096);
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const pump = (n) => page.evaluate((frames) => window.__PUMP__(frames), n);
const state = () => page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const intel = ctx.get('intel');
  return { hold: intel._hold, secured: intel.secured, credits: ctx.get('market').credits,
    prompt: ctx.get('ui').prompt.active, alive: intel._alive.length, card: intel.getHudState().card };
});
const shot = async (name) => {
  if (!process.env.SHOT_DIR) return;
  mkdirSync(process.env.SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
};
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { timeout: 120000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  const boot = await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.events.emit('wave:complete', { wave: 1, nextWave: 2, delay: 20 });
    const intel = e.ctx.get('intel');
    return { budget: intel.budget, alive: intel._alive.length, prewarm: e.__prewarmHooks.intel };
  });
  assert.equal(boot.budget, 0);
  assert.equal(boot.alive, 0);
  assert.equal(boot.prewarm.ok, true);
  // Reset away the artificial shop deadline, then opt in to live player controls.
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.events.emit('game:restart', { source: 'test' });
    ctx.input.frozen = false;
    ctx.input.enabled = true;
    ctx.get('player').setControlEnabled(true);
    ctx.config.deterministic = false;
    ctx.get('intel').reset();
    ctx.config.deterministic = true; // keep the wave director out of this fixture
  });
  const sites = await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const physics = ctx.get('physics');
    const intel = ctx.get('intel');
    return intel.markers.map((m) => {
      const floor = physics.groundHeight(m.x, m.z, m.y + 0.6);
      const body = physics.overlapSphere({ x: m.x, y: m.y + 0.27, z: m.z }, 0.2);
      const approaches = [];
      for (let i = 0; i < 8; i++) {
        const x = m.x + Math.sin(i * Math.PI / 4) * 1.2;
        const z = m.z + Math.cos(i * Math.PI / 4) * 1.2;
        const y = physics.groundHeight(x, z, m.y + 0.5);
        if (Math.abs(y - m.y) > 0.2) continue;
        const clear = physics.checkCapsule({ x, y: y + 0.34, z }, { x, y: y + 1.45, z }, 0.32);
        const los = physics.lineOfSight({ x, y: y + 1.65, z }, { x: m.x, y: m.y + 0.35, z: m.z });
        if (clear && los) approaches.push({ x, y, z });
      }
      return { id: m.id, floorDelta: floor - m.y, body, approach: approaches[0] };
    });
  });
  assert.equal(sites.length, 14);
  for (const site of sites) {
    assert(Math.abs(site.floorDelta) < 0.02, `${site.id}: supported by authored floor`);
    assert.equal(site.body, 0, `${site.id}: case intersects world geometry`);
    assert(site.approach, `${site.id}: needs a standing LOS approach`);
  }
  // Match the baseline review pose (the first site's south-side approach).
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const intel = ctx.get('intel');
    const m = intel.markers.find((m) => m.id === 'w5-living');
    ctx.get('player').teleport(ctx.camera.position.clone().set(m.x, m.y + 1.65, m.z + 1.2), { x: -0.75, y: 0, z: 0 });
  });
  await pump(30);
  const programsBefore = await page.evaluate(() => {
    const programs = window.__ENGINE__.ctx.get('render').renderer.info.programs;
    window.__INTEL_PROGRAMS__ = programs.map((p) => p.cacheKey);
    return programs.length;
  });
  await page.evaluate(() => {
    const intel = window.__ENGINE__.ctx.get('intel');
    intel._spawn(intel.markers.find((m) => m.id === 'w5-living'));
  });
  await pump(30);
  assert((await state()).prompt);
  const programsAfter = await page.evaluate(() => {
    const programs = window.__ENGINE__.ctx.get('render').renderer.info.programs;
    const added = programs.filter((p) => !window.__INTEL_PROGRAMS__.includes(p.cacheKey));
    return { count: programs.length, added: added.map((p) => p.cacheKey.slice(0, 256)) };
  });
  assert.equal(programsAfter.count, programsBefore, `first cache must not compile shaders during play: ${JSON.stringify(programsAfter.added)}`);
  await shot('cache');
  await page.evaluate(() => window.__ENGINE__.input.down.add('KeyF'));
  await pump(60);
  let s = await state();
  assert(s.hold > 0.9 && s.hold < 1.1, JSON.stringify(s));
  await shot('holding');
  await page.evaluate(() => {
    window.__ENGINE__.events.emit('damage:taken', { amount: 0, armourAbsorbed: 12 });
  });
  assert.equal((await state()).hold, 0);
  await pump(30);
  await page.evaluate(() => window.__ENGINE__.ctx.get('player').movement.pitch = 0.4);
  await pump(2);
  assert.equal((await state()).hold, 0, 'turning away wipes hold');
  await page.evaluate(() => window.__ENGINE__.ctx.get('player').movement.pitch = -0.75);
  await pump(30);
  await page.evaluate(() => window.__ENGINE__.ctx.get('market').openShop(1));
  await pump(60);
  s = await state();
  assert.equal(s.hold, 0, 'opening shop during hold wipes progress');
  assert.equal(s.secured, 0, 'shop freezes securing');
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.get('market').closeShop();
    ctx.input.frozen = false;
    ctx.input.enabled = true;
    ctx.get('player').setControlEnabled(true);
    ctx.input.down.clear();
  });
  await pump(2);
  // A dropped ammo case must not steal F or collect while securing intel.
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const weapons = ctx.get('weapons');
    weapons.state.reserve = 0;
    weapons.pickups.spawn(ctx.get('player').feetPosition);
    ctx.input.down.add('KeyF');
  });
  await pump(152);
  s = await state();
  assert.equal(s.secured, 1, JSON.stringify(s));
  assert.equal(s.credits, 150, 'cache payout is separate from score');
  assert.equal(s.alive, 0);
  assert(s.card);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').state.reserve), 0);
  await shot('secured');
  await pump(40);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').state.reserve), 0, 'held F cannot leak after completion');
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.input.down.clear();
    ctx.get('weapons').pickups.clear();
    ctx.get('weapons').refillAmmo();
  });
  // Open every authored point through the live controller and real physics, not a mock LOS.
  const results = [];
  for (const site of sites) {
    await page.evaluate(({ id, approach }) => {
      const ctx = window.__ENGINE__.ctx;
      const intel = ctx.get('intel');
      intel.reset();
      const m = intel.markers.find((m) => m.id === id);
      intel._spawn(m);
      const eye = ctx.camera.position.clone().set(approach.x, approach.y + 1.65, approach.z);
      const dx = m.x - eye.x, dz = m.z - eye.z, dy = m.y + 0.35 - eye.y;
      ctx.get('player').teleport(eye, { x: Math.atan2(dy, Math.hypot(dx, dz)), y: Math.atan2(-dx, -dz), z: 0 });
      ctx.input.down.clear();
    }, site);
    await pump(8);
    assert((await state()).prompt, `${site.id}: visible interaction prompt`);
    await page.evaluate(() => window.__ENGINE__.input.down.add('KeyF'));
    await pump(152);
    const result = await state();
    assert.equal(result.secured, 1, `${site.id}: ${JSON.stringify(result)}`);
    results.push(site.id);
  }
  await page.evaluate(() => window.__ENGINE__.events.emit('game:restart', { source: 'test' }));
  s = await state();
  assert.equal(s.secured, 0);
  assert.equal(s.credits, 0);
  assert.equal(s.alive, 0);
  assert.equal(s.card, '');
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').banner.t), 1, 'restart clears stale cache banners');
  // Exercise selection through real wave events using the exported world markers.
  const placements = await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const intel = ctx.get('intel');
    const player = ctx.get('player');
    const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const results = [];
    ctx.config.deterministic = false;
    try {
      intel.reset();
      for (let wave = 1; wave <= 2; wave++) {
        const candidates = intel.markers.filter((m) => !intel._used.has(m.id) &&
          distance(m, player.feetPosition) >= 18 && intel._alive.every((c) => distance(m, c) >= 24));
        ctx.events.emit('wave:complete', { wave, nextWave: wave + 1, delay: 20 });
        const cache = intel._alive[wave - 1];
        results.push({ wave, candidateCount: candidates.length, selected: cache?.id,
          valid: candidates.some((m) => m.id === cache?.id) });
      }
      ctx.events.emit('wave:complete', { wave: 3, nextWave: 4, delay: 20 });
      results.push({ liveCount: intel._alive.length });
    } finally {
      ctx.config.deterministic = true;
      ctx.events.emit('game:restart', { source: 'test' });
    }
    return results;
  });
  for (const placement of placements.slice(0, 2)) {
    assert(placement.candidateCount > 0 && placement.valid, JSON.stringify(placement));
  }
  assert.equal(placements[2].liveCount, 2);
  const audio = await page.evaluate(async () => {
    const { uiSound } = await import('/src/audio/foley.js');
    const { NoiseBank } = await import('/src/audio/dsp.js');
    const { Rng } = await import('/src/core/rng.js');
    const results = [];
    for (const kind of ['intel_beep', 'intel_pry', 'intel_call']) {
      const actx = new OfflineAudioContext(1, 48000, 48000);
      const rng = new Rng(132);
      const bank = new NoiseBank(actx, rng.fork(), 1.2);
      uiSound(actx, bank, rng, kind, { when: 0.01 }).node.connect(actx.destination);
      const buffer = await actx.startRendering();
      let peak = 0, sum = 0, nan = 0;
      for (const sample of buffer.getChannelData(0)) {
        if (!Number.isFinite(sample)) nan++;
        peak = Math.max(peak, Math.abs(sample));
        sum += sample * sample;
      }
      results.push({ kind, peak, rms: Math.sqrt(sum / buffer.length), nan });
    }
    return results;
  });
  for (const sound of audio) {
    assert.equal(sound.nan, 0, sound.kind);
    assert(sound.peak > 0.01 && sound.peak < 1, JSON.stringify(sound));
    assert(sound.rms > 0.001, JSON.stringify(sound));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, sites: results, checks: ['deterministic', 'prewarm (zero first-spawn compiles)', 'aim', 'plate hit', 'shop pause', 'F ownership', 'credits', 'restart', 'wave-event spawn spacing', 'offline audio synthesis'] }, null, 2));
} catch (error) {
  console.error('browser errors:', errors);
  console.error(await page.evaluate(() => ({ ready: window.__READY__, engineError: window.__ENGINE__?.error, text: document.body.innerText.slice(-1500) })).catch(() => null));
  throw error;
} finally {
  await browser.close();
  stopViteServer(server);
}
