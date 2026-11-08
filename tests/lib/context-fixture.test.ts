import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Agent } from '../../src/ai/agent.ts';
import { AiSystem } from '../../src/ai/index.ts';
import { Input } from '../../src/core/input.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';
import { makeAgent, makeAi, makeRng } from './agent-fixture.ts';
import { createContext, createInput } from './context.ts';
import type { TestProviders } from './context.ts';
import { fixture } from './fixture.ts';

void test('context fixture retains provider identity and fails on missing dependencies', (): void => {
  const physics = new PhysicsSystem();
  const providers: TestProviders = { physics };
  const context = createContext({ providers, input: createInput({ frozen: true }) });
  assert.equal(context.get('physics'), physics);
  assert.equal(context.peek('physics'), physics);
  assert.equal(context.has('physics'), true);
  assert.equal(context.peek('ai'), null);
  assert.equal(context.has('ai'), false);
  assert.throws((): unknown => context.get('ai'), /requires provider: ai/);
  assert.throws((): unknown => context.canvas, /explicit canvas/);
  assert.throws((): unknown => context.engine, /explicit engine/);
  assert.throws((): unknown => createContext().input, /explicit input/);
  assert.ok(context.input instanceof Input);
  assert.equal(context.input.frozen, true);
  const ai = makeAi();
  providers.ai = ai;
  assert.equal(context.get('ai'), ai);
  const checked = fixture<{ value: number; optional?: string }>({ value: 1 }, ['optional']);
  assert.equal(checked.value, 1);
  assert.equal(checked.optional, undefined);
  checked.value = 2;
  assert.equal(checked.value, 2);
  const incomplete = fixture<{ required: number }>({});
  assert.throws((): number => incomplete.required, /missing member required/);
});

void test('agent fixtures use real instances and preserve original null-weapon anchors', (): void => {
  const ai = makeAi();
  const agent = makeAgent({ ai, health: 73 });
  assert.ok(ai instanceof AiSystem);
  assert.ok(agent instanceof Agent);
  assert.equal(agent.ai, ai);
  assert.equal(agent.health, 73);
  assert.equal(agent.route.points, agent.path);
  assert.equal(agent.animator.weapon, null);
  assert.deepEqual(agent.animator.muzzleLocal.toArray(), [0, 0, 0.4]);
  assert.deepEqual(agent.animator.foregripLocal.toArray(), [0, 0, 0.2]);
  assert.deepEqual(agent.animator.magLocal.toArray(), [0, -0.2, 0]);
  assert.deepEqual(agent.animator.ejectLocal.toArray(), [0, 0, 0]);
});

void test('makeRng retains the existing deterministic fixture sequence', (): void => {
  let value = 0.31;
  const next = (): number => (value = (value * 1.7 + 0.13) % 1);
  const rng = makeRng();
  assert.equal(rng.float(), next());
  assert.equal(rng.range(2, 9), 2 + 7 * next());
  assert.equal(rng.int(4, 12), 4);
  assert.equal(rng.gauss(), 0);
  assert.equal(rng.signed(), next() * 2 - 1);
  const seed = next();
  assert.equal(rng.fork().float(), (seed * 1.7 + 0.13) % 1);
  assert.equal(rng.float(), next());
});
