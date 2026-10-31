import assert from 'node:assert/strict';

import { DOMAdapter } from 'pixi.js';

import { PixiUiExperiment } from '../../src/ui/pixi-experiment.ts';

await assert.rejects(
  PixiUiExperiment.create({}, { backend: {} }),
  /requires the initialized WebGPU device/
);

// Exercise control/lifetime logic without a browser or a real GPU. The hardware
// browser harness separately checks actual device sharing, rendering and input.
const panel = Object.create(PixiUiExperiment.prototype);
let resized = 0,
  rendered = 0;
Object.assign(panel, {
  disposed: false,
  visible: false,
  dirty: false,
  pulse: 0,
  draws: 0,
  slider: { value: 50 },
  reticle: { scale: { set() {} } },
  renderer: {
    render() {
      rendered++;
    },
  },
  resize() {
    resized++;
    this.dirty = true;
  },
});
panel.update(false, 0.1);
assert.equal(rendered, 0);
panel.update(true, 0.1);
assert.equal(resized, 1);
assert.equal(rendered, 1);
panel.update(true, 0.1);
assert.equal(rendered, 1, 'unchanged content is not redrawn');
panel.pulse = 1;
panel.update(true, 0.1);
assert.equal(panel.pulse, 0.6, 'feedback uses raw time while the game is paused');
assert.equal(rendered, 2);
panel.update(false, 0.1);
assert.equal(rendered, 2, 'hidden content is not redrawn');

const adapter = DOMAdapter.get();
for (const failure of [null, 'stage', 'renderer']) {
  const p = Object.create(PixiUiExperiment.prototype);
  let aborted = 0,
    destroyed = 0,
    removed = 0;
  Object.assign(p, {
    disposed: false,
    adapter,
    abort: {
      abort() {
        aborted++;
      },
    },
    stage: {
      destroy() {
        if (failure === 'stage') throw new Error('stage');
      },
    },
    renderer: {
      destroy() {
        destroyed++;
        if (failure === 'renderer') throw new Error('renderer');
      },
    },
    root: {
      remove() {
        removed++;
      },
    },
  });
  DOMAdapter.set({ ...adapter, getBaseUrl: () => 'experiment' });
  if (failure) assert.throws(() => p.dispose(), new RegExp(failure));
  else p.dispose();
  assert.equal(DOMAdapter.get(), adapter, 'always restore Pixi environment adapter');
  assert.equal(aborted, 1);
  assert.equal(destroyed, 1);
  assert.equal(removed, 1);
  p.dispose();
  p.update(true, 0.1);
  assert.equal(destroyed, 1, 'teardown is idempotent and prevents subsequent drawing');
}
console.log(
  'ok Pixi UI: guarded device entry, demand drawing, raw-time feedback, isolated teardown'
);
