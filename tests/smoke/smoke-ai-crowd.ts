import assert from 'node:assert/strict';

import type { Vector3 } from 'three';

import { bakePhysicsNav } from '#worldgen/nav-bake';

import { SurfaceNav } from '../../src/ai/nav.ts';
import { makeAi } from '../../tools/lib/agent-fixture.ts';
import { synthetic, vec } from '../../tools/nav240/fixtures.ts';
import { makeWalker, WalkerAgent } from '../../tools/nav240/harness.ts';

const source = synthetic(),
  bake = await bakePhysicsNav(source.physics, source.bounds);
const f = { ...source, grid: await SurfaceNav.load(bake.buffer, source.physics) };
const ai = makeAi(f.grid);
ai._pathBudget = 0;
ai.groundAt = (x, z, y): number => f.physics.groundHeight(x, z, y);
let frame = 0;
const first: (number | null)[] = Array.from({ length: 4 }, (): null => null);
const request = ai.requestPath.bind(ai);
ai.requestPath = (...args): number => {
  const n = request(...args);
  const actor = args[3];
  assert(actor);
  if (n >= 0 && first[actor.id] === null) first[actor.id] = frame;
  return n;
};
const goals: Vector3[] = [];
const reached = new Array<boolean>(4).fill(false);
for (let i = 0; i < 4; i++) {
  const a = makeWalker(f, null, vec([i % 2 ? 4.6 : 3.4, 0, i < 2 ? -4.4 : -5.5]), i);
  a.ai = ai;
  ai.agents.push(a);
  goals.push(vec([i % 2 ? 4.8 : 3.2, 3.04, i < 2 ? 2.7 : 1.8]));
  a._goTo(goals[i]);
}
for (; frame < 5400 && !reached.every(Boolean); frame++) {
  ai._pathBudget = 2;
  const queries = f.grid.stats.queries;
  ai._servePendingPaths();
  for (const a of ai.agents) {
    assert(a instanceof WalkerAgent);
    a._move(1 / 60);
    a._tickNoProgress(1 / 60);
    if (!a.hasMoveTarget && !a.pathPending) a.desiredSpeed = 0;
    if (a.position.distanceTo(goals[a.id]) < 0.5 && Math.abs(a.position.y - goals[a.id].y) <= 0.18)
      reached[a.id] = true;
    assert.equal(a.recoveries.length, 0, 'crowded stairs must not require teleporting');
  }
  assert.ok(f.grid.stats.queries - queries <= 2, 'recovery cannot bypass the shared solve budget');
}
assert.deepEqual(first, [0, 0, 1, 1]);
assert.ok(
  reached.every(Boolean),
  `crowded stair arrivals: ${String(reached)}; positions ${String(ai.agents.map((a): [number, number, number] => a.position.toArray()))}`
);
for (const a of ai.agents) {
  assert(a.controller);
  f.physics.removeCharacter(a.controller);
}

// Actors on vertically separated surfaces must not repel each other in X/Z.
const lower = makeWalker(f, null, vec([-4, 0, -2]), 10);
const upper = makeWalker(f, null, vec([-3.8, 3.15, -2]), 11);
lower.ai.agents.push(upper);
lower._move(1 / 60);
assert.equal(lower._steer.lengthSq(), 0, 'upper-storey actor cannot steer the ground actor');
f.physics.removeCharacter(lower.controller);
f.physics.removeCharacter(upper.controller);
f.grid.dispose();
console.log(
  'ok  four physical stair arrivals with crowd avoidance and two fair solves/frame; stacked-floor separation'
);
