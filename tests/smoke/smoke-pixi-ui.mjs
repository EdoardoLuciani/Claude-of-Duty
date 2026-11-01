import assert from 'node:assert/strict';

import { DOMAdapter, WebGPURenderer } from 'pixi.js';

import { UiSystem } from '../../src/ui/index.ts';
import { initPixiRenderer } from '../../src/ui/pixi-device.ts';
import { PixiHud } from '../../src/ui/pixi-hud.ts';

await assert.rejects(
  initPixiRenderer({}, { backend: {} }, {}, 1, 1),
  /requires the initialized WebGPU device/
);
const adapter = DOMAdapter.get(),
  oldDocument = globalThis.document;
try {
  globalThis.document = {
    createElement() {
      throw Error('constructor failed');
    },
  };
  await assert.rejects(PixiHud.create({}, {}, {}), /constructor failed/);
  assert.equal(DOMAdapter.get(), adapter, 'constructor failure restores adapter');
} finally {
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}

// Partial renderer init/cleanup must preserve the original boot error and adapter.
const descriptors = Object.fromEntries(
  ['navigator', 'GPUDevice', 'devicePixelRatio', 'document'].map((k) => [
    k,
    Object.getOwnPropertyDescriptor(globalThis, k),
  ])
);
const init = WebGPURenderer.prototype.init,
  destroy = WebGPURenderer.prototype.destroy,
  warn = console.warn;
try {
  class Device {}
  const device = Object.assign(new Device(), { adapterInfo: { vendor: 'test' } });
  for (const [key, value] of Object.entries({
    GPUDevice: Device,
    devicePixelRatio: 1,
    navigator: { gpu: { requestAdapter: async () => ({ info: { vendor: 'test' } }) } },
    document: {
      createElement: () => ({
        style: {},
        getContext() {
          return null;
        },
        setAttribute() {},
        remove() {},
      }),
    },
  }))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  WebGPURenderer.prototype.init = async function (options) {
    assert.equal(options.gpu.device, device);
    throw Error('HUD init failed');
  };
  let cleaned = 0;
  WebGPURenderer.prototype.destroy = function () {
    cleaned++;
    throw Error('cleanup failed');
  };
  console.warn = () => {};
  await assert.rejects(
    PixiHud.create({ clientWidth: 1, clientHeight: 1 }, {}, { backend: { device } }),
    /HUD init failed/
  );
  assert.equal(cleaned, 1);
  assert.equal(DOMAdapter.get(), adapter);
} finally {
  WebGPURenderer.prototype.init = init;
  WebGPURenderer.prototype.destroy = destroy;
  console.warn = warn;
  for (const [key, descriptor] of Object.entries(descriptors))
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
}

for (const failure of [null, 'injury', 'stage', 'renderer']) {
  const hud = Object.create(PixiHud.prototype);
  let stages = 0,
    renderers = 0,
    removed = 0;
  Object.assign(hud, {
    disposed: false,
    restoreAdapter: () => DOMAdapter.set(adapter),
    injury: {
      dispose() {
        if (failure === 'injury') throw Error('injury');
      },
    },
    stage: {
      destroy() {
        stages++;
        if (failure === 'stage') throw Error('stage');
      },
    },
    renderer: {
      destroy() {
        renderers++;
        if (failure === 'renderer') throw Error('renderer');
      },
    },
    canvas: {
      remove() {
        removed++;
      },
    },
  });
  DOMAdapter.set({ ...adapter, getBaseUrl: () => 'mainline-test' });
  if (failure) assert.throws(() => hud.dispose(), new RegExp(failure));
  else hud.dispose();
  assert.equal(DOMAdapter.get(), adapter);
  assert.equal(stages, 1);
  assert.equal(renderers, 1);
  assert.equal(removed, 1);
  hud.dispose();
  hud.update(0);
  assert.equal(renderers, 1, 'disposed HUD cannot draw or destroy twice');
}
const ui = Object.create(UiSystem.prototype),
  cleaned = [];
ui.pixiHud = {
  dispose() {
    throw Error('Pixi cleanup failed');
  },
};
ui.startGate = {
  dispose() {
    cleaned.push('start');
  },
};
ui._unsubs = [() => cleaned.push('events')];
const widgets = [
  'killfeed',
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
  assert.equal(ui.pixiHud, null);
} finally {
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}
console.log(
  'ok mainline HUD: guarded shared device, constructor/init/cleanup isolation, adapter restoration and native-control teardown'
);
