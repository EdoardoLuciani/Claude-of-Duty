/**
 * Headless regressions for issue 277: last-enemy search assist.
 *
 *   node tools/smoke-search-assist.mjs
 */
import assert from 'node:assert/strict';
import { GameSystem } from '../src/game/index.js';
import {
  SEARCH_ASSIST, resetSearchState, sectorBearing, sectorLabel, tickSearchAssist,
} from '../src/game/search-assist.js';

const ORIGIN = { x: 0, z: 0 };
const Q = SEARCH_ASSIST.quietSeconds;
const R = SEARCH_ASSIST.repeatSeconds;

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

function fresh() {
  return { quietSince: -1, lastCueAt: -1 };
}

function tick(state, now, agents, origin = ORIGIN) {
  return tickSearchAssist(state, now, agents, origin);
}

/* ---- sector snap --------------------------------------------------------- */
{
  const cases = [
    [0, -10, 0, 'N'],
    [10, 0, 90, 'E'],
    [0, 10, 180, 'S'],
    [-10, 0, 270, 'W'],
    [10, -10, 45, 'NE'],
    [1, -10, 0, 'N'],
    [0, 0, 0, 'N'],
  ];
  for (const [dx, dz, deg, name] of cases) {
    assert.equal(sectorBearing(dx, dz), deg, `${name} bearing`);
    assert.equal(sectorLabel(deg), name);
  }
}

/* ---- trigger / contact / pause ------------------------------------------- */
{
  const north = [agent({ position: { x: 0, y: 0, z: -12 } })];
  const s = fresh();
  assert.equal(tick(s, 0, north), null);
  assert.equal(s.quietSince, 0);
  assert.equal(tick(s, Q - 0.01, north), null);
  const cue = tick(s, Q, north);
  assert.ok(cue, 'reachable quiet survivor cues after the window');
  assert.equal(cue.bearing, 0);
  assert.equal(cue.sector, 'N');
  assert.equal(cue.remaining, 1);
  assert.equal(cue.x, undefined, 'payload has no exact position');

  assert.equal(tick(s, Q + R - 0.01, north), null);
  assert.equal(tick(s, Q + R, north).sector, 'N');

  const frozen = fresh();
  tick(frozen, 10, north);
  assert.equal(tick(frozen, 10, north), null, 'paused elapsed time does not cue');

  const crowd = Array.from({ length: 6 }, (_, i) => agent({ position: { x: i, y: 0, z: -8 } }));
  const combat = fresh();
  assert.equal(tick(combat, Q + 40, crowd), null, 'no cue during multi-enemy combat');

  const live = fresh();
  assert.equal(tick(live, 10, [agent({ lastSeen: 9.5 })]), null);
  assert.equal(live.quietSince, -1, 'LOS grace is contact');
  const stale = fresh();
  assert.equal(tick(stale, 10, [agent({ lastSeen: 7.9 })]), null);
  assert.equal(stale.quietSince, 10, 'LOS grace has ended');
  const fired = fresh();
  assert.equal(tick(fired, 10, [agent({ lastFired: 8 })]), null);
  assert.equal(fired.quietSince, -1, 'muzzle flash is contact');

  assert.equal(
    tick(fresh(), 10, [
      agent({ alive: false }), agent({ staged: true }),
      agent({ silentDeath: true }), agent({ team: 0 }),
    ]),
    null,
    'non-wave actors do not arm the timer',
  );

  const drop = fresh();
  tick(drop, 0, [agent(), agent({ position: { x: 2, y: 0, z: -8 } })]);
  assert.ok(tick(drop, Q, north), '2→1 without contact keeps the quiet timer');
}

/* ---- stranded survivor is not auto-killed -------------------------------- */
{
  const stranded = agent({
    pathOutcome: 'unreachable',
    position: { x: 22.6, y: 0.42, z: 46.1 },
  });
  const known = { ...stranded.lastKnown };
  const s = fresh();
  tick(s, 0, [stranded]);
  const cue = tick(s, Q, [stranded]);
  assert.ok(cue, 'stranded quiet survivor still gets a coarse sector');
  assert.equal(cue.sector, sectorLabel(sectorBearing(22.6, 46.1)));
  assert.equal(stranded.alive, true);
  assert.equal(stranded.pathOutcome, 'unreachable');
  assert.equal(stranded.lastKnown.x, known.x);
  assert.equal(stranded.lastKnownAge, 40);
}

/* ---- GameSystem wiring --------------------------------------------------- */
{
  const events = [];
  const listeners = new Map();
  const player = { dead: false, position: { x: 0, y: 1, z: 0 } };
  const quiet = agent({
    position: { x: 0, y: 0.4, z: -30 },
    lastKnown: { x: 9, y: 0, z: 9 },
    lastKnownAge: 12,
  });
  const ai = { agents: Array.from({ length: 6 }, () => agent()) };
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
  const pump = (elapsed) => {
    ctx.time.elapsed = elapsed;
    game.update(ctx.time.dt, ctx);
  };
  const searches = () => events.filter((e) => e.type === 'hud:search');

  pump(Q + 5);
  assert.equal(searches().length, 0, 'six living enemies never cue');

  ai.agents = [quiet];
  pump(0);
  pump(Q - 1);
  assert.equal(searches().length, 0);
  pump(Q);
  assert.equal(searches().length, 1);
  assert.equal(searches()[0].payload.sector, 'N');
  assert.equal(quiet.alive, true);
  assert.equal(quiet.lastKnown.x, 9);
  assert.equal(quiet.lastKnownAge, 12);

  const n = searches().length;
  ctx.time.dt = 0;
  pump(Q);
  pump(Q);
  assert.equal(searches().length, n, 'paused elapsed time does not re-cue');
  ctx.time.dt = 1 / 60;

  events.length = 0;
  ctx.events.emit('game:restart', { source: 'test' });
  pump(Q + 1);
  assert.equal(searches().length, 0, 'restart clears the quiet timer');

  pump(0);
  events.length = 0;
  ai.agents = Array.from({ length: 6 }, () => agent());
  pump(Q);
  assert.equal(searches().length, 0, 'wave start (many remaining) clears the timer');

  ai.agents = [quiet];
  pump(0);
  events.length = 0;
  ai.agents = [];
  pump(Q);
  assert.equal(searches().length, 0, 'wave complete (none remaining) does not cue');

  ai.agents = [quiet];
  pump(0);
  events.length = 0;
  ctx.events.emit('player:death', { position: player.position, amount: 100 });
  player.dead = true;
  pump(Q);
  assert.equal(searches().length, 0, 'death clears and blocks the cue');
  player.dead = false;
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
  assert.equal(stranded.alive, true);
  assert.equal(stranded.lastKnown.x, 3);

  ctx.config.deterministic = true;
  resetSearchState(game._search);
  events.length = 0;
  pump(0);
  pump(Q);
  assert.equal(searches().length, 0, 'deterministic captures skip the cue');

  game.dispose();
}

console.log('  ok  last-enemy search assist');
