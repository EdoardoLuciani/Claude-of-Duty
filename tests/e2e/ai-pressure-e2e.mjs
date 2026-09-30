// Matched combat scenarios for #318. Real sensing, animation, firing, collision
// and the shared navigation scheduler; no forced visibility, arrivals or kills.
// --baseline records the unchanged policy without applying improvement gates.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ensureViteServer, launchChromium, stopViteServer, parseArgs } from '../../tools/lib/browser-harness.mjs';
import { combatLane, observeFriendlyDamage } from '../../tools/lib/combat-fixture.js';

const args = parseArgs(), port = Number(args.port ?? 5388);
const url = args.url ?? `http://127.0.0.1:${port}`;
const server = args.url ? null : await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio'] });
const report = { scenarios: [], errors: [], external: [] };
try {
  for (const scenario of (args.scenario ? [args.scenario] : ['flank', 'retreat', 'squad', 'elevated', 'blind-upper', 'suppressed'])) {
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
    // Inject only the placement helper so the same gate runs against preview;
    // all gameplay code still comes from the provenance-bound served bundle.
    await page.addScriptTag({ content: `window.__combatLane = ${combatLane.toString()};
      window.__observeFriendlyDamage = ${observeFriendlyDamage.toString()};` });
    const setup = await page.evaluate(async scenario => {
      const combatLane = window.__combatLane;
      const e = window.__ENGINE__, ctx = e.ctx, ai = ctx.get('ai'), player = ctx.get('player');
      const physics = ctx.get('physics'), world = ctx.get('world');
      for (const a of ai.agents) a.dispose();
      ai.agents.length = 0; ai.squads.length = 0;
      const slots = scenario === 'squad' ? [[16, -2], [16, 2], [20, 0]] : [[8, 0], [18, 0]];
      let lane = combatLane(ai, world, physics, slots);
      if (scenario === 'elevated' || scenario === 'blind-upper') {
        // Existing W5/W3 approaches + street sightlines. No authored tactical points,
        // forced assignment, injected contact, or scripted destination.
        const base = lane.positions[0].clone().fromArray(scenario === 'elevated' ? [7.89568, .1, 2.39135] : [6.168, .1, 1.505]);
        if (!ai.grid.sampleGround(base.x, base.z, base.y, base)) throw new Error('elevated player attachment');
        const positions = [base], eye = base.clone(); eye.y += 1.35;
        for (let i = 0; i < 32 && positions.length < 3; i++) {
          const angle = i * Math.PI / 16, p = base.clone();
          if (!ai.grid.sampleGround(base.x + Math.sin(angle) * 20, base.z + Math.cos(angle) * 20, base.y, p)) continue;
          if (positions.some(q => q.distanceTo(p) < 4)) continue;
          const muzzle = p.clone(); muzzle.y += 1.35;
          if (!physics.lineOfSight(muzzle, eye, physics.MASK.SIGHT)) continue;
          positions.push(p);
        }
        const approach = base.clone().fromArray(scenario === 'elevated'
          ? [4.414746484, .111462504, 26.455116109] : [-17.191797272, .146808594, -16.166266634]);
        if (!ai.grid.project(approach, approach)) throw new Error('upper-floor approach attachment');
        if (positions.length !== 3) throw new Error('no two supporting street lanes');
        positions.push(approach);
        lane = { positions, fx: -1, fz: 0 };
      }
      const base = lane.positions[0];
      const facing = scenario === 'elevated' ? { x: .23, y: Math.atan2(15.56, -16.95) } : Math.atan2(-lane.fx, -lane.fz);
      player.teleport({ x: base.x, y: base.y + player.eyeHeight, z: base.z }, facing);
      player.health.value = 10000; player.health.armour = 0;
      const sq = ai.createSquad();
      const s = window.__PRESSURE__ = { scenario, shots: [], actors: [], samples: [], maxSolves: 0, aiMs: [], started: e.time.elapsed };
      const group = scenario === 'squad' || scenario === 'elevated' || scenario === 'blind-upper';
      const positions = group ? lane.positions.slice(1) : [lane.positions[1]];
      for (const p of positions) {
        const a = ai.spawn('vanguard', p, Math.atan2(base.x - p.x, base.z - p.z));
        sq.add(a); a.hasGrenade = false; // isolate rifle pressure in both revisions
        if (!group) {
          // An audible shot alerts the mover, but only real sensing can acquire.
          a.hear(player.position, 50);
          a._setState(scenario === 'suppressed' ? 'combat' : scenario); a._goTo(lane.positions[2]);
          if (scenario === 'retreat') a.health = 30;
        }
        s.actors.push({ id: a.id, spawn: p.toArray(), firstVisible: null, firstShot: null });
      }
      window.__observeFriendlyDamage(ctx.events, ai.agents, ai.agents[0].team, s);
      ctx.events.on('shot:resolved', shot => {
        const a = shot.shooter;
        if (!ai.agents.includes(a)) return;
        const row = s.actors.find(r => r.id === a.id), t = e.time.elapsed - s.started;
        row.firstShot ??= t;
        s.shots.push({ t, id: a.id, from: [shot.from.x, shot.from.y, shot.from.z], result: shot.result,
          target: shot.target === player ? 'player' : typeof shot.target === 'string' ? shot.target : shot.target?.id ?? null,
          position: a.position.toArray(), elevated: sq.elevated === a, visible: a.targetVisible, hasTarget: a.hasTarget,
          visualAge: a.visualAge ?? null, kind: a.lastKnownKind, evidenceAge: a.lastKnownAge,
          suppression: a.suppression });
      });
      const update = ai.update.bind(ai);
      let frame = 0;
      ai.update = (dt, context) => {
        const queries = ai.grid.stats.queries, start = performance.now();
        // Isolate sustained incoming pressure, without granting a target or
        // faking a firing lane, cover arrival, animation or shot result.
        if (scenario === 'suppressed') for (const a of ai.agents) a.suppress(1.6);
        update(dt, context); s.aiMs.push(performance.now() - start);
        s.maxSolves = Math.max(s.maxSolves, ai.grid.stats.queries - queries);
        for (const a of ai.agents) {
          const row = s.actors.find(r => r.id === a.id);
          if (a.hasTarget && a.targetVisible) row.firstVisible ??= e.time.elapsed - s.started;
          row.relocations = a.relocations;
          if (frame % 12 === 0) s.samples.push({ t: e.time.elapsed - s.started, id: a.id, position: a.position.toArray(),
            state: a.state, visible: a.targetVisible, acquired: a.hasTarget, fireBlock: a.fireBlock,
            action: a.combatAction ?? null, coverFailure: a.coverFailure ?? null,
            elevated: sq.elevated === a, elevationStatus: sq.elevationStatus ?? null, goal: a.cover ? a.coverPos.toArray() : null,
            peek: a.firePos.toArray(), muzzle: a.animator.muzzleWorld.toArray(), lastKnown: a.lastKnown.toArray(),
            wantFire: a.wantFire, muzzleBlocked: a._muzzleBlocked, suppression: a.suppression });
        }
        frame++;
      };
      const { meta } = await ctx.get('models').worldPrefetch;
      return { provenance: ctx.get('telemetry').meta.provenance, assets: meta.assets, player: base.toArray(), actors: s.actors };
    }, scenario);
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.ok(setup.provenance.revision.startsWith(revision), 'serving revision must match checkout');
    if (args.clean) assert.equal(setup.provenance.revision, revision, 'acceptance requires a clean committed build');
    assert.deepEqual(setup.assets, JSON.parse(readFileSync(new URL('../../public/models/world/level.json', import.meta.url))).assets);
    const frames = scenario === 'elevated' || scenario === 'blind-upper' ? 3600 : scenario === 'squad' ? 1800 : 360;
    for (let i = 0; i < frames; i += 120) {
      await page.evaluate(() => window.__PUMP__(120));
      if (i === 0 && (scenario === 'flank' || scenario === 'suppressed') && args.shot) await page.screenshot({ path: args.shot });
      if (i === 600 && scenario === 'elevated' && args['elevated-shot']) await page.screenshot({ path: args['elevated-shot'] });
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
    assert.ok(run.shots.every(s => s.target === null || s.target === 'player'), 'no friendly first impacts');
    assert.equal(run.friendlyHits, 0, 'no friendly damage events, including penetration');
    assert.equal(run.friendlyDamage, 0, 'no friendly damage');
    assert.ok(run.shots.every(s => s.hasTarget && (s.visible || (s.kind === 'visual' && s.evidenceAge <= 1.2))));
    if (!args.baseline) {
      if (scenario === 'suppressed') {
        assert.ok(run.shots.length > 0, 'sustained suppression must not silence exposed soldiers');
        assert.ok(run.shots.every(s => s.suppression >= 1.15), 'shots must occur under strong pressure');
        assert.ok(run.samples.some(s => s.action === 'suppressed-move'), 'seek shelter while retaining defensive fire');
      }
      if (scenario === 'elevated') {
        assert.ok(run.samples.some(s => s.elevated && s.position[1] > 2.4), 'must physically reach an assigned upper floor');
        assert.ok(run.shots.some(s => s.elevated && s.position[1] > 2.4), 'upper position must produce actual safe fire');
      } else if (scenario === 'blind-upper') {
        assert.ok(!run.samples.some(s => s.elevated && s.goal && Math.hypot(s.goal[0] + 14.57748, s.goal[2] + 3.74248) < .2),
          'W3 eye-clear but barrel-blocked peek must not be assigned');
      } else if (scenario !== 'squad') {
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
