// Controlled wave-navigation integration, NOT a combat/playtest acceptance run.
// Real spawning, AI sensing/thinking, crowd movement, recovery, scheduler and
// wave/market lifecycle. A nonparticipating player and authored patrol goals
// isolate navigation. Enemies are retired only AFTER physical floor-correct arrival.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadMap, addAccessCases } from './fixtures.mjs';
import { ensureViteServer, launchChromium, stopViteServer, parseArgs } from '../lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5195), url = args.url ?? `http://127.0.0.1:${port}`;
const f = await loadMap(); addAccessCases(f);
const goals = ['W3/captured-room', 'E4/street', 'W1/street', 'E1/street', 'E2/street', 'E3/street', 'W5/street', 'W2/street']
  .map(name => ({ name, position: f.cases.find(c => c.name === `access/${name}/up`).to.toArray() }));
const server = args.url ? null : await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [], external = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== new URL(url).origin) {
      external.push(route.request().url()); return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${url}/?capture=1&lockstep=1&telemetry=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  const boot = await page.evaluate(async goals => {
    const e = window.__ENGINE__, ctx = e.ctx, ai = ctx.get('ai'), player = ctx.get('player');
    const { meta } = await ctx.get('models').worldPrefetch;
    const s = window.__NAV_WAVES__ = { frame: 0, maxSolves: 0, snaps: 0, completed: [], waves: [], actors: [], marketCycles: 0, aiMs: [], queryMs: [] };
    // Keep the controlled patrol fixture free from player combat intervention.
    player.teleport({ x: 1000, y: 1000, z: 1000 }); player.update = () => {};
    ctx.camera.position.set(35, 45, 40); ctx.camera.lookAt(0, 0, 0); ctx.camera.updateMatrixWorld(true);
    ctx.config.deterministic = false; // exercise the real wave director
    ctx.events.on('market:open', () => { s.marketCycles++; ctx.get('market').closeShop(); });
    ctx.events.on('wave:complete', event => s.completed.push({ wave: event.wave, t: ctx.time.elapsed }));
    ctx.events.on('wave:start', event => {
      const wave = { number: event.wave, start: ctx.time.elapsed, total: event.enemies, lastTwoAt: null };
      s.waves.push(wave); ai._pathBudget = 0;
      ai.agents.filter(a => a.alive).forEach((a, i) => {
        const goal = goals[event.wave === 2 ? 2 + i % 6 : i % 2];
        const to = a.position.clone().fromArray(goal.position);
        a.patrolPoints = [to]; a.patrolIndex = 0; a._setState('patrol'); a._goTo(to);
        a._gate = { wave: event.wave, id: a.id, goal: goal.name, from: a.position.toArray(), to: goal.position,
          started: ctx.time.elapsed, startFrame: s.frame, firstService: null, arrived: null, maxStationary: 0, recoveries: 0, relocations: 0 };
        a._gateProgress = a.position.clone(); a._gateProgressAt = ctx.time.elapsed;
        s.actors.push(a._gate);
        const teleport = a.controller.teleport.bind(a.controller);
        a.controller.teleport = (...p) => { s.snaps++; return teleport(...p); };
      });
    });
    const query = ai.grid.findPath.bind(ai.grid);
    ai.grid.findPath = (...p) => { const t = performance.now(), n = query(...p); s.queryMs.push(performance.now() - t); return n; };
    const request = ai.requestPath.bind(ai), update = ai.update.bind(ai);
    ai.requestPath = (...p) => {
      const result = request(...p), a = p[3];
      if (result >= 0 && a?._gate && a._gate.firstService === null) a._gate.firstService = s.frame;
      return result;
    };
    ai.update = (dt, context) => {
      s.frame++; const before = ai.grid.stats.queries, t = performance.now();
      update(dt, context); s.aiMs.push(performance.now() - t);
      s.maxSolves = Math.max(s.maxSolves, ai.grid.stats.queries - before);
      const live = ai.agents.filter(a => a.alive && a._gate), wave = s.waves.at(-1);
      if (wave && live.length <= 2 && wave.lastTwoAt === null) wave.lastTwoAt = ctx.time.elapsed;
      for (const a of live) {
        const row = a._gate, p = a.position;
        if (p.distanceToSquared(a._gateProgress) >= .25) { a._gateProgress.copy(p); a._gateProgressAt = ctx.time.elapsed; }
        row.maxStationary = Math.max(row.maxStationary, ctx.time.elapsed - a._gateProgressAt);
        row.recoveries = a.recoveryAttempts; row.relocations = a.relocations;
        if (s.frame % 60 === 0) { row.position = p.toArray(); row.pathReason = a.pathReason; row.recovery = a.recoveryOutcome; }
        if (Math.hypot(p.x - row.to[0], p.z - row.to[2]) <= .45 && Math.abs(p.y - row.to[1]) <= .18) {
          row.arrived = ctx.time.elapsed; row.end = p.toArray();
          a.applyDamage(1000, 'torso'); // fixture retirement, never a rescue or arrival proxy
        }
      }
    };
    ai.startWave(1);
    return { revision: ctx.get('telemetry').meta.provenance.revision, assets: meta.assets, sourceHash: meta.sourceHash };
  }, goals);
  assert.deepEqual(boot.assets, JSON.parse(readFileSync(new URL('../../public/models/world/level.json', import.meta.url))).assets);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).trim();
  assert.ok(boot.revision.startsWith(revision), 'server revision must match this checkout');
  for (let batch = 0; batch < 270; batch++) {
    await page.evaluate(() => window.__PUMP__(120));
    const progress = await page.evaluate(() => {
      const s = window.__NAV_WAVES__, t = window.__ENGINE__.time.elapsed;
      return { done: s.completed.length, t, waveTime: t - s.waves.at(-1).start,
        pending: s.actors.filter(a => a.arrived === null).map(a => ({ id: a.id, reason: a.pathReason, recoveries: a.recoveries })) };
    });
    if (batch % 15 === 0) console.log(progress);
    if (progress.done >= 3 || progress.waveTime > 180) break;
  }
  const run = await page.evaluate(() => {
    const { aiMs, queryMs, ...s } = window.__NAV_WAVES__;
    const dist = values => { values.sort((a, b) => a - b); return { p50: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)], max: values.at(-1) }; };
    return { ...s, aiUpdateMs: dist(aiMs), queryMs: dist(queryMs), navStats: window.__ENGINE__.ctx.get('ai').grid.stats };
  });
  const report = { mode: 'controlled-patrol-waves; not combat acceptance', boot, run, errors, external };
  writeFileSync(args.out ?? '/tmp/nav-access-waves.json', JSON.stringify(report, null, 2) + '\n');
  await page.screenshot({ path: args.shot ?? '/tmp/nav-access-waves.png' });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert.equal(run.completed.length, 3, 'all three waves must finish through physical arrivals');
  assert.equal(run.actors.length, 21); assert.equal(run.snaps, 0); assert.ok(run.maxSolves <= 2);
  for (const a of run.actors) {
    assert.ok(a.arrived !== null, `${a.id}/${a.goal}: not arrived`);
    assert.equal(a.relocations, 0); assert.ok(a.maxStationary < 15, `${a.id}: prolonged physical stall`);
    assert.ok(a.firstService !== null && a.firstService - a.startFrame <= Math.ceil(run.waves[a.wave - 1].total / 2), `${a.id}: deferred starvation`);
  }
  console.log(JSON.stringify({ completed: run.completed, actors: run.actors.length, maxSolves: run.maxSolves, snaps: run.snaps }));
} finally { await browser.close(); stopViteServer(server); }
