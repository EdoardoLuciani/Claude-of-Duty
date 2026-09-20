/**
 * Headless regressions for issue 277: last-enemy search assist.
 *
 *   node tools/smoke-search-assist.mjs
 */
import assert from 'node:assert/strict';
import { GameSystem } from '../src/game/index.js';
import {
  SEARCH_ASSIST, SEARCH_SECTORS,
  collectSearchHint, createSearchState, resetSearchState,
  sectorBearing, sectorLabel, tickSearchAssist,
} from '../src/game/search-assist.js';

function agent(partial = {}) {
  return {
    alive: true, staged: false, silentDeath: false, team: 1,
    lastSeen: -Infinity, lastFired: -Infinity,
    lastKnown: { x: 1, y: 0, z: 2 }, lastKnownAge: 40,
    pathOutcome: 'success',
    position: { x: 0, y: 0, z: -20 },
    ...partial,
  };
}

function hintOf(agents, now = 0, origin = { x: 0, z: 0 }) {
  return collectSearchHint(now, agents, origin, {
    remaining: 0, contact: false, dx: 0, dz: 0,
  });
}

/* ---- sector snap --------------------------------------------------------- */
{
  assert.equal(SEARCH_ASSIST.sectorDeg, 45);
  assert.equal(SEARCH_SECTORS.length, 8);
  assert.equal(sectorBearing(0, -10), 0);
  assert.equal(sectorLabel(0), 'N');
  assert.equal(sectorBearing(10, 0), 90);
  assert.equal(sectorLabel(90), 'E');
  assert.equal(sectorBearing(0, 10), 180);
  assert.equal(sectorLabel(180), 'S');
  assert.equal(sectorBearing(-10, 0), 270);
  assert.equal(sectorLabel(270), 'W');
  assert.equal(sectorBearing(10, -10), 45);
  assert.equal(sectorLabel(45), 'NE');
  assert.equal(sectorBearing(1, -10), 0, 'small offset stays in the north sector');
  assert.equal(sectorBearing(0, 0), 0);
}

/* ---- contact / remaining collection -------------------------------------- */
{
  const origin = { x: 0, z: 0 };
  const quiet = agent({ position: { x: 8, y: 0, z: -4 } });
  const h = hintOf([quiet], 10, origin);
  assert.equal(h.remaining, 1);
  assert.equal(h.contact, false);
  assert.equal(h.dx, 8);
  assert.equal(h.dz, -4);

  const seen = agent({ lastSeen: 9.5, position: { x: 4, y: 0, z: 0 } });
  assert.equal(hintOf([seen], 10, origin).contact, true, 'LOS grace is contact');
  const staleSeen = agent({ lastSeen: 7.9, position: { x: 4, y: 0, z: 0 } });
  assert.equal(hintOf([staleSeen], 10, origin).contact, false, 'LOS grace has ended');

  const fired = agent({ lastFired: 8, position: { x: 4, y: 0, z: 0 } });
  assert.equal(hintOf([fired], 10, origin).contact, true, 'recent muzzle flash is contact');
  const staleFired = agent({ lastFired: 6.9, position: { x: 4, y: 0, z: 0 } });
  assert.equal(hintOf([staleFired], 10, origin).contact, false);

  const skip = [
    agent({ alive: false }),
    agent({ staged: true }),
    agent({ silentDeath: true }),
    agent({ team: 0 }),
    quiet,
  ];
  assert.equal(hintOf(skip, 10, origin).remaining, 1, 'only real wave enemies count');
}

/* ---- trigger / reset / pause --------------------------------------------- */
{
  const Q = SEARCH_ASSIST.quietSeconds;
  const R = SEARCH_ASSIST.repeatSeconds;
  const state = createSearchState();
  const quiet = { remaining: 1, contact: false, dx: 0, dz: -12 };

  assert.equal(tickSearchAssist(state, quiet, 0), null, 'arms on first quiet sample');
  assert.equal(state.quietSince, 0);
  assert.equal(tickSearchAssist(state, quiet, Q - 0.01), null, 'no cue before the quiet window');
  const cue = tickSearchAssist(state, quiet, Q);
  assert.ok(cue, 'reachable quiet survivor cues after the window');
  assert.equal(cue.bearing, 0);
  assert.equal(cue.sector, 'N');
  assert.equal(cue.remaining, 1);
  assert.equal('x' in cue, false, 'payload has no exact position');
  assert.equal('z' in cue, false);

  assert.equal(tickSearchAssist(state, quiet, Q + R - 0.01), null, 'repeat cadence holds');
  const again = tickSearchAssist(state, quiet, Q + R);
  assert.ok(again, 'repeats while still quiet');
  assert.equal(again.sector, 'N');

  const frozen = createSearchState();
  tickSearchAssist(frozen, quiet, 10);
  assert.equal(tickSearchAssist(frozen, quiet, 10), null, 'paused elapsed time does not cue');
  assert.equal(frozen.quietSince, 10);

  const combat = createSearchState();
  const many = { remaining: 6, contact: false, dx: 4, dz: -4 };
  assert.equal(tickSearchAssist(combat, many, 0), null);
  assert.equal(tickSearchAssist(combat, many, Q + 40), null, 'no cue during multi-enemy combat');
  assert.equal(combat.quietSince, -1);

  const live = createSearchState();
  const spotted = { remaining: 1, contact: true, dx: 4, dz: -4 };
  tickSearchAssist(live, quiet, 0);
  assert.equal(tickSearchAssist(live, spotted, 12), null, 'contact clears an armed timer');
  assert.equal(live.quietSince, -1);

  const drop = createSearchState();
  tickSearchAssist(drop, { remaining: 2, contact: false, dx: 1, dz: -8 }, 0);
  const still = tickSearchAssist(drop, { remaining: 1, contact: false, dx: 1, dz: -8 }, Q);
  assert.ok(still, '2→1 without contact keeps the quiet timer');

  const empty = createSearchState();
  tickSearchAssist(empty, quiet, 0);
  assert.equal(tickSearchAssist(empty, { remaining: 0, contact: false, dx: 0, dz: 0 }, Q), null);
  assert.equal(empty.quietSince, -1);
}

/* ---- navigation-invalid survivor is not auto-killed ---------------------- */
{
  const stranded = agent({
    pathOutcome: 'unreachable',
    position: { x: 22.6, y: 0.42, z: 46.1 },
  });
  const known = { ...stranded.lastKnown };
  const h = hintOf([stranded], 0, { x: 0, z: 0 });
  const state = createSearchState();
  tickSearchAssist(state, h, 0);
  const cue = tickSearchAssist(state, h, SEARCH_ASSIST.quietSeconds);
  assert.ok(cue, 'stranded quiet survivor still gets a coarse sector');
  assert.equal(cue.sector, sectorLabel(sectorBearing(22.6, 46.1)));
  assert.equal(stranded.alive, true, 'must not kill a healthy stranded actor');
  assert.equal(stranded.pathOutcome, 'unreachable');
  assert.equal(stranded.lastKnown.x, known.x, 'must not write player coords into AI evidence');
  assert.equal(stranded.lastKnown.z, known.z);
  assert.equal(stranded.lastKnownAge, 40);
}

/* ---- GameSystem wiring: trigger, pause, reset ---------------------------- */
{
  const events = [];
  const listeners = new Map();
  const player = { dead: false, position: { x: 0, y: 1, z: 0 } };
  const quiet = agent({
    position: { x: 0, y: 0.4, z: -30 },
    lastKnown: { x: 9, y: 0, z: 9 },
    lastKnownAge: 12,
    pathOutcome: 'success',
  });
  const crowd = [
    agent({ position: { x: 4, y: 0, z: -8 } }),
    agent({ position: { x: -6, y: 0, z: -12 } }),
    agent({ position: { x: 10, y: 0, z: 4 } }),
    agent({ position: { x: -2, y: 0, z: 14 } }),
    agent({ position: { x: 8, y: 0, z: 10 } }),
    agent({ position: { x: -12, y: 0, z: -4 } }),
  ];
  const ai = {
    agents: crowd,
    getWaveState() { return { number: 4, remaining: this.agents.filter((a) => a.alive).length, total: 6, incoming: false, nextIn: 0 }; },
  };
  const ctx = {
    config: { deterministic: false },
    time: { elapsed: 0, scale: 1, dt: 1 / 60 },
    camera: { position: { x: 0, y: 1.6, z: 0 } },
    peek: (id) => (id === 'player' ? player : null),
    get: (id) => (id === 'ai' ? ai : null),
    events: {
      on(type, fn) {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
        return () => {};
      },
      emit(type, payload) {
        events.push({ type, payload });
        for (const fn of listeners.get(type) ?? []) fn(payload);
      },
    },
  };

  const game = new GameSystem();
  await game.init(ctx);

  const Q = SEARCH_ASSIST.quietSeconds;
  const pump = (elapsed, extra = {}) => {
    Object.assign(ctx.time, extra);
    ctx.time.elapsed = elapsed;
    game.update(ctx.time.dt, ctx);
  };
  const searches = () => events.filter((e) => e.type === 'hud:search');

  pump(Q + 5);
  assert.equal(searches().length, 0, 'six living enemies never cue');

  ai.agents = [quiet];
  pump(0);
  pump(Q - 1);
  assert.equal(searches().length, 0, 'quiet window has not elapsed');
  pump(Q);
  assert.equal(searches().length, 1, 'reachable quiet survivor cues');
  assert.equal(searches()[0].payload.sector, 'N');
  assert.equal(searches()[0].payload.remaining, 1);
  assert.equal(quiet.alive, true);
  assert.equal(quiet.lastKnown.x, 9, 'cue must not retarget AI lastKnown');
  assert.equal(quiet.lastKnownAge, 12);

  // Pause / shop: elapsed frozen, wall-clock would have passed the repeat.
  const n = searches().length;
  ctx.time.scale = 0;
  ctx.time.dt = 0;
  pump(Q, { scale: 0, dt: 0 });
  pump(Q, { scale: 0, dt: 0 });
  assert.equal(searches().length, n, 'paused elapsed time does not re-cue');
  ctx.time.scale = 1;
  ctx.time.dt = 1 / 60;

  events.length = 0;
  ctx.events.emit('game:restart', { source: 'test' });
  pump(Q + 1);
  assert.equal(searches().length, 0, 'restart clears the quiet timer');

  pump(0);
  events.length = 0;
  ctx.events.emit('wave:start', { wave: 5, enemies: 8 });
  pump(Q);
  assert.equal(searches().length, 0, 'wave start clears the quiet timer');

  pump(0);
  events.length = 0;
  ctx.events.emit('wave:complete', { wave: 4, nextWave: 5, delay: 20 });
  pump(Q);
  assert.equal(searches().length, 0, 'wave complete clears the quiet timer');

  pump(0);
  events.length = 0;
  ctx.events.emit('player:death', { position: player.position, amount: 100 });
  player.dead = true;
  pump(Q);
  assert.equal(searches().length, 0, 'death clears and blocks the cue');
  player.dead = false;
  events.length = 0;
  pump(Q);
  assert.equal(searches().length, 0, 'respawn does not inherit the pre-death timer');
  pump(Q + Q);
  assert.equal(searches().length, 1, 'a fresh quiet window after respawn can still cue');

  const stranded = agent({
    pathOutcome: 'invalid',
    position: { x: 21.9, y: 0.42, z: 45.1 },
    lastKnown: { x: 3, y: 0, z: 3 },
  });
  ai.agents = [stranded];
  resetSearchState(game._search);
  events.length = 0;
  pump(0);
  pump(Q);
  assert.equal(searches().length, 1, 'navigation-invalid survivor still gets a sector');
  assert.equal(stranded.alive, true, 'invalid survivor is not culled');
  assert.equal(stranded.lastKnown.x, 3);
  assert.equal(searches()[0].payload.x, undefined);

  ctx.config.deterministic = true;
  resetSearchState(game._search);
  events.length = 0;
  pump(0);
  pump(Q);
  assert.equal(searches().length, 0, 'deterministic captures skip the cue');

  game.dispose();
}

console.log('  ok  last-enemy search assist');
