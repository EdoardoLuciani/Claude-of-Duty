import assert from 'node:assert/strict';
import { AiSystem } from '../src/ai/index.js';
import { SurfaceNav } from '../src/ai/nav.js';
import { bakePhysicsNav } from './worldgen/nav-bake.js';
import { synthetic, vec } from './nav240/fixtures.mjs';
import { makeWalker } from './nav240/harness.mjs';

const f = synthetic(), bake = await bakePhysicsNav(f.physics, f.bounds);
f.grid = await SurfaceNav.load(bake.buffer, f.physics);
const ai = Object.assign(Object.create(AiSystem.prototype), {
  grid: f.grid, agents: [], pathsPerFrame: 2, _pathBudget: 0,
  stats: { pathsDeferred: 0 }, groundAt: (x, z, y) => f.physics.groundHeight(x, z, y),
});
let frame = 0;
const first = new Array(4).fill(null), request = ai.requestPath.bind(ai);
ai.requestPath = (...args) => {
  const n = request(...args);
  if (n >= 0 && first[args[3].id] === null) first[args[3].id] = frame;
  return n;
};
const goals = [], reached = new Array(4).fill(false);
for (let i = 0; i < 4; i++) {
  const a = makeWalker(f, null, vec([i % 2 ? 4.6 : 3.4, 0, i < 2 ? -4.4 : -5.5]), i, true);
  a.ai = ai; ai.agents.push(a);
  goals.push(vec([i % 2 ? 4.8 : 3.2, 3.04, i < 2 ? 2.7 : 1.8]));
  a._goTo(goals[i]);
}
for (; frame < 5400 && !reached.every(Boolean); frame++) {
  ai._pathBudget = 2;
  const queries = f.grid.stats.queries;
  ai._servePendingPaths();
  for (const a of ai.agents) {
    a._move(1 / 60); a._tickNoProgress(1 / 60);
    if (!a.hasMoveTarget && !a.pathPending) a.desiredSpeed = 0;
    if (a.position.distanceTo(goals[a.id]) < .5 && Math.abs(a.position.y - goals[a.id].y) <= .18) reached[a.id] = true;
    assert.equal(a.recoveries.length, 0, 'crowded stairs must not require teleporting');
  }
  assert.ok(f.grid.stats.queries - queries <= 2, 'recovery cannot bypass the shared solve budget');
}
assert.deepEqual(first, [0, 0, 1, 1]);
assert.ok(reached.every(Boolean), `crowded stair arrivals: ${reached}; positions ${ai.agents.map(a => a.position.toArray())}`);
for (const a of ai.agents) f.physics.removeCharacter(a.controller);

// Actors on vertically separated surfaces must not repel each other in X/Z.
const lower = makeWalker(f, null, vec([-4, 0, -2]), 10, true);
const upper = makeWalker(f, null, vec([-3.8, 3.15, -2]), 11, true);
lower.ai.agents.push(upper);
lower._move(1 / 60);
assert.equal(lower._steer.lengthSq(), 0, 'upper-storey actor cannot steer the ground actor');
f.physics.removeCharacter(lower.controller); f.physics.removeCharacter(upper.controller);
f.grid.dispose();
console.log('ok  four physical stair arrivals with crowd avoidance and two fair solves/frame; stacked-floor separation');
