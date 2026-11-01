import assert from 'node:assert/strict';

import { DOMAdapter, WebGPURenderer } from 'pixi.js';

import { ScoreBar } from '../../src/ui/compass.ts';
import { UiSystem } from '../../src/ui/index.ts';
import { Killfeed } from '../../src/ui/killfeed.ts';
import { MarketCountdown } from '../../src/ui/market.ts';
import { PixiAmmoView, AMMO_HEIGHT } from '../../src/ui/pixi-ammo-view.ts';
import { initPixiRenderer } from '../../src/ui/pixi-device.ts';
import { PixiHud } from '../../src/ui/pixi-hud.ts';
import { Prompt, Banner } from '../../src/ui/prompts.ts';

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
const widgets = ['minimap', 'menu', 'gameOver', 'shop', 'radio'];
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
const ammoView = new PixiAmmoView();
assert.equal(AMMO_HEIGHT - ammoView.magFill.y, 8, 'magazine shares armour-bar bottom inset');
assert(ammoView.prompt.y >= 0 && ammoView.prompt.y + 16 <= ammoView.bar.y);
assert(ammoView.bar.y + 3 < ammoView.mode.y, 'reload feedback stays above the readout');
ammoView.update(0, { ammo: 0, magSize: 30, reserve: 210, reloading: true, reloadProgress: 0.5 });
assert(ammoView.bar.visible && ammoView.fill.scale.x === 0.5);
assert.equal(ammoView.prompt.text, 'RELOADING');
ammoView.stage.destroy({ children: true });
const prompt = new Prompt(),
  banner = new Banner(),
  feed = new Killfeed(),
  score = new ScoreBar(),
  count = new MarketCountdown(10);
prompt.set({ key: 'H', text: 'bandaging', sub: '2 left', progress: 0.5 });
prompt.update(0.1);
assert.equal(prompt.text, 'BANDAGING');
assert(prompt.hasProgress);
assert(prompt.shown > 0);
const shown = prompt.shown;
prompt.update(0);
assert.equal(prompt.shown, shown);
prompt.clear();
prompt.update(1);
assert(prompt.shown < 0.005);
banner.show('wave clear', '+500', 2);
banner.update(0.16);
assert.equal(banner.alpha, 1);
assert.equal(banner.title, 'WAVE CLEAR');
const phase = banner.t;
banner.update(0);
assert.equal(banner.t, phase);
banner.clear();
assert.equal(banner.t, 1);
for (let i = 0; i < 8; i++)
  feed.push({ attacker: `player ${i}`, victim: 'enemy', mine: true, headshot: i === 7 });
feed.update(0.16);
assert.equal(feed.pool.items.filter((x) => x.alive).length, 6);
assert.equal(Math.max(...feed.rows.map((r) => r.sequence)), 8);
assert(feed.pool.items.every((x) => x.node === null));
feed.update(0);
assert(feed.rows.some((r) => r.headshot && r.alpha === 1));
feed.update(6);
assert(feed.pool.items.every((x) => !x.alive));
feed.push({});
feed.clear();
assert(feed.pool.items.every((x) => !x.alive));
score.update({
  score: 123,
  credits: 45,
  wave: 2,
  enemiesRemaining: 1,
  waveIncoming: true,
  nextWaveIn: 4.2,
  marketIn: 3,
});
assert.equal(score.score, '000123');
assert.equal(score.credits, '000045');
assert.equal(score.status, 'SUPPLIES IN 3s');
score.update({ waveIncoming: true, nextWaveIn: 4.2 });
assert.equal(score.status, 'NEXT WAVE 5s');
score.update({ enemiesRemaining: 1 });
assert.equal(score.status, '1 HOSTILE');
count.update(0.1, 5);
assert.equal(count.value, '5');
assert.equal(count.fraction, 0.5);
assert(count.shown > 0);
assert([prompt, banner, feed, score, count].every((m) => !('root' in m)));
console.log(
  'ok mainline HUD: guarded shared device, constructor/init/cleanup isolation, adapter restoration and native-control teardown'
);
