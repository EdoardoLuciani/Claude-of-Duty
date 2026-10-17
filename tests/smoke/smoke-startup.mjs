import assert from 'node:assert/strict';

import { Engine } from '../../src/core/engine.ts';

// Completion belongs to a successful gameplay render, not init, a failed update,
// an absent render hook, or the diagnostic graph draws performed by prewarm.
for (const failure of [null, 'update', 'render', 'missing']) {
  const engine = new Engine({ canvas: {}, config: { fov: 80, deterministic: true } });
  engine.input.beginFrame = () => {};
  let completed = 0,
    renders = 0;
  engine.onFirstRender = () => {
    completed++;
  };
  engine.registry.add({
    constructor: { id: 'game' },
    update() {
      if (failure === 'update') engine.fail('game', 'update', Error('controlled update failure'));
    },
  });
  engine.registry.add({
    constructor: { id: 'render' },
    ...(failure === 'missing'
      ? {}
      : {
          render() {
            renders++;
            assert.equal(completed, 0, 'completion cannot precede render returning');
            if (failure === 'render') throw Error('controlled render failure');
          },
        }),
  });
  const log = console.error;
  console.error = () => {};
  try {
    engine.step(0);
  } finally {
    console.error = log;
  }
  assert.equal(completed, failure ? 0 : 1);
  assert.equal(engine.time.frame, 1, 'no extra frame to dismiss loading');
  assert.equal(engine.time.elapsed, 0);
  if (!failure) {
    engine.registry.get('render').render = () => {
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
