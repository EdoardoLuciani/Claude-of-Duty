import { writeFileSync, mkdirSync } from 'node:fs';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
  portOpen,
} from '../../../tools/lib/browser-harness.mjs';
import { waitForGame, captureNative } from '../../../tools/lib/native-render.mjs';
import { installObserver } from './observer.mjs';
const out = process.env.PROBE470_OUT ?? '/tmp/470-extended';
mkdirSync(out, { recursive: true });
const seeds = (process.env.PROBE470_SEEDS ?? '1592594996,4660,12648430').split(',').map(Number);
const cycles = Number(process.env.PROBE470_CYCLES ?? 4);
const movement = process.env.PROBE470_MOVEMENT ?? 'KeyW';
const initialWait = Number(process.env.PROBE470_INITIAL_WAIT_MS ?? 20000);
if (
  seeds.length > 3 ||
  seeds.some((s) => !Number.isInteger(s) || s < 0 || s > 0xffffffff) ||
  !Number.isInteger(cycles) ||
  cycles < 1 ||
  cycles > 4 ||
  !['KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(movement) ||
  !Number.isFinite(initialWait) ||
  initialWait < 0 ||
  initialWait > 20000
)
  throw Error('invalid bounded probe settings');
if (await portOpen(5476)) throw Error('port already occupied');
const server = await ensureViteServer({ port: 5476 });
const browser = await launchChromium({ headless: true, args: ['--mute-audio'] });
const results = {
  runtimeSourceBase: 'c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592',
  browser: browser.version(),
  url: '?q=high',
  viewport: [1280, 720],
  movement,
  initialWait,
  cycles,
  sessions: [],
  errors: [],
};
const flush = () => writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
try {
  for (const [session, seed] of seeds.entries()) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }),
      page = await context.newPage();
    const r = { session, seed, cycles: [], routes: { engine: 0, ai: 0, main: 0 }, errors: [] };
    results.sessions.push(r);
    page.on('pageerror', (e) => r.errors.push(e.message));
    await page.addInitScript(() => (window.__ORIGINS__ = []));
    async function replace(route, marker, replacement, key) {
      const response = await route.fetch();
      const body = await response.text();
      if (body.split(marker).length !== 2) throw Error(key + ' marker count');
      r.routes[key]++;
      let observed = body.replace(marker, replacement);
      if (key === 'ai') {
        const anchorMarker =
          'const anchors = pickSquadAnchors(ranked, player, Math.min(squads, ranked.length));';
        if (observed.split(anchorMarker).length !== 2) throw Error('anchor marker count');
        observed = observed.replace(
          anchorMarker,
          anchorMarker +
            `
{const origin=window.__ORIGINS__.at(-1),p=this.ctx.get('player'),fresh=p.position.clone();fresh.y+=Math.max(0.32,Math.min(p.height-0.22,p.height*0.62));const freshRanked=spawns.map((s,i)=>({s,i,d:s.position.distanceTo(fresh)})).sort((a,b)=>b.d-a.d).filter(e=>e.d>18);origin.anchorIndices=anchors.map(a=>a.i);origin.resetAnchorIndices=pickSquadAnchors(freshRanked,fresh,Math.min(squads,freshRanked.length)).map(a=>a.i);}`
        );
      }
      await route.fulfill({ response, body: observed });
    }
    await page.route('**/src/core/engine.ts', (route) =>
      replace(route, 'Math.random() * 2 ** 32 >>> 0', String(seed), 'engine')
    );
    await page.route('**/src/ai/index.ts', (route) =>
      replace(
        route,
        'const player = this.playerPosition(this._v3).clone();',
        `const player = this.playerPosition(this._v3).clone();
 {const p=this.ctx.get('player'), c=p.hitbox;window.__ORIGINS__.push({generation:window.__PROBE__?.generation??0,frame:this.ctx.time.frame,t:this.ctx.time.elapsed,wall:performance.now()/1000,feet:p.position.toArray(),sample:player.toArray(),hitbox:{enabled:c.enabled,a:[c.ax,c.ay,c.az],b:[c.bx,c.by,c.bz]}});}`,
        'ai'
      )
    );
    await page.route('**/src/main.ts', (route) =>
      replace(
        route,
        'engine.start();',
        '(' + installObserver.toString() + ')(engine);\nengine.start();',
        'main'
      )
    );
    await page.goto('http://127.0.0.1:5476/?q=high');
    r.device = await waitForGame(page);
    r.ready = await page.evaluate(() => ({
      revision: window.__BUILD_REVISION__,
      deterministic: window.__ENGINE__.ctx.config.deterministic,
      prewarm: window.__PREWARM__.ok,
    }));
    console.log('ready', session, seed, r.ready);
    await page.waitForTimeout(initialWait);
    await page.locator('#game').click({ position: { x: 640, y: 360 } });
    async function move() {
      await page.keyboard.down(movement);
      await page.waitForTimeout(8000);
      await page.keyboard.up(movement);
    }
    async function capture(label) {
      const before = await page.evaluate(() => window.__SNAP470__('capture-before'));
      await captureNative(page, out + '/' + label + '.jpg', { type: 'jpeg', quality: 82 });
      const after = await page.evaluate(() => window.__SNAP470__('capture-after'));
      r.captures ??= [];
      r.captures.push({
        file: label + '.jpg',
        before: { frame: before.frame, t: before.t, wall: before.wall },
        after: { frame: after.frame, t: after.t, wall: after.wall },
      });
    }
    await move();
    for (let cycle = 0; cycle < cycles; cycle++) {
      const c = { cycle, restartDelay: [0, 5, 12, 0][cycle], natural: true };
      r.cycles.push(c);
      try {
        await page.waitForFunction(() => window.__ENGINE__.ctx.get('player').dead, null, {
          timeout: 90000,
        });
      } catch {
        c.blocker = 'No natural death within 90 s after movement; no forced death';
        r.trace = await page.evaluate(() => {
          const p = { ...window.__PROBE__ };
          delete p.publication;
          return p;
        });
        flush();
        break;
      }
      c.deathSeen = await page.evaluate(() => window.__SNAP470__('death-observed'));
      if (session === 0 && cycle === 0) await capture('s0-death');
      await page.waitForFunction(
        () => {
          const g = window.__ENGINE__.ctx.get('ui').gameOver;
          return g.active && g.elapsed >= g.delay;
        },
        null,
        { polling: 10 }
      );
      c.enabledObservation = await page.evaluate(() => ({
        wall: performance.now() / 1000,
        frame: window.__ENGINE__.time.frame,
        elapsed: window.__ENGINE__.ctx.get('ui').gameOver.elapsed,
      }));
      if (c.restartDelay) await page.waitForTimeout(c.restartDelay * 1000);
      await page.keyboard.press('Enter');
      await page.waitForFunction((n) => window.__PROBE__.generation === n, cycle + 1);
      c.post = await page.evaluate(() => window.__SNAP470__('post-key'));
      await capture('s' + session + '-restart' + (cycle + 1));
      await page.waitForTimeout(1000);
      if (cycle === cycles - 1) await page.waitForTimeout(5000);
      r.trace = await page.evaluate(() => {
        const p = { ...window.__PROBE__ };
        delete p.publication;
        return p;
      });
      flush();
      console.log(
        'cycle',
        session,
        cycle,
        'origin',
        r.trace.placements.at(-1),
        'resetvisible',
        r.trace.events
          .filter((e) => e.type === 'first-render')
          .at(-1)
          .agents.filter((a) => a.eyeInFrustum && a.los)
          .map((a) => ({ id: a.id, d: a.distance, b: a.bearing, screen: a.screen }))
      );
    }
    await context.close();
    flush();
    if (r.errors.length) throw Error(r.errors.join('; '));
  }
} catch (e) {
  results.errors.push(e.stack);
  console.error(e);
  process.exitCode = 1;
} finally {
  flush();
  await browser.close();
  stopViteServer(server);
}
