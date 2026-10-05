// September 27 regression placements. --baseline records the old policy;
// all safety/provenance checks still run. No forced visibility, shots or arrivals.
import { waitForGame, captureNative } from '../../tools/lib/native-render.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ensureViteServer, launchChromium, stopViteServer, parseArgs } from '../../tools/lib/browser-harness.mjs';
import { observeFriendlyDamage } from '../../tools/lib/combat-fixture.js';

const args = parseArgs(), port = Number(args.port ?? 5388), url = args.url ?? `http://127.0.0.1:${port}`;
const server = args.url ? null : await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio'] });
const report = { scenarios: [], errors: [], external: [] };
try {
  for (const scenario of args.scenario ? [args.scenario] : ['arch', 'roof', 'hidden', 'search', 'search-move']) {
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
    await waitForGame(page, { timeout: 120000 });
    await page.addScriptTag({ content: `window.__observeFriendlyDamage = ${observeFriendlyDamage.toString()};` });
    const setup = await page.evaluate(async scenario => {
      const e = window.__ENGINE__, ctx = e.ctx, ai = ctx.get('ai'), p = ctx.get('player'), phys = ctx.get('physics');
      for (const a of ai.agents) a.dispose();
      ai.agents.length = 0; ai.squads.length = 0;
      const feet = p.position.clone().fromArray(scenario === 'arch' ? [-26.271, .1, -36.203]
        : scenario === 'hidden' ? [-13.225, 6.505, -5.844] : [-5.65, 6.505, 8.512]);
      const from = feet.clone().fromArray(scenario === 'arch' ? [-9.469, .06, -14.73]
        : scenario === 'hidden' ? [-12, .074, -17.265]
          : scenario === 'search' ? [-18, .1, -25]
            : scenario === 'search-move' ? [10.419, .2, 24.284] : [-3.384, .091, -3.351]);
      p.teleport({ x: feet.x, y: feet.y + p.eyeHeight, z: feet.z }, Math.atan2(feet.x - from.x, feet.z - from.z));
      if (scenario === 'arch') p.movement.stanceWant = 'crouch';
      p.health.value = 10000; p.health.armour = 0;
      await window.__PUMP__(30);
      const yaw = Math.atan2(feet.x - from.x, feet.z - from.z) + (scenario === 'search' ? Math.PI : 0);
      const a = ai.spawn('vanguard', from, yaw); a.hasGrenade = false;
      const sq = ai.createSquad(); sq.add(a);
      const run = window.__OBSERVATION__ = { scenario, started: e.time.elapsed, shots: [], samples: [],
        firstVisible: null, firstShot: null, maxSolves: 0, aiMs: [], relocations: 0 };
      const chest = ai.playerPosition(feet.clone()), head = p.position.clone(); head.y += p.height - .12;
      const initial = { chestLOS: phys.lineOfSight(a.eye, chest, phys.MASK.SIGHT),
        headLOS: phys.lineOfSight(a.eye, head, phys.MASK.SIGHT), player: p.position.toArray(), actor: a.position.toArray() };
      if (scenario.startsWith('search')) {
        const origin = head.clone(); origin.y -= .15;
        ctx.events.emit('weapon:fire', { weapon: 'sniper', origin }); // real uncertain hearing, no visual grant
      }
      window.__observeFriendlyDamage(ctx.events, ai.agents, a.team, run);
      ctx.events.on('shot:resolved', shot => {
        if (shot.shooter !== a) return;
        const t = e.time.elapsed - run.started;
        run.firstShot ??= t;
        run.shots.push({ t, visible: a.targetVisible, acquired: a.hasTarget, kind: a.lastKnownKind, age: a.lastKnownAge,
          from: shot.from.toArray(), target: shot.target === p ? 'player' : typeof shot.target === 'string' ? shot.target : shot.target?.id ?? null });
      });
      const update = ai.update.bind(ai); let frame = 0;
      ai.update = (dt, context) => {
        const before = ai.grid.stats.queries, start = performance.now();
        update(dt, context); run.aiMs.push(performance.now() - start);
        run.maxSolves = Math.max(run.maxSolves, ai.grid.stats.queries - before);
        run.relocations = a.relocations;
        if (a.targetVisible && a.hasTarget) run.firstVisible ??= e.time.elapsed - run.started;
        if (frame++ % 12 === 0) run.samples.push({ t: e.time.elapsed - run.started, position: a.position.toArray(),
          visible: a.targetVisible, acquired: a.hasTarget, state: a.state, action: a.combatAction, block: a.fireBlock,
          observation: a._observationSearch ?? false, lastKnown: a.lastKnown.toArray(),
          goal: a.hasMoveTarget ? a.moveTarget.toArray() : null, failure: a.coverFailure });
      };
      const { meta } = await ctx.get('models').worldPrefetch;
      return { initial, provenance: ctx.get('telemetry').meta.provenance, assets: meta.assets };
    }, scenario);
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.ok(setup.provenance.revision.startsWith(revision), 'served revision must match checkout');
    if (args.clean) assert.equal(setup.provenance.revision, revision);
    assert.deepEqual(setup.assets, JSON.parse(readFileSync(new URL('../../public/models/world/level.json', import.meta.url))).assets);
    if (scenario === 'arch' || scenario === 'roof') {
      assert.equal(setup.initial.chestLOS, false, 'fixture must reproduce chest occlusion');
      assert.equal(setup.initial.headLOS, true, 'fixture must expose a real body sample');
    }
    const frames = scenario.startsWith('search') ? 1800 : scenario === 'hidden' ? 240 : 720;
    for (let i = 0; i < frames; i += 120) {
      await page.evaluate(() => window.__PUMP__(120));
      if (i === 0 && args.shot && scenario === 'arch') await captureNative(page, args.shot);
      if (i === 0 && args['roof-shot'] && scenario === 'roof') await captureNative(page, args['roof-shot']);
    }
    const run = await page.evaluate(() => {
      const { aiMs, ...run } = window.__OBSERVATION__;
      aiMs.sort((a, b) => a - b);
      return { ...run, aiMs: { p95: aiMs[Math.floor(aiMs.length * .95)], max: aiMs.at(-1) } };
    });
    report.scenarios.push({ setup, run });
    if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.log(scenario, JSON.stringify({ firstVisible: run.firstVisible, firstShot: run.firstShot, shots: run.shots.length,
      maxSolves: run.maxSolves, aiMs: run.aiMs }));
    assert.ok(run.maxSolves <= 2); assert.equal(run.relocations, 0);
    assert.ok(run.shots.every(s => s.target === null || s.target === 'player'), 'no friendly first impacts');
    assert.equal(run.friendlyHits, 0, 'no friendly damage events, including penetration');
    assert.equal(run.friendlyDamage, 0, 'no friendly damage');
    assert.ok(run.shots.every(s => s.acquired && (s.visible || (s.kind === 'visual' && s.age <= 1.2))), 'personal visual authorization');
    if (scenario === 'hidden') {
      assert.equal(run.shots.length, 0); assert.equal(run.firstVisible, null, 'no acquisition through a roof/wall');
    } else if (!args.baseline) {
      assert.ok(run.shots.length > 0, 'an exposed player must draw actual safe fire');
      if (!scenario.startsWith('search')) assert.ok(run.firstShot < 4, 'exposed-body acquisition must be timely');
      else assert.ok(run.samples.some(s => s.observation), 'unreachable evidence must select observation alternatives');
      if (scenario === 'search-move') {
        assert.equal(setup.initial.headLOS, false, 'must start without a visual lane');
        assert.ok(run.samples.some(s => Math.hypot(s.position[0] - setup.initial.actor[0], s.position[2] - setup.initial.actor[2]) > 1),
          'must physically move to a useful lane');
      }
    }
    await page.close();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []);
} finally {
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2));
  await browser.close(); stopViteServer(server);
}
