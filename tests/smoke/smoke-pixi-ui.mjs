import assert from 'node:assert/strict';

import { DOMAdapter } from 'pixi.js';

import { UiSystem } from '../../src/ui/index.ts';
import { PixiAmmoHud } from '../../src/ui/pixi-ammo.ts';
import { initPixiRenderer } from '../../src/ui/pixi-device.ts';
import { PixiUiExperiment } from '../../src/ui/pixi-experiment.ts';

await assert.rejects(
  initPixiRenderer({}, { backend: {} }, {}, 1, 1),
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
const oldDocument = globalThis.document;
try {
  globalThis.document = {
    createElement() {
      throw new Error('constructor failed');
    },
  };
  for (const Type of [PixiUiExperiment, PixiAmmoHud]) {
    await assert.rejects(Type.create({}, {}), /constructor failed/);
    assert.equal(DOMAdapter.get(), adapter, 'constructor failure restores global adapter');
  }
} finally {
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}
// Fail after construction, once callbacks may have been registered by build().
const build = PixiUiExperiment.prototype.build;
let constructionAborts = 0;
try {
  globalThis.document = { createElement: () => ({ remove() {} }) };
  PixiUiExperiment.prototype.build = function () {
    this.abort.signal.addEventListener('abort', () => constructionAborts++);
    throw new Error('build failed');
  };
  await assert.rejects(PixiUiExperiment.create({}, {}), /build failed/);
  assert.equal(constructionAborts, 1, 'failed construction stage aborts registered callbacks');
  assert.equal(DOMAdapter.get(), adapter);
} finally {
  PixiUiExperiment.prototype.build = build;
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}
for (const failure of [null, 'stage', 'renderer']) {
  const p = Object.create(PixiUiExperiment.prototype);
  let aborted = 0,
    destroyed = 0,
    removed = 0;
  Object.assign(p, {
    disposed: false,
    restoreAdapter: () => DOMAdapter.set(adapter),
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
// A Pixi exception must not skip native sibling cleanup in the owning subsystem.
const ui = Object.create(UiSystem.prototype),
  cleaned = [];
ui.pixiExperiment = {
  dispose() {
    throw new Error('Pixi cleanup failed');
  },
};
ui.startGate = {
  dispose() {
    cleaned.push('start');
  },
};
ui._unsubs = [() => cleaned.push('events')];
const widgets = [
  'crosshair',
  'hit',
  'arcs',
  'health',
  'ammo',
  'killfeed',
  'compass',
  'scoreBar',
  'minimap',
  'prompt',
  'banner',
  'menu',
  'gameOver',
  'shop',
  'marketCountdown',
  'radio',
];
for (const key of widgets)
  ui[key] = {
    dispose() {
      cleaned.push(key);
    },
  };
ui.root = {
  remove() {
    cleaned.push('root');
  },
};
try {
  globalThis.document = { getElementById: () => null };
  assert.throws(() => ui.dispose(), /Pixi cleanup failed/);
  assert.deepEqual(cleaned, ['start', 'events', ...widgets, 'root']);
  assert.equal(ui.pixiExperiment, null);
  assert.equal(ui.ammo.pixi, null);
} finally {
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}
console.log('ok Pixi UI: guarded entry, constructor/owner cleanup, demand drawing and raw time');
