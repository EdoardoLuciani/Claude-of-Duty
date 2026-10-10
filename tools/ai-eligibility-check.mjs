#!/usr/bin/env node
// Same-seed reference/candidate replays; optional native re-execution is correctness-only.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, launchChromium, stopViteServer, parseArgs } from './lib/browser-harness.mjs';
import { waitForGame } from './lib/native-render.mjs';
import { combatLane } from './lib/combat-fixture.js';
import { createCombatProfile, validateCombatProfile } from './lib/profile-combat.js';
const args = parseArgs(), port = Number(args.port ?? 5432), frames = Number(args.frames ?? 1800);
const server = await ensureViteServer({ port }); assert(server, 'choose an unused port');
let browser;
try {
  browser = await launchChromium({ headless: true, args: ['--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  const results = [];
  for (const mode of ['reference', 'candidate', 'oracle']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=high`); await waitForGame(page);
    await page.addScriptTag({ content: `window.__ELIGIBILITY_FIXTURE__ = { create: ${createCombatProfile.toString()}, lane: ${combatLane.toString()} };` });
    const result = await page.evaluate(async ({ mode, frames, negative, collisionControl }) => {
      const engine = window.__ENGINE__, ai = engine.ctx.get('ai'), renderer = engine.ctx.get('render').renderer;
      const api = window.__ELIGIBILITY_FIXTURE__, fixture = api.create(engine, api.lane);
      const nav = ai.grid, original = nav.canAttach, restores = [], states = []; let queries = 0, verified = 0;
      const { NAV_PROFILE } = await import('/src/ai/nav-format.ts');
      if (mode !== 'candidate') nav.canAttach = function (from, to, radius = NAV_PROFILE.radius, height = NAV_PROFILE.height, maxSteps = 80) {
        queries++;
        if (mode === 'reference') return this._checkAttachment(from, to, radius, height, maxSteps);
        const cached = original.call(this, from, to, radius, height, maxSteps);
        const native = this._checkAttachment(from, to, radius, height, maxSteps); verified++;
        if (cached !== native) throw new Error('cached eligibility differs from full native controller');
        return cached;
      };
      if (mode === 'reference') {
        const { TACTICS } = await import('/src/ai/tuning.ts');
        const { SEARCH_CANDIDATES } = await import('/src/ai/agent.js');
        for (const actor of ai.agents) {
          const original = actor._pickObservationPoints;
          let raw = original.toString();
          if (negative === 'reference') raw = raw.replace('if (local && !grid.lineOfWalk', 'if ( local && !grid.lineOfWalk');
          const source = raw.replace('if (failed) continue;', 'if (failed || (local && !grid.lineOfWalk(this.position, p))) continue;')
            .replace(/\n\s*if \(local && !grid.lineOfWalk\(this.position, p\)\) continue;/, '');
          if (!source.includes('failed || (local') || source.match(/grid\.lineOfWalk\(this\.position, p\)/g)?.length !== 1)
            throw new Error('reference observation source did not match exactly one walk check');
          actor._pickObservationPoints = new Function('TACTICS', 'SEARCH_CANDIDATES', 'return function ' + source)(TACTICS, SEARCH_CANDIDATES);
          restores.push(() => { delete actor._pickObservationPoints; });
        }
      }
      // Negative control: stale cached false must not survive a collision rebuild.
      const nativeCheck = nav._checkAttachment;
      if (collisionControl && mode === 'candidate') {
        if (negative) {
          const source = original.toString().replace('cfg[0] !== world.version', 'false');
          if (source === original.toString()) throw new Error('version-invalidation mutation did not match');
          nav.canAttach = new Function('NAV_PROFILE', 'ATTACHMENT_CACHE_SIZE', 'ATTACHMENT_KEY_SIZE', 'return function ' + source)(NAV_PROFILE, 64, 9);
        }
        const version = nav.physics.staticWorld.version;
        nav._checkAttachment = function () { return this.physics.staticWorld.version !== version; };
        const p = ai.agents[0].position.clone(); nav.canAttach(p, p);
        nav.physics.rebuildStatic();
        if (!nav.canAttach(p, p)) throw new Error('collision rebuild retained stale failed eligibility');
        nav._checkAttachment = nativeCheck;
      }
      const counters = () => Object.freeze({ calls: renderer.info.render.calls, draws: renderer.info.render.drawCalls });
      const beforeBuilds = window.__NATIVE_BUILDS__;
      try {
        for (let i = -120; i < frames; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve)); fixture.before(i);
          const before = counters();
          engine.step(); fixture.after();
          const after = counters();
          if (i >= 0) states.push({ calls: after.calls - before.calls, draws: after.draws - before.draws,
            actors: ai.agents.map(a => [a.id, a.state, a.combatAction, a.position.toArray(), a.yaw, a.health,
              a.wantFire, a.hasMoveTarget, a.moveTarget.toArray(), a.pathPending, a.pathOutcome, a.pathReason,
              a.path.slice(0, a.pathLen).map(p => p.toArray()), a.cover && [a.cover.x, a.cover.y, a.cover.z, a.cover.claimed]]) });
        }
      } finally { nav.canAttach = original; for (const restore of restores) restore(); fixture.dispose(); }
      return { mode, states, combat: fixture.report, queries, verified, cacheHits: nav.stats.attachmentCacheHits,
        builders: window.__NATIVE_BUILDS__ - beforeBuilds };
    }, { mode, frames, negative: args.negative ?? null, collisionControl: !!args['collision-control'] || !!args.negative });
    assert.deepEqual(errors, []); validateCombatProfile(result.combat); assert.equal(result.builders, 0);
    assert(result.states.every(s => s.calls > 0 && s.draws > 0), 'every measured renderer counter window must advance');
    results.push(result); await page.evaluate(() => window.__ENGINE__.dispose()); await page.close();
  }
  for (const result of results.slice(1)) {
    assert.deepEqual(result.combat, results[0].combat, `${result.mode}: combat event totals`);
    assert.deepEqual(result.states, results[0].states, `${result.mode}: every AI state and call/draw record`);
  }
  assert(results[1].cacheHits > 0, 'real fixture must exercise failed-check reuse');
  assert(results[2].verified > 0, 'native oracle must actually execute');
  const summary = results.map(({ states, ...rest }) => ({ ...rest, comparedFrames: states.length,
    renderCalls: states.reduce((n, s) => n + s.calls, 0), draws: states.reduce((n, s) => n + s.draws, 0) }));
  writeFileSync(String(args.out ?? '/tmp/ai-eligibility-check.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally { try { await browser?.close(); } finally { stopViteServer(server); } }
