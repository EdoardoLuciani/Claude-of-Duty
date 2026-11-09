import assert from 'node:assert/strict';

import { createConfig } from '../../src/core/config.ts';
import { Engine } from '../../src/core/engine.ts';
import { Registry, type Subsystem } from '../../src/core/registry.ts';
import * as complete from '../lib/dom-fixture.ts';

// Completion belongs to a successful gameplay render, not init, a failed update,
// an absent render hook, or the diagnostic graph draws performed by prewarm.
for (const failure of [null, 'update', 'render', 'missing']) {
  const engine = new Engine({
    canvas: complete.testElement('canvas'),
    config: createConfig({ fov: 80, deterministic: true }),
  });
  // Synthetic lifecycle providers use the standalone registry's hook contract.
  const registry = new Registry();
  Object.defineProperty(engine, 'registry', { value: registry });
  const add = <T extends Subsystem>(id: string, system: T): void => {
    registry.add(id, system);
  };
  engine.input.beginFrame = (): void => {};
  let completed = 0,
    renders = 0;
  engine.onFirstRender = (): void => {
    completed++;
  };
  add('game', {
    constructor: { id: 'game' },
    update(): void {
      if (failure === 'update') engine.fail('game', 'update', Error('controlled update failure'));
    },
  });
  add('render', {
    constructor: { id: 'render' },
    ...(failure === 'missing'
      ? {}
      : {
          render(): void {
            renders++;
            assert.equal(completed, 0, 'completion cannot precede render returning');
            if (failure === 'render') throw Error('controlled render failure');
          },
        }),
  });
  const log = console.error;
  console.error = (): void => {};
  try {
    engine.step(0);
  } finally {
    console.error = log;
  }
  assert.equal(completed, failure ? 0 : 1);
  assert.equal(engine.time.frame, 1, 'no extra frame to dismiss loading');
  assert.equal(engine.time.elapsed, 0);
  if (!failure) {
    registry.get('render').render = (): void => {
      renders++;
    };
    engine.step(0);
    assert.equal(completed, 1, 'one-shot completion');
    assert.equal(renders, 2, 'one gameplay render per step');
  }
}
// HTML, stage ordering, ARIA and reduced motion are exercised against the live
// DOM by loading-shell-e2e / loading-screen-e2e, not by matching source spelling.
console.log('one-shot successful gameplay render boundary passed');
