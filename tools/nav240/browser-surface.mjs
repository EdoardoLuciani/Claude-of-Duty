// Browser integration smoke, not #308's long-running wave-finishability gate.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, launchChromium, stopViteServer, parseArgs } from '../lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5193);
const url = args.url ?? `http://127.0.0.1:${port}`;
const server = args.url ? null : await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== new URL(url).origin) {
      external.push(route.request().url()); return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${url}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  const boot = await page.evaluate(async () => {
    const e = window.__ENGINE__, ai = e.ctx.get('ai');
    const { meta } = await e.ctx.get('models').worldPrefetch;
    const nav = ai.grid, player = e.ctx.get('player');
    player.health.value = 100000; player.setControlEnabled(false);
    const made = ai.populate({ squads: 3, perSquad: 4 });
    const state = window.__NAV_SMOKE__ = { frames: [], queries: [], first: {}, outcomes: {}, snaps: 0, frame: -1 };
    const request = ai.requestPath.bind(ai), update = ai.update.bind(ai), query = nav.findPath.bind(nav);
    nav.findPath = (...a) => {
      const t = performance.now(), n = query(...a);
      state.queries.push(performance.now() - t); return n;
    };
    ai.requestPath = (...a) => {
      const n = request(...a), actor = a[3];
      if (n >= 0 && actor && !(actor.id in state.first)) state.first[actor.id] = state.frame;
      if (n >= 0) state.outcomes[nav.lastReason] = (state.outcomes[nav.lastReason] ?? 0) + 1;
      return n;
    };
    ai.update = (dt, ctx) => {
      state.frame++;
      const q = nav.stats.queries, t = performance.now(); update(dt, ctx);
      state.frames.push({ ms: performance.now() - t, solves: nav.stats.queries - q });
    };
    ai._pathBudget = 0;
    for (const a of ai.agents) {
      const snap = a._snapUnstuck.bind(a);
      a._snapUnstuck = p => { state.snaps++; return snap(p); };
      a._goTo(a.patrolPoints[0]);
    }
    return { made, pathsPerFrame: ai.pathsPerFrame, navMs: ai.stats.navMs, stats: { ...nav.stats },
      components: new Set(nav.components.values()).size, covers: ai.cover.points.length,
      assets: meta.assets, sourceHash: meta.sourceHash, navigation: meta.navigation };
  });
  assert.equal(boot.made, 12); assert.equal(boot.pathsPerFrame, 2);
  await page.evaluate(() => window.__PUMP__(360));
  const run = await page.evaluate(() => {
    const ai = window.__ENGINE__.ctx.get('ai'), s = window.__NAV_SMOKE__;
    const dist = a => { a.sort((x, y) => x - y); return { p50: a[Math.floor(a.length / 2)], p95: a[Math.floor(a.length * .95)], max: a.at(-1) }; };
    return { frames: s.frames.length, maxSolves: Math.max(...s.frames.map(f => f.solves)),
      firstService: Object.values(s.first), aiUpdateMs: dist(s.frames.map(f => f.ms)), queryMs: dist(s.queries),
      outcomes: s.outcomes, recoveries: s.snaps, stats: ai.grid.stats, alive: ai.agents.filter(a => a.alive).length,
      gameJsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      resources: performance.getEntriesByType('resource').map(r => r.name).filter(n => n.includes('recast') || n.includes('level-nav')) };
  });
  await page.screenshot({ path: args.shot ?? '/tmp/nav306-browser.png' });
  const mode = run.resources.some(u => u.includes('/assets/recast-navigation.wasm-compat-')) ? 'production-bundle' : 'development';
  const report = { mode, boot, run, errors, external };
  writeFileSync(args.out ?? '/tmp/nav306-browser.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert.equal(run.maxSolves, 2); assert.equal(run.firstService.length, 12);
  assert.ok(Math.max(...run.firstService) <= 5, 'initial twelve requests must be served by frame five');
} finally { await browser.close(); stopViteServer(server); }
