import assert from 'node:assert/strict';

import { Container, DOMAdapter, Text, ViewSystem, WebGPURenderer } from 'pixi.js';
import * as THREE from 'three/webgpu';

import { Rng } from '../../src/core/rng.ts';
import { ScoreBar } from '../../src/ui/compass.ts';
import { Crosshair } from '../../src/ui/crosshair.ts';
import type { GameOverScreen } from '../../src/ui/gameover.ts';
import { HealthFx } from '../../src/ui/health.ts';
import { UiSystem } from '../../src/ui/index.ts';
import { Killfeed } from '../../src/ui/killfeed.ts';
import { MarketCountdown } from '../../src/ui/market.ts';
import type { MarketOverlay } from '../../src/ui/market.ts';
import type { PauseMenu } from '../../src/ui/menu.ts';
import { Minimap } from '../../src/ui/minimap.ts';
import { PixiAmmoView, AMMO_HEIGHT } from '../../src/ui/pixi-ammo-view.ts';
import { initPixiRenderer } from '../../src/ui/pixi-device.ts';
import { PixiHud } from '../../src/ui/pixi-hud.ts';
import { PixiMinimap } from '../../src/ui/pixi-minimap.ts';
import { setHudTextResolution } from '../../src/ui/pixi-type.ts';
import { Prompt, Banner } from '../../src/ui/prompts.ts';
import type { RadioPanel } from '../../src/ui/radio.ts';
import type { StartGate } from '../../src/ui/start.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';
import {
  createRetainedHud,
  installUiDocument,
  deleteGlobal,
  captureMethod,
} from '../lib/ui-fixture.ts';

const restoreDocument = installUiDocument();
const game = new THREE.Renderer(
  new THREE.WebGPUBackend({ canvas: document.createElement('canvas') })
);
await assert.rejects(
  initPixiRenderer(
    new WebGPURenderer(),
    fixture<THREE.Renderer>(
      { backend: fixture<THREE.Renderer['backend']>({}, complete.testBackend()) },
      complete.testRenderer()
    ),
    document.createElement('canvas'),
    1,
    1
  ),
  /requires the initialized WebGPU device/
);
const adapter = DOMAdapter.get(),
  oldDocument = globalThis.document;
try {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: fixture<Document>(
      {
        createElement(): never {
          throw Error('constructor failed');
        },
      },
      complete.testDocument()
    ),
  });
  await assert.rejects(
    PixiHud.create(
      fixture<HTMLElement>({}, complete.testElement('div')),
      fixture<HTMLElement>({}, complete.testElement('div')),
      game
    ),
    /constructor failed/
  );
  assert.equal(DOMAdapter.get(), adapter, 'constructor failure restores adapter');
} finally {
  if (oldDocument === undefined) deleteGlobal('document');
  else globalThis.document = oldDocument;
}

// Partial renderer init/cleanup must preserve the original boot error and adapter.
const descriptors = Object.fromEntries(
  ['navigator', 'GPUDevice', 'devicePixelRatio', 'document'].map(
    (k): [string, PropertyDescriptor | undefined] => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]
  )
);
const init = captureMethod(WebGPURenderer.prototype, 'init'),
  destroy = captureMethod(WebGPURenderer.prototype, 'destroy'),
  warn = console.warn;
try {
  const device = fixture<GPUDevice>(
    {
      adapterInfo: fixture<GPUAdapterInfo>(
        { vendor: 'test' },
        {
          get vendor(): never {
            return complete.unavailable('vendor');
          },
          get architecture(): never {
            return complete.unavailable('architecture');
          },
          get device(): never {
            return complete.unavailable('device');
          },
          get description(): never {
            return complete.unavailable('description');
          },
          get isFallbackAdapter(): never {
            return complete.unavailable('isFallbackAdapter');
          },
          get subgroupMaxSize(): never {
            return complete.unavailable('subgroupMaxSize');
          },
          get subgroupMinSize(): never {
            return complete.unavailable('subgroupMinSize');
          },
        }
      ),
    },
    {
      get addEventListener(): never {
        return complete.unavailable('addEventListener');
      },
      get removeEventListener(): never {
        return complete.unavailable('removeEventListener');
      },
      get features(): never {
        return complete.unavailable('features');
      },
      get limits(): never {
        return complete.unavailable('limits');
      },
      get adapterInfo(): never {
        return complete.unavailable('adapterInfo');
      },
      get queue(): never {
        return complete.unavailable('queue');
      },
      get destroy(): never {
        return complete.unavailable('destroy');
      },
      get createBuffer(): never {
        return complete.unavailable('createBuffer');
      },
      get createTexture(): never {
        return complete.unavailable('createTexture');
      },
      get createSampler(): never {
        return complete.unavailable('createSampler');
      },
      get importExternalTexture(): never {
        return complete.unavailable('importExternalTexture');
      },
      get createBindGroupLayout(): never {
        return complete.unavailable('createBindGroupLayout');
      },
      get createPipelineLayout(): never {
        return complete.unavailable('createPipelineLayout');
      },
      get createBindGroup(): never {
        return complete.unavailable('createBindGroup');
      },
      get createShaderModule(): never {
        return complete.unavailable('createShaderModule');
      },
      get createComputePipeline(): never {
        return complete.unavailable('createComputePipeline');
      },
      get createRenderPipeline(): never {
        return complete.unavailable('createRenderPipeline');
      },
      get createComputePipelineAsync(): never {
        return complete.unavailable('createComputePipelineAsync');
      },
      get createRenderPipelineAsync(): never {
        return complete.unavailable('createRenderPipelineAsync');
      },
      get createCommandEncoder(): never {
        return complete.unavailable('createCommandEncoder');
      },
      get createRenderBundleEncoder(): never {
        return complete.unavailable('createRenderBundleEncoder');
      },
      get createQuerySet(): never {
        return complete.unavailable('createQuerySet');
      },
      get lost(): never {
        return complete.unavailable('lost');
      },
      get pushErrorScope(): never {
        return complete.unavailable('pushErrorScope');
      },
      get popErrorScope(): never {
        return complete.unavailable('popErrorScope');
      },
      get onuncapturederror(): never {
        return complete.unavailable('onuncapturederror');
      },
      get dispatchEvent(): never {
        return complete.unavailable('dispatchEvent');
      },
      get label(): never {
        return complete.unavailable('label');
      },
    }
  );
  class Device {
    static [Symbol.hasInstance](candidate: unknown): boolean {
      return candidate === device;
    }
  }
  class InitializedBackend extends THREE.WebGPUBackend {
    device = device;
  }
  const backend = new InitializedBackend({ canvas: document.createElement('canvas') });
  const initializedGame = new THREE.Renderer(backend);
  for (const [key, value] of Object.entries({
    GPUDevice: Device,
    devicePixelRatio: 1,
    navigator: {
      gpu: {
        requestAdapter: async (): Promise<{ info: { vendor: string } }> => ({
          info: { vendor: 'test' },
        }),
      },
    },
    document: {
      createElement: (): {
        style: {};
        getContext(): null;
        setAttribute(): void;
        remove(): void;
      } => ({
        style: {},
        getContext(): null {
          return null;
        },
        setAttribute(): void {},
        remove(): void {},
      }),
    },
  }))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  WebGPURenderer.prototype.init = async function (options): Promise<never> {
    assert.equal(options?.gpu?.device, device);
    throw Error('HUD init failed');
  };
  let cleaned = 0;
  WebGPURenderer.prototype.destroy = function (): never {
    cleaned++;
    throw Error('cleanup failed');
  };
  console.warn = (): void => {};
  await assert.rejects(
    PixiHud.create(
      fixture<HTMLElement>({ clientWidth: 1, clientHeight: 1 }, complete.testElement('div')),
      fixture<HTMLElement>({}, complete.testElement('div')),
      initializedGame
    ),
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
    else deleteGlobal(key);
}

// Restore the regular CPU-only environment after the constructor/init failure boundaries.
installUiDocument();
for (const failure of [null, 'injury', 'stage', 'renderer']) {
  const hud = createRetainedHud();
  let stages = 0,
    renderers = 0,
    removed = 0;
  hud['restoreAdapter'] = (): void => DOMAdapter.set(adapter);
  hud.injury.dispose = (): void => {
    if (failure === 'injury') throw Error('injury');
  };
  hud.stage.destroy = (): void => {
    stages++;
    if (failure === 'stage') throw Error('stage');
  };
  hud.renderer.destroy = (): void => {
    renderers++;
    if (failure === 'renderer') throw Error('renderer');
  };
  hud.canvas.remove = (): void => {
    removed++;
  };
  DOMAdapter.set({ ...adapter, getBaseUrl: (): string => 'mainline-test' });
  if (failure) assert.throws((): void => hud.dispose(), new RegExp(failure));
  else hud.dispose();
  assert.equal(DOMAdapter.get(), adapter);
  assert.equal(stages, 1);
  assert.equal(renderers, 1);
  assert.equal(removed, 1);
  hud.dispose();
  hud.update(
    0,
    { ammo: 0, magSize: 0, reserve: 0 },
    new HealthFx(),
    new Crosshair(),
    new Minimap(new Rng(1)),
    {},
    0,
    fixture<Parameters<PixiHud['update']>[7]>(
      {},
      {
        get hit(): never {
          return complete.unavailable('hit');
        },
        get arcs(): never {
          return complete.unavailable('arcs');
        },
        get compass(): never {
          return complete.unavailable('compass');
        },
        get ammo(): never {
          return complete.unavailable('ammo');
        },
        get fpsText(): never {
          return complete.unavailable('fpsText');
        },
        get prompt(): never {
          return complete.unavailable('prompt');
        },
        get banner(): never {
          return complete.unavailable('banner');
        },
        get scoreBar(): never {
          return complete.unavailable('scoreBar');
        },
        get killfeed(): never {
          return complete.unavailable('killfeed');
        },
        get marketCountdown(): never {
          return complete.unavailable('marketCountdown');
        },
      }
    )
  );
  assert.equal(renderers, 1, 'disposed HUD cannot draw or destroy twice');
}
const ui = new UiSystem(),
  cleaned: string[] = [];
ui.pixiHud = createRetainedHud();
ui.pixiHud.dispose = (): never => {
  throw Error('Pixi cleanup failed');
};
ui.startGate = fixture<StartGate>(
  {
    dispose(): void {
      cleaned.push('start');
    },
  },
  complete.testStartGate()
);
ui._unsubs = [
  (): void => {
    cleaned.push('events');
  },
];
const widgets = ['minimap', 'menu', 'gameOver', 'shop', 'radio'];
ui.minimap = new Minimap(new Rng(1));
ui.minimap.dispose = (): void => {
  cleaned.push('minimap');
};
ui.menu = fixture<PauseMenu>(
  {
    dispose(): void {
      cleaned.push('menu');
    },
  },
  complete.testPauseMenu()
);
ui.gameOver = fixture<GameOverScreen>(
  {
    dispose(): void {
      cleaned.push('gameOver');
    },
  },
  complete.testGameOver()
);
ui.shop = fixture<MarketOverlay>(
  {
    dispose(): void {
      cleaned.push('shop');
    },
  },
  complete.testMarketOverlay()
);
ui.radio = fixture<RadioPanel>(
  {
    dispose(): void {
      cleaned.push('radio');
    },
  },
  complete.testRadioPanel()
);
ui.root = document.createElement('div');
ui.root.remove = (): void => {
  cleaned.push('root');
};
try {
  assert.throws((): void => ui.dispose(), /Pixi cleanup failed/);
  assert.deepEqual(cleaned, ['start', 'events', ...widgets, 'root']);
  assert.equal(ui.pixiHud, null);
} finally {
  if (oldDocument === undefined) deleteGlobal('document');
  else globalThis.document = oldDocument;
}
const dprHud = createRetainedHud();
const dprCanvas = dprHud.canvas;
dprCanvas.width = 1918;
dprCanvas.height = 1078;
const dprView = new ViewSystem(dprHud.renderer);
dprView.init({ canvas: dprCanvas, width: 1918, height: 1078, resolution: 1, autoDensity: true });
let dprResizes = 0;
Object.defineProperty(dprHud.renderer, 'resolution', { get: (): number => dprView.resolution });
Object.defineProperty(dprHud.renderer, 'screen', {
  get: (): typeof dprView.screen => dprView.screen,
});
dprHud.renderer.resize = (w: number, h: number, resolution?: number): void => {
  dprView.resize(w, h, resolution ?? 1);
  dprResizes++;
};
dprHud.injury.update = (): boolean => false;
dprHud.setVisible(true);
const hiddenFrame = (): void =>
  dprHud.update(
    0,
    { ammo: 0, magSize: 0, reserve: 0 },
    new HealthFx(),
    new Crosshair(),
    new Minimap(new Rng(1)),
    {},
    0,
    fixture<Parameters<PixiHud['update']>[7]>(
      {},
      {
        get hit(): never {
          return complete.unavailable('hit');
        },
        get arcs(): never {
          return complete.unavailable('arcs');
        },
        get compass(): never {
          return complete.unavailable('compass');
        },
        get ammo(): never {
          return complete.unavailable('ammo');
        },
        get fpsText(): never {
          return complete.unavailable('fpsText');
        },
        get prompt(): never {
          return complete.unavailable('prompt');
        },
        get banner(): never {
          return complete.unavailable('banner');
        },
        get scoreBar(): never {
          return complete.unavailable('scoreBar');
        },
        get killfeed(): never {
          return complete.unavailable('killfeed');
        },
        get marketCountdown(): never {
          return complete.unavailable('marketCountdown');
        },
      }
    )
  );
try {
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true });
  dprHud.resize(1918, 1078, 1);
  for (const dpr of [1.25, 2, 1]) {
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: dpr, configurable: true });
    hiddenFrame();
    hiddenFrame();
    assert.deepEqual(
      [dprHud.reticle.x, dprHud.reticle.y],
      [959, 539],
      'rounded pixels do not feed back into logical layout'
    );
  }
  assert.equal(dprResizes, 4, 'initial layout plus one resize per DPR change, even while hidden');
  assert.deepEqual([dprCanvas.width, dprCanvas.height], [1918, 1078]);
  assert.deepEqual([dprCanvas.style.width, dprCanvas.style.height], ['1918px', '1078px']);
} finally {
  if (descriptors.devicePixelRatio)
    Object.defineProperty(globalThis, 'devicePixelRatio', descriptors.devicePixelRatio);
  else deleteGlobal('devicePixelRatio');
  dprView.destroy();
  dprHud.stage.destroy();
  dprHud.reticle.destroy();
}
const textStage = new Container(),
  textProbe = new Text({ text: '100', style: { fontSize: 32 } }),
  mapView = new PixiMinimap();
textStage.addChild(textProbe, mapView.stage);
mapView.textResolution = 8 / 3;
setHudTextResolution(textStage, mapView.textResolution);
assert.equal(textProbe.resolution, 8 / 3, 'enlarged HUD text uses matching raster density');
assert.equal(textProbe.style.fontSize, 32);
assert.equal(textProbe.scale.x, 1, 'density changes do not change layout scale');
let textUpdates = 0;
const viewUpdate = captureMethod(textProbe, 'onViewUpdate');
textProbe.onViewUpdate = (): void => {
  textUpdates++;
  viewUpdate.call(textProbe);
};
setHudTextResolution(textStage, mapView.textResolution);
assert.equal(textUpdates, 0, 'unchanged density does not invalidate text');
const mapData = new Minimap(new Rng(1)),
  mapState = { pulses: [{ x: 0, z: 0, y: 5 }] };
mapView.update(mapData, mapState);
assert.equal(mapView['pulses'][0].text.resolution, 8 / 3, 'late labels inherit HUD density');
mapView.textResolution = 2;
setHudTextResolution(textStage, 2);
assert.equal(textUpdates, 1);
assert.equal(
  mapView['pulses'][0].text.resolution,
  2,
  'existing late labels follow density changes'
);
mapView.update(mapData, { pulses: [...mapState.pulses, { x: 1, z: 1, y: -5 }] });
assert.equal(mapView['pulses'][1].text.resolution, 2);
textProbe.onViewUpdate = viewUpdate;
textStage.destroy({ children: true });
const ammoView = new PixiAmmoView();
assert.equal(AMMO_HEIGHT - ammoView['magFill'].y, 8, 'magazine shares armour-bar bottom inset');
assert(ammoView['prompt'].y >= 0 && ammoView['prompt'].y + 16 <= ammoView['bar'].y);
assert(ammoView['bar'].y + 3 < ammoView['mode'].y, 'reload feedback stays above the readout');
ammoView.update(0, { ammo: 0, magSize: 30, reserve: 210, reloading: true, reloadProgress: 0.5 });
assert(ammoView['bar'].visible && ammoView['fill'].scale.x === 0.5);
assert.equal(ammoView['prompt'].text, 'RELOADING');
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
assert.equal(feed.pool.items.filter((x): boolean => x.alive).length, 6);
assert.equal(Math.max(...feed.rows.map((r): number => r.sequence)), 8);
assert(feed.pool.items.every((x): boolean => x.node === null));
feed.update(0);
assert(feed.rows.some((r): boolean => r.headshot && r.alpha === 1));
feed.update(6);
assert(feed.pool.items.every((x): boolean => !x.alive));
feed.push({});
feed.clear();
assert(feed.pool.items.every((x): boolean => !x.alive));
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
assert([prompt, banner, feed, score, count].every((m): boolean => !('root' in m)));
console.log(
  'ok mainline HUD: guarded shared device, constructor/init/cleanup isolation, adapter restoration and native-control teardown'
);

restoreDocument();
