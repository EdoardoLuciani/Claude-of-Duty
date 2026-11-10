import assert from 'node:assert/strict';

/**
 * Headless regressions for issue 277: last-enemy search assist.
 *
 *   bun test ./tests/smoke/smoke-search-assist.ts
 */
import * as THREE from 'three';

import type { Agent } from '../../src/ai/agent.ts';
import { FIRE_TTL, LOS_GRACE } from '../../src/ai/contact.ts';
import type { EngineEventMap } from '../../src/core/events.ts';
import { GameSystem } from '../../src/game/index.ts';
import type { SearchCue, SearchState, SearchAgent } from '../../src/game/search-assist.ts';
import {
  SEARCH_ASSIST,
  resetSearchState,
  sectorBearing,
  sectorLabel,
  tickSearchAssist,
} from '../../src/game/search-assist.ts';
import { makeAgent, makeAi } from '../lib/agent-fixture.ts';
import { BrainPlayer } from '../lib/ai-brain-fixture.ts';
import { createTestContext } from '../lib/context.ts';

const ORIGIN = { x: 0, z: 0 };
const Q = SEARCH_ASSIST.quietSeconds;
const R = SEARCH_ASSIST.repeatSeconds;
assert.equal(SEARCH_ASSIST.seenWindow, LOS_GRACE);
assert.equal(SEARCH_ASSIST.firedWindow, FIRE_TTL);

interface SearchTestAgent extends SearchAgent {
  staged: boolean;
  silentDeath: boolean;
  lastKnown: { x: number; y: number; z: number };
  lastKnownAge: number;
  pathOutcome: string;
  position: { x: number; y: number; z: number };
}
function gameAgent(partial: Partial<SearchTestAgent> = {}): Agent {
  const data = agent(partial);
  return makeAgent({
    alive: data.alive,
    team: data.team,
    silentDeath: data.silentDeath,
    lastSeen: data.lastSeen,
    lastFired: data.lastFired,
    position: new THREE.Vector3(data.position.x, data.position.y, data.position.z),
    lastKnown: new THREE.Vector3(data.lastKnown.x, data.lastKnown.y, data.lastKnown.z),
    lastKnownAge: data.lastKnownAge,
    pathOutcome: data.pathOutcome,
  });
}

function agent(partial: Partial<SearchTestAgent> = {}): SearchTestAgent {
  return {
    alive: true,
    staged: false,
    silentDeath: false,
    team: 1,
    lastSeen: -Infinity,
    lastFired: -Infinity,
    lastKnown: { x: 1, y: 0, z: 2 },
    lastKnownAge: 40,
    pathOutcome: 'success',
    position: { x: 0, y: 0, z: -20 },
    ...partial,
  };
}

function fresh(): { quietSince: number; lastCueAt: number } {
  return { quietSince: -1, lastCueAt: -1 };
}

function tick(
  state: SearchState,
  now: number,
  agents: SearchAgent[],
  origin = ORIGIN
): SearchCue | null {
  return tickSearchAssist(state, now, agents, origin);
}

/* ---- sector snap --------------------------------------------------------- */
{
  const cases: Array<[number, number, number, string]> = [
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
  // Every finite bearing maps to one of the eight labels, including wrap and negatives.
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let deg = -720; deg <= 720; deg += 7.5)
    assert.ok(labels.includes(sectorLabel(deg)), `${deg} is labeled`);
  assert.equal(sectorLabel(359), 'N');
  assert.equal(sectorLabel(-45), 'NW');
  for (const bad of [NaN, Infinity, -Infinity])
    assert.throws(
      (): 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' => sectorLabel(bad),
      /non-finite bearing/
    );
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
  assert.equal('x' in cue ? cue.x : undefined, undefined, 'payload has no exact position');

  assert.equal(tick(s, Q + R - 0.01, north), null);
  const repeated = tick(s, Q + R, north);
  assert.ok(repeated);
  assert.equal(repeated.sector, 'N');

  const frozen = fresh();
  tick(frozen, 10, north);
  assert.equal(tick(frozen, 10, north), null, 'paused elapsed time does not cue');

  const crowd = Array.from({ length: 6 }, (_, i): SearchTestAgent =>
    agent({ position: { x: i, y: 0, z: -8 } })
  );
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
      agent({ alive: false }),
      agent({ staged: true }),
      agent({ silentDeath: true }),
      agent({ team: 0 }),
    ]),
    null,
    'non-wave actors do not arm the timer'
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
  type RecordedEvent =
    | { type: 'score:change'; payload: EngineEventMap['score:change'] }
    | { type: 'hud:search'; payload: EngineEventMap['hud:search'] };
  const events: RecordedEvent[] = [];
  const player = new BrainPlayer();
  player.position.set(0, 1, 0);
  const quiet = gameAgent({
    position: { x: 0, y: 0.4, z: -30 },
    lastKnown: { x: 9, y: 0, z: 9 },
    lastKnownAge: 12,
  });
  const wave = { number: 3, remaining: 6, total: 8, incoming: true, nextIn: 10 };
  const ai = makeAi();
  ai.agents = Array.from({ length: 6 }, (): Agent => gameAgent());
  ai.getWaveState = (): {
    number: number;
    remaining: number;
    total: number;
    incoming: boolean;
    nextIn: number;
  } => wave;
  const ctx = createTestContext({ providers: { player, ai } });
  ctx.config.deterministic = false;
  ctx.time.dt = 1 / 60;
  ctx.camera.position.set(0, 1.6, 0);
  ctx.events.on('score:change', (payload): number =>
    events.push({ type: 'score:change', payload })
  );
  ctx.events.on('hud:search', (payload): number => events.push({ type: 'hud:search', payload }));
  const game = new GameSystem();
  await game.init(ctx);
  assert.deepEqual(game.getHudState(), {
    score: 0,
    kills: 0,
    wave: wave.number,
    enemiesRemaining: wave.remaining,
    waveTotal: wave.total,
    waveIncoming: wave.incoming,
    nextWaveIn: wave.nextIn,
  });
  // Issue 608: AI-on-AI grenade kills must not award player score/shop credits.
  const kill = { target: gameAgent(), amount: 250, killed: true, explosion: true };
  for (const source of [gameAgent(), { team: 0 }, null, undefined]) {
    ctx.events.emit('damage:dealt', { ...kill, source });
    assert.equal(game.score, 0, 'non-player kills give no score');
    assert.equal(game.kills, 0, 'non-player kills give no kill credit');
  }
  assert.equal(events.filter((e): boolean => e.type === 'score:change').length, 0);
  for (const source of ['player', player, { isPlayer: true }]) {
    for (const headshot of [false, true]) {
      const score = game.score;
      const kills = game.kills;
      const points = headshot ? 150 : 100;
      ctx.events.emit('damage:dealt', { ...kill, source, headshot });
      assert.equal(game.score, score + points, 'player kills retain normal rewards');
      assert.equal(game.kills, kills + 1);
      assert.deepEqual(events.at(-1), {
        type: 'score:change',
        payload: {
          score: game.score,
          delta: points,
          reason: headshot ? 'headshot' : 'elimination',
          kills: game.kills,
        },
      });
    }
  }
  game.reset();
  events.length = 0;

  let t = 0;
  const pump = (dt = 0): void => {
    t += dt;
    ctx.time.elapsed = t;
    game.update(ctx.time.dt, ctx);
  };
  const count = (): number => events.filter((e): boolean => e.type === 'hud:search').length;
  const six = Array.from({ length: 6 }, (): Agent => gameAgent());

  ai.agents = [quiet];
  pump(0);
  ai.agents = six;
  pump(20);
  ai.agents = [quiet];
  pump(0);
  pump(10);
  assert.equal(count(), 0, 're-entering after 6 enemies does not inherit an old timer');
  pump(Q - 10);
  assert.equal(count(), 1, 'fresh quiet window after multi-enemy combat');
  const last = events.at(-1);
  assert.ok(last?.type === 'hud:search');
  assert.equal(last.payload.sector, 'N');
  assert.equal(quiet.alive, true);
  assert.equal(quiet.lastKnown.x, 9);
  assert.equal(quiet.lastKnownAge, 12);

  const paused = count();
  ctx.time.dt = 0;
  pump(0);
  pump(0);
  assert.equal(count(), paused, 'paused elapsed time does not re-cue');
  ctx.time.dt = 1 / 60;

  // Arm, restart at 29s: without reset a cue would fire at 30s.
  events.length = 0;
  ctx.events.emit('game:restart', { source: 'test' });
  pump(0);
  pump(Q - 1);
  ctx.events.emit('game:restart', { source: 'test' });
  pump(0);
  pump(1);
  assert.equal(count(), 0, 'restart at 29s blocks the cue that would have fired at 30');
  pump(Q - 1);
  assert.equal(count(), 1, 'fresh 30s window after restart');

  events.length = 0;
  ctx.events.emit('game:restart', { source: 'test' });
  pump(0);
  ai.agents = [];
  pump(20);
  ai.agents = [quiet];
  pump(0);
  pump(10);
  assert.equal(count(), 0, 're-entering after 0 remaining does not inherit the old timer');
  pump(Q - 10);
  assert.equal(count(), 1, 'fresh quiet window after wave complete');

  events.length = 0;
  ctx.events.emit('player:death', { position: player.position, from: null, amount: 100 });
  player.testDead = true;
  pump(Q - 1);
  assert.equal(count(), 0, 'death clears and blocks the cue');
  player.testDead = false;
  pump(0);
  pump(1);
  assert.equal(count(), 0, 'respawn does not inherit the pre-death timer');
  pump(Q - 1);
  assert.equal(count(), 1, 'a fresh quiet window after respawn can still cue');

  const stranded = gameAgent({
    pathOutcome: 'invalid',
    position: { x: 21.9, y: 0.42, z: 45.1 },
    lastKnown: { x: 3, y: 0, z: 3 },
  });
  ai.agents = [stranded];
  resetSearchState(game._search);
  events.length = 0;
  pump(0);
  pump(Q);
  assert.equal(count(), 1, 'navigation-invalid survivor still gets a sector');
  assert.equal(stranded.alive, true);
  assert.equal(stranded.lastKnown.x, 3);

  ctx.config.deterministic = true;
  resetSearchState(game._search);
  events.length = 0;
  pump(0);
  pump(Q);
  assert.equal(count(), 0, 'deterministic captures skip the cue');

  game.dispose();
}

console.log('  ok  last-enemy search assist');
