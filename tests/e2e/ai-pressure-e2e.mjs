// Matched combat scenarios for #318. Real sensing, animation, firing, collision
// and the shared navigation scheduler; no forced visibility, arrivals or kills.
// --baseline records the unchanged policy without applying improvement gates.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ensureViteServer, launchChromium, stopViteServer, parseArgs } from '../../tools/lib/browser-harness.mjs';

const args = parseArgs(), port = Number(args.port ?? 5198);
const url = args.url ?? `http://127.0.0.1:${port}`;
const server = args.url ? null : await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio'] });
const report = { scenarios: [], errors: [], external: [] };
try {
  for (const scenario of ['flank', 'retreat', 'squad']) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== new URL(url).origin) {
        report.external.push(route.request().url()); return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${url}/?capture=1&lockstep=1&telemetry=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
    const setup = await page.evaluate(async scenario => {
      const { combatLane } = await import('/tools/lib/combat-fixture.js');
      const e = window.__ENGINE__, ctx = e.ctx, ai = ctx.get('ai'), player = ctx.get('player');
      const physics = ctx.get('physics'), world = ctx.get('world');
      for (const a of ai.agents) a.dispose();
      ai.agents.length = 0; ai.squads.length = 0;
      const slots = scenario === 'squad' ? [[16, -2], [16, 2], [20, 0]] : [[8, 0], [18, 0]];
      const lane = combatLane(ai, world, physics, slots), base = lane.positions[0];
      player.teleport({ x: base.x, y: base.y + player.eyeHeight, z: base.z }, Math.atan2(-lane.fx, -lane.fz));
      player.health.value = 10000; player.health.armour = 0;
      const sq = ai.createSquad();
      const s = window.__PRESSURE__ = { scenario, shots: [], actors: [], samples: [], maxSolves: 0, aiMs: [], started: e.time.elapsed };
      const positions = scenario === 'squad' ? lane.positions.slice(1) : [lane.positions[1]];
      for (const p of positions) {
        const a = ai.spawn('vanguard', p, Math.atan2(base.x - p.x, base.z - p.z));
        sq.add(a); a.hasGrenade = false; // isolate rifle pressure in both revisions
        if (scenario !== 'squad') {
          // An audible shot alerts the mover, but only real sensing can acquire.
          a.hear(player.position, 50);
          a._setState(scenario); a._goTo(lane.positions[2]);
          if (scenario === 'retreat') a.health = 30;
        }
        s.actors.push({ id: a.id, spawn: p.toArray(), firstVisible: null, firstShot: null });
      }
      ctx.events.on('shot:resolved', shot => {
        if (!String(shot.shooter).startsWith('ai:')) return;
        const a = ai.agents.find(a => `ai:${a.id}` === shot.shooter);
        const row = s.actors.find(r => r.id === a.id), t = e.time.elapsed - s.started;
        row.firstShot ??= t;
        s.shots.push({ t, id: a.id, from: [shot.from.x, shot.from.y, shot.from.z], result: shot.result,
          target: typeof shot.target === 'string' ? shot.target : null, visible: a.targetVisible, hasTarget: a.hasTarget,
          visualAge: a.visualAge ?? null, kind: a.lastKnownKind, evidenceAge: a.lastKnownAge });
      });
      const update = ai.update.bind(ai);
      let frame = 0;
      ai.update = (dt, context) => {
        const queries = ai.grid.stats.queries, start = performance.now();
        update(dt, context); s.aiMs.push(performance.now() - start);
        s.maxSolves = Math.max(s.maxSolves, ai.grid.stats.queries - queries);
        for (const a of ai.agents) {
          const row = s.actors.find(r => r.id === a.id);
          if (a.hasTarget && a.targetVisible) row.firstVisible ??= e.time.elapsed - s.started;
          row.relocations = a.relocations;
          if (frame % 12 === 0) s.samples.push({ t: e.time.elapsed - s.started, id: a.id, position: a.position.toArray(),
            state: a.state, visible: a.targetVisible, acquired: a.hasTarget, fireBlock: a.fireBlock,
            action: a.combatAction ?? null, coverFailure: a.coverFailure ?? null });
        }
        frame++;
      };
      const { meta } = await ctx.get('models').worldPrefetch;
      return { provenance: ctx.get('telemetry').meta.provenance, assets: meta.assets, player: base.toArray(), actors: s.actors };
    }, scenario);
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.ok(setup.provenance.revision.startsWith(revision), 'serving revision must match checkout');
    assert.deepEqual(setup.assets, JSON.parse(readFileSync(new URL('../../public/models/world/level.json', import.meta.url))).assets);
    const frames = scenario === 'squad' ? 1800 : 360;
    for (let i = 0; i < frames; i += 120) {
      await page.evaluate(() => window.__PUMP__(120));
      if (i === 0 && scenario === 'flank' && args.shot) await page.screenshot({ path: args.shot });
    }
    const run = await page.evaluate(() => {
      const { aiMs, ...s } = window.__PRESSURE__;
      aiMs.sort((a, b) => a - b);
      return { ...s, aiMs: { p95: aiMs[Math.floor(aiMs.length * .95)], max: aiMs.at(-1) } };
    });
    report.scenarios.push({ setup, run });
    if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
    console.log(scenario, JSON.stringify({ actors: run.actors, shots: run.shots.length, maxSolves: run.maxSolves, aiMs: run.aiMs }));
    assert.ok(run.maxSolves <= 2);
    assert.ok(run.actors.every(a => a.relocations === 0));
    assert.ok(run.shots.every(s => s.hasTarget && (s.visible || (s.kind === 'visual' && s.evidenceAge <= 1.2))));
    if (!args.baseline) {
      if (scenario !== 'squad') {
        assert.ok(run.actors[0].firstVisible !== null);
        assert.ok(run.actors[0].firstShot !== null && run.actors[0].firstShot - run.actors[0].firstVisible < 2,
          `${scenario}: close threat must not wait for route completion`);
      } else {
        assert.ok(run.actors.filter(a => a.firstShot !== null).length >= 2, 'early three-member squad must apply multi-actor pressure');
      }
    }
    await page.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []);
} finally {
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
  await browser.close(); stopViteServer(server);
}
