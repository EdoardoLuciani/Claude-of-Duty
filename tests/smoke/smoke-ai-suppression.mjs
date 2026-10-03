#!/usr/bin/env node
/** Resolved rounds suppress once per agent even when flight segments interleave. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../../src/core/registry.js';
import { PhysicsSystem } from '../../src/physics/index.js';
import { AiSystem } from '../../src/ai/index.js';
import { ProjectileSim } from '../../src/weapons/ballistics.js';
import { WEAPON_DEFS } from '../../src/weapons/defs.js';
import { makeAgent } from '../../tools/lib/agent-fixture.mjs';

const v = (x = 0, y = 1, z = 0) => new THREE.Vector3(x, y, z);
for (const pellets of [1, 8, 96]) {
  const events = new EventBus(), phys = new PhysicsSystem();
  phys.ctx = { events };
  let calls = 0;
  const a = makeAgent({ position: v(5, 1, 1), eyeHeight: 0, suppress: () => calls++ });
  const ai = Object.assign(new AiSystem(), { agents: [a], ctx: { events } });
  ai._wireEvents(ai.ctx);
  const shooter = {}, sim = new ProjectileSim({ events, has: () => false,
    peek: id => id === 'physics' ? phys : shooter });
  const def = WEAPON_DEFS.shotgun;
  for (let i = 0; i < pellets; i++) sim.spawn({ origin: v(), dir: v(1, 0), shooter,
    speed: def.muzzleVelocity, dragK: def.dragK, maxRange: def.maxRange });
  for (let i = 0; i < 5; i++) sim.fixedUpdate(1 / 120);
  assert.equal(calls, pellets, `${pellets} interleaved rounds each suppress exactly once`);
  for (const off of ai._off) off();
  sim.clear();
}

{
  const events = new EventBus(), counts = [0, 0];
  const agents = counts.map((_, i) => makeAgent({ position: v(5, 1, 1), eyeHeight: 0,
    suppress: () => counts[i]++ }));
  const ai = Object.assign(new AiSystem(), { agents, ctx: { events } });
  ai._wireEvents(ai.ctx);
  const emit = (shot, from = v(), to = v(8), shooter = {}) =>
    events.emit('bullet:segment', { shot, from, to, shooter });
  // A, B, A, B: another round must not erase the first round's marker.
  for (const shot of [101, 102, 101, 102]) emit(shot);
  assert.deepEqual(counts, [2, 2], 'deduplication belongs to each receiver');
  emit(103, v(-10), v(-5));
  assert.deepEqual(counts, [2, 2], 'distant segments do not suppress or consume a history slot');
  emit(103);
  assert.deepEqual(counts, [3, 3], 'a later near segment of the same round still counts');
  agents[1].alive = false;
  emit(104, v(), v(8), agents[0]);
  assert.deepEqual(counts, [3, 3], 'self and dead receivers do not consume a history slot');
  agents[1].alive = true;
  emit(104);
  assert.deepEqual(counts, [4, 4]);
  for (const off of ai._off) off();
}
console.log('smoke-ai-suppression: ok');
