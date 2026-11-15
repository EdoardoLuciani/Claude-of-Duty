import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { build, type OnLoadResult, type OnResolveResult } from 'bun';
import {
  Mesh,
  MeshBasicNodeMaterial,
  InstancedMesh,
  RenderTarget,
  type Renderer,
} from 'three/webgpu';

import { createConfig } from '../../src/core/config.ts';
import type { Engine } from '../../src/core/engine.ts';
import { prewarm as nativePrewarm } from '../../src/core/prewarm.ts';
import { installShotApi } from '../../src/dev/shots.ts';
import { FxSystem } from '../../src/fx/index.ts';
import type { ParticleLayer } from '../../src/fx/particles.ts';
import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { createCoreFixture } from '../lib/core-fixture.ts';
import { fixture } from '../lib/fixture.ts';

// Execute the complete main module with native/asset boundaries replaced, not
// source slices: early HMR registration and failed boot must share real teardown.
const systems = {
  models: 'ModelSystem',
  render: 'RenderSystem',
  materials: 'MaterialSystem',
  sky: 'SkySystem',
  world: 'WorldSystem',
  physics: 'PhysicsSystem',
  player: 'PlayerSystem',
  weapons: 'WeaponSystem',
  fx: 'FxSystem',
  ai: 'AiSystem',
  game: 'GameSystem',
  market: 'MarketSystem',
  radio: 'RadioSystem',
  ui: 'UiSystem',
  intel: 'IntelSystem',
  audio: 'AudioSystem',
};
const bundled = await build({
  entrypoints: [new URL('../../src/main.ts', import.meta.url).pathname],
  target: 'browser',
  define: { 'import.meta.hot': 'globalThis.hot' },
  plugins: [
    {
      name: 'boot-boundaries',
      setup(builder): void {
        builder.onResolve({ filter: /^\.\// }, (args): OnResolveResult => ({
          path: args.path,
          namespace: 'boot',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'boot' }, ({ path }): OnLoadResult => {
          if (path === './core/engine.ts')
            return { contents: 'export const Engine = globalThis.Engine;', loader: 'js' };
          if (path === './core/config.ts')
            return {
              contents:
                'export const createConfig = globalThis.createConfig; export const QUALITY_PRESETS = {};',
              loader: 'js',
            };
          if (path === './core/guards.ts')
            return { contents: 'export const hasOwn = Object.hasOwn;', loader: 'js' };
          if (path === './core/prewarm.ts')
            return { contents: 'export const prewarm = globalThis.prewarm;', loader: 'js' };
          if (path === './dev/telemetry.ts')
            return { contents: 'export class TelemetrySystem {}', loader: 'js' };
          if (path === './dev/shots.ts')
            return {
              contents: 'export const installShotApi = globalThis.installShotApi;',
              loader: 'js',
            };
          if (path === './weapons/attachments.ts')
            return { contents: 'export const isAttachmentConfig = () => true;', loader: 'js' };
          if (path === './weapons/defs.ts')
            return { contents: 'export const isWeaponId = () => true;', loader: 'js' };
          const id = path === './core/models.ts' ? 'models' : path.split('/')[1];
          const name = Object.entries(systems).find(([key]): boolean => key === id)?.[1];
          assert(name, path);
          return {
            contents: `export class ${name} {
        static id = '${id}'; static deps = [];
        init() { return globalThis.initialize('${id}'); }
        dispose() { return globalThis.release('${id}'); }
        installStartGate() {} render() { globalThis.draw('${id}'); }
        update() { globalThis.update('${id}'); }
        prewarmMaterials() { return globalThis.warmHook('${id}'); }
        cancelPrewarm() { globalThis.cancelPrewarm(); }
      }`,
            loader: 'js',
          };
        });
      },
    },
  ],
});
assert(bundled.success, JSON.stringify(bundled.logs));
const code = await bundled.outputs[0]!.text();

for (const phase of [
  'init',
  'prewarm',
  'capture-prewarm',
  'report',
  'hmr-init',
  'hmr-prewarm',
  'hmr-fx',
  'runtime',
  'ready',
]) {
  const { engine } = createCoreFixture();
  engine.input.attach = engine.input.detach = (): void => {};
  engine.resize = (): void => {};
  engine.start = (): void => {};
  const calls: string[] = [],
    errors: unknown[][] = [];
  const original = new Error(`original ${phase}`);
  let finish = (): void => {};
  const gate = new Promise<void>((resolve): void => {
    finish = resolve;
  });
  let reached = (): void => {};
  const boundary = new Promise<void>((resolve): void => {
    reached = resolve;
  });
  let hmr: (() => Promise<void>) | undefined;
  const frames = new Map<number, FrameRequestCallback>();
  let frame = 0,
    terminal = 0,
    captureDisposed = 0;
  let acquired = false,
    draws = 0,
    updates = 0,
    resourcesDisposed = false;
  const render = new RenderSystem(),
    fx = new FxSystem();
  const previousTarget = new RenderTarget(1, 1);
  let target: RenderTarget | null = previousTarget;
  const savedPosition = engine.camera.position.clone();
  const renderer = fixture<Renderer>({
    getRenderTarget: (): RenderTarget | null => target,
    setRenderTarget(value): void {
      assert(!resourcesDisposed);
      target = value;
    },
    async compileAsync(): Promise<void> {
      calls.push('compile');
      engine.camera.position.set(8, 9, 10);
      reached();
      await gate;
      assert(!resourcesDisposed, 'deferred native compile retains live resources');
    },
  });
  if (phase === 'hmr-fx') {
    fx.ctx = engine.ctx;
    fx.render = render;
    fx._viewAttached = true;
    render.renderer = renderer;
    const layer = (): ParticleLayer => {
      const mesh = new Mesh(undefined, new MeshBasicNodeMaterial());
      mesh.material.addEventListener('dispose', (): void => {
        resourcesDisposed = true;
      });
      return fixture<ParticleLayer>({
        mesh,
        dispose(): void {
          mesh.geometry.dispose();
          mesh.material.dispose();
        },
      });
    };
    for (const key of ['lit', 'add', 'motes', 'viewAdd', 'viewLit'] as const) fx[key] = layer();
    fx.decals = fixture<FxSystem['decals']>({ mesh: new Mesh(), dispose(): void {} });
    fx.shells = fixture<FxSystem['shells']>({
      mesh: new InstancedMesh(undefined, undefined, 1),
      hullMesh: new InstancedMesh(undefined, undefined, 1),
      dispose(): void {},
    });
    fx.hazeSys = fixture<FxSystem['hazeSys']>({
      prewarm(): never {
        assert.fail('cancelled FX must not stage haze');
      },
      dispose(): void {},
    });
  }
  const element = (): {
    style: object;
    setAttribute(): void;
    appendChild(): void;
    showModal(): void;
    focus(): void;
  } => ({
    style: {},
    setAttribute(): void {},
    appendChild(): void {},
    showModal(): void {},
    focus(): void {},
  });
  const window: Record<string, unknown> = {
    __STARTUP__: {
      stage(): void {},
      complete(): void {},
      terminal(): void {
        terminal++;
      },
    },
  };
  class Canvas {}
  const execution: unknown = runInNewContext(`(async () => { ${code}\n })()`, {
    Engine: function (): Engine {
      return engine;
    },
    createConfig,
    window,
    HTMLCanvasElement: Canvas,
    location: {
      search:
        phase === 'runtime'
          ? '?capture=1&lockstep=1'
          : phase === 'capture-prewarm'
            ? '?capture=1'
            : '',
      reload(): void {},
    },
    URLSearchParams,
    AbortController,
    document: {
      getElementById: (): Canvas => new Canvas(),
      createElement: element,
      body: element(),
      exitPointerLock(): void {},
    },
    hot: {
      dispose(callback: () => Promise<void>): void {
        hmr = callback;
      },
    },
    console: {
      info(): void {},
      warn(): void {},
      error(...args: unknown[]): void {
        errors.push(args);
      },
    },
    requestAnimationFrame(callback: FrameRequestCallback): number {
      frames.set(++frame, callback);
      return frame;
    },
    cancelAnimationFrame(id: number): void {
      frames.delete(id);
    },
    async initialize(id: string): Promise<void> {
      calls.push(`init:${id}`);
      if (phase === 'hmr-fx' && id === 'render')
        Object.assign(engine.ctx.get('render'), { renderer, patchMaterials(): void {} });
      if (id !== 'player') return;
      assert(hmr, 'HMR ownership precedes the first awaited initialization');
      if (phase === 'init') throw original;
      if (phase === 'hmr-init') {
        reached();
        await gate;
        acquired = true;
      }
    },
    release(id: string): void {
      calls.push(`dispose:${id}`);
      if (phase === 'hmr-fx') {
        assert(calls.includes('restored'), 'coordinator restoration precedes every owner disposal');
        if (id === 'fx') {
          assert.equal(fx._warmScene?.children.length, 0);
          fx.dispose();
        }
      }
      if (phase === 'hmr-init' && id === 'player')
        assert(acquired, 'release acquisitions completed after HMR began');
      if (id === 'weapons') throw new Error('cleanup failure');
    },
    draw(id: string): void {
      if (id === 'render') draws++;
    },
    update(id: string): void {
      if (phase === 'runtime' && id === 'player') {
        updates++;
        throw original;
      }
    },
    warmHook(id: string): ReturnType<FxSystem['prewarmMaterials']> | undefined {
      if (phase === 'hmr-fx' && id === 'fx') return fx.prewarmMaterials();
      assert(!render._warmAbort.signal.aborted, 'no later warmup hook after cancellation');
      return undefined;
    },
    cancelPrewarm(): void {
      render.cancelPrewarm();
    },
    installShotApi(): { dispose(): void; pump(): Promise<number> } {
      return {
        async pump(): Promise<number> {
          engine.step(20);
          if (engine.error) throw original;
          return engine.time.frame;
        },
        dispose(): void {
          captureDisposed++;
        },
      };
    },
    async prewarm(
      owner: Engine,
      options: Parameters<typeof nativePrewarm>[1]
    ): Promise<{ ok: boolean; reason?: string | undefined }> {
      if (phase === 'hmr-fx') {
        try {
          return await nativePrewarm(owner, options);
        } finally {
          assert.equal(
            target,
            previousTarget,
            'coordinator restores native target before teardown'
          );
          assert(engine.camera.position.equals(savedPosition));
          calls.push('restored');
        }
      }
      if (phase === 'prewarm' || phase === 'capture-prewarm') throw original;
      if (phase === 'hmr-prewarm') {
        reached();
        await gate;
      }
      return phase === 'report' ? { ok: false, reason: 'native warmup failure' } : { ok: true };
    },
  });
  const boot = Promise.resolve(execution);
  const rejected =
    phase === 'ready'
      ? null
      : assert.rejects(boot, (error: unknown): boolean => {
          if (
            phase === 'init' ||
            phase === 'prewarm' ||
            phase === 'capture-prewarm' ||
            phase === 'runtime'
          )
            return error === original;
          return error instanceof Error
            ? /disposed|warmup/.test(error.message)
            : /disposed|warmup/.test(String(error));
        });
  if (phase.startsWith('hmr-')) {
    await boundary;
    assert(hmr);
    let finished = false;
    const pending = hmr().then((): void => {
      finished = true;
    });
    await Promise.resolve();
    assert.equal(finished, false, 'HMR completion waits for the active native hook');
    assert(
      !calls.some((call): boolean => call.startsWith('dispose:')),
      'HMR cannot overtake active init/warmup'
    );
    assert(render._warmAbort.signal.aborted, 'cancel native frame waits before draining');
    assert(!resourcesDisposed);
    finish();
    await pending;
  }
  if (rejected) await rejected;
  else {
    await boot;
    assert.equal(frames.size, 1, 'readiness probe was scheduled');
  }
  if (phase === 'runtime') {
    assert.equal(engine.disposed, false, 'initial pump failure retains the runtime renderer');
    assert.equal(window.__READY__, undefined);
    assert.equal(terminal, 1);
    assert.equal(captureDisposed, 0);
    assert(!calls.some((call): boolean => call.startsWith('dispose:')));
    const before = draws;
    engine.step(40);
    assert.equal(draws, before + 1, 'terminal simulation still presents');
    assert.equal(updates, 1, 'terminal gameplay never runs again');
  }
  assert(hmr);
  await hmr();
  await hmr();
  assert.deepEqual(
    calls.filter((call): boolean => call.startsWith('dispose:')),
    Object.keys(systems)
      .reverse()
      .map((id): string => `dispose:${id}`)
  );
  assert.equal(captureDisposed, phase === 'capture-prewarm' || phase === 'runtime' ? 1 : 0);
  if (phase === 'hmr-fx') {
    assert(resourcesDisposed);
    assert.equal(
      calls.filter((call): boolean => call === 'compile').length,
      1,
      'cancelled FX starts no view compilation'
    );
  }
  previousTarget.dispose();
  assert.equal(window.__READY__, undefined);
  assert.equal(window.__ENGINE__, undefined);
  assert.equal(frames.size, 0, 'HMR cancels the readiness probe');
  assert.equal(terminal, phase.startsWith('hmr-') || phase === 'ready' ? 0 : 1);
  assert(errors.some((args): boolean => args.includes(original)) || phase !== 'prewarm');
  if (phase === 'report')
    assert.deepEqual(window.__PREWARM__, { ok: false, reason: 'native warmup failure' });
  if (phase === 'hmr-init') assert(!calls.includes('init:weapons'), 'no later init after disposal');
}

// Capture callbacks own all their rAFs/promises and cannot erase a replacement.
const savedWindow = globalThis.window;
const savedRequest = globalThis.requestAnimationFrame,
  savedCancel = globalThis.cancelAnimationFrame;
try {
  globalThis.window = fixture<Window & typeof globalThis>({}, [
    '__APPLY_SHOT__',
    '__PUMP__',
    '__PRESENT__',
    '__RENDER_INFO__',
    '__LOCKSTEP__',
    '__SHOTS__',
  ]);
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  globalThis.requestAnimationFrame = (callback): number => {
    frames.set(++id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (key): void => {
    frames.delete(key);
  };
  const drain = (): void => {
    const batch = [...frames.values()];
    frames.clear();
    for (const callback of batch) callback(0);
  };
  for (const lockstep of [false, true]) {
    const { engine } = createCoreFixture();
    const old = installShotApi(engine, { capture: true, lockstep });
    drain();
    if (!lockstep) assert(window.__RENDER_INFO__, 'free-running monitor publishes a snapshot');
    const pumped = old.pump(2),
      presented = old.present(2);
    const rejected = [assert.rejects(pumped, /disposed/), assert.rejects(presented, /disposed/)];
    const replacement = installShotApi(createCoreFixture().engine, { lockstep: true });
    const pump = window.__PUMP__;
    old.dispose();
    old.dispose();
    assert.equal(window.__PUMP__, pump);
    await Promise.all(rejected);
    drain();
    assert.equal(window.__RENDER_INFO__, null, 'cancelled monitor cannot overwrite replacement');
    assert.equal(engine.time.frame, 0, 'cancelled pump never steps disposed owner');
    replacement.dispose();
    assert.equal(frames.size, 0);
    assert.equal(window.__PUMP__, undefined);
    await assert.rejects(old.pump(), /disposed/);
    const active = installShotApi(engine, { capture: true, lockstep: true });
    const completed = active.pump(3);
    drain();
    drain();
    drain();
    assert.equal(await completed, 3, 'lockstep keeps exact frame counts');
    engine.fail('test', 'capture', new Error('terminal capture'));
    const failed = assert.rejects(active.present(), /engine failure/);
    drain();
    await failed;
    active.dispose();
  }
} finally {
  globalThis.window = savedWindow;
  globalThis.requestAnimationFrame = savedRequest;
  globalThis.cancelAnimationFrame = savedCancel;
}
console.log(
  'boot/HMR: original failures, reverse isolated cleanup, early ownership and cancelled capture/readiness callbacks'
);
