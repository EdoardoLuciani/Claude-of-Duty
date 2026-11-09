import assert from 'node:assert/strict';

import { context, mrt as createMrt } from 'three/tsl';
import {
  Color,
  Scene,
  PerspectiveCamera,
  Mesh,
  BoxGeometry,
  MeshBasicNodeMaterial,
  DataUtils,
  RenderTarget,
  Texture,
  Lighting,
  type Renderer,
  type MRTNode,
} from 'three/webgpu';

import { Engine } from '../../src/core/engine.ts';
import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { createHdrMeter } from '../../src/render/meter-webgpu.ts';
import { warmFrame } from '../../src/render/warm-frame.ts';
import { createTestContext } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';
import { captureMethod } from '../lib/render-fixture.ts';

// Teardown must report both sync and async failures, after all owners and events.
const order: string[] = [],
  error = console.error;
console.error = (): void => {};
try {
  const engine = fixture<Engine>(
    {
      dispose: captureMethod(Engine.prototype, 'dispose'),
      stop(): void {},
      _onResize(): void {},
      input: fixture<Engine['input']>({ detach(): void {} }, complete.createTestInput()),
      events: fixture<Engine['events']>(
        {
          clear(): void {
            order.push('events');
          },
        },
        new complete.EventBus()
      ),
      registry: fixture<Engine['registry']>(
        {
          ordered: [
            {
              dispose(): void {
                order.push('last');
              },
            },
            {
              dispose(): void {
                order.push('sync');
                throw Error('sync');
              },
            },
            {
              async dispose(): Promise<void> {
                order.push('async');
                throw Error('async');
              },
            },
          ],
        },
        new complete.Registry<complete.EngineSystems>()
      ),
    },
    complete.testEngine()
  );
  globalThis.removeEventListener = (): void => {};
  await assert.rejects(
    engine.dispose(),
    (e: unknown): boolean => e instanceof AggregateError && e.errors.length === 2
  );
  assert.deepEqual(order, ['async', 'sync', 'last', 'events']);
} finally {
  console.error = error;
  Reflect.deleteProperty(globalThis, 'removeEventListener');
}

// rAF scheduling stays native, but cancellation/deadline removes pending work.
const callbacks = new Map<number, FrameRequestCallback>();
let serial = 0,
  draws = 0;
globalThis.requestAnimationFrame = (cb): number => {
  callbacks.set(++serial, cb);
  return serial;
};
globalThis.cancelAnimationFrame = (id): void => {
  callbacks.delete(id);
};
const fireFrame = (): void => {
  const entry = callbacks.entries().next().value;
  assert(entry);
  const [id, callback] = entry;
  callbacks.delete(id); // The browser consumes a delivered rAF automatically.
  callback(performance.now());
};
try {
  const abort = new AbortController();
  const resumed = warmFrame(
    (): void => {
      draws++;
    },
    abort.signal,
    performance.now() + 1000
  );
  assert.equal(draws, 0);
  fireFrame();
  await resumed;
  assert.equal(draws, 1);
  assert.equal(callbacks.size, 0);
  const stalled = warmFrame(
    (): void => {
      draws++;
    },
    abort.signal,
    performance.now() + 5
  );
  await assert.rejects(stalled, /keep this tab visible/);
  assert.equal(callbacks.size, 0, 'pending rAF must be cancelled after timeout');
  assert.equal(draws, 1);
  const cancelled = warmFrame(
    (): void => {
      draws++;
    },
    abort.signal,
    performance.now() + 1000
  );
  abort.abort(Error('cancelled'));
  await assert.rejects(cancelled, /cancelled/);
  assert.equal(callbacks.size, 0);
  await assert.rejects(
    warmFrame(
      (): void => {
        draws++;
      },
      abort.signal,
      performance.now() + 1000
    ),
    /cancelled/
  );

  // Throw after jitter/state mutation: preserve authored sub-frustum, matrices,
  // pass flags, hidden mesh, geometry range and render state.
  const owner = new RenderSystem(),
    camera = new PerspectiveCamera(60, 2, 0.1, 100);
  camera.setViewOffset(640, 320, 10, 0, 620, 320);
  const view = { ...camera.view },
    projection = camera.projectionMatrix.clone();
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  mesh.visible = false;
  mesh.geometry.setDrawRange(2, 12);
  const scene = new Scene();
  scene.add(mesh);
  let target: RenderTarget | null = new RenderTarget(),
    clear = new Color(0.1, 0.2, 0.3),
    alpha = 0.4,
    failed: unknown;
  const originalTarget = target,
    originalMrt = createMrt({}),
    originalRenderObject = (): void => {};
  let mrt: MRTNode | null = originalMrt;
  let renderObject: ReturnType<Renderer['getRenderObjectFunction']> = originalRenderObject;
  const booleanRendererKeys = [
    'autoClear',
    'autoClearColor',
    'autoClearDepth',
    'autoClearStencil',
    'opaque',
    'transparent',
  ] as const;
  const rendererProps = {
    autoClear: false,
    autoClearColor: false,
    autoClearDepth: false,
    autoClearStencil: false,
    opaque: true,
    transparent: true,
    contextNode: context(),
    lighting: new Lighting(),
  };
  owner.ctx = createTestContext({
    scene,
    viewScene: new Scene(),
    camera,
    viewCamera: camera.clone(),
    time: { elapsed: 0, raw: 0, dt: 0, fixed: 0, alpha: 0, scale: 1, frame: 42 },
    engine: fixture<Engine>(
      {
        fail(_system, _method, e): void {
          failed = e;
        },
      },
      complete.testEngine()
    ),
  });
  owner.renderer = fixture<Renderer>(
    {
      ...rendererProps,
      xr: fixture<Renderer['xr']>({ enabled: true }, complete.testRenderer().xr),
      shadowMap: { enabled: true, transmitted: false, type: 1 },
      toneMapping: 4,
      outputColorSpace: 'original',
      getMRT: (): MRTNode => {
        assert(mrt);
        return mrt;
      },
      setMRT: (value): Renderer => {
        mrt = value;
        return owner.renderer;
      },
      getRenderObjectFunction: (): ReturnType<Renderer['getRenderObjectFunction']> => renderObject,
      setRenderObjectFunction: (value): void => {
        renderObject = value;
      },
      getRenderTarget: (): RenderTarget | null => target,
      setRenderTarget: (t): void => {
        target = t;
      },
      getClearColor: (c): Color => c.copy(clear),
      getClearAlpha: (): number => alpha,
      setClearColor(c, a = alpha): void {
        clear = new Color(c);
        alpha = a;
      },
    },
    complete.testRenderer()
  );
  owner._warmAbort = new AbortController();
  owner._tagPrepassMesh = owner._tagViewMesh = (): void => {};
  const passes = Array.from({ length: 3 }, (): import('three/webgpu').PassNode =>
    fixture<import('three/webgpu').PassNode>(
      { opaque: true, transparent: false },
      new complete.THREE.PassNode(
        'color',
        new complete.THREE.Scene(),
        new complete.THREE.PerspectiveCamera()
      )
    )
  );
  owner._graph = fixture<NonNullable<RenderSystem['_graph']>>(
    {
      prePass: passes[0],
      worldPass: passes[1],
      viewPass: passes[2],
      taaPass: fixture<NonNullable<NonNullable<RenderSystem['_graph']>['taaPass']>>(
        {
          setSize(): void {},
          clearViewOffset(): void {
            camera.clearViewOffset();
          },
        },
        complete.testTaa()
      ),
      render(): void {
        camera.setViewOffset(640, 320, 0.5, 0.5, 640, 320);
        owner.renderer.toneMapping = 0;
        owner.renderer.outputColorSpace = 'changed';
        owner.renderer.xr.enabled = false;
        owner.renderer.setClearColor(0, 0);
        owner.renderer.shadowMap.enabled = false;
        for (const key of booleanRendererKeys) owner.renderer[key] = !rendererProps[key];
        owner.renderer.contextNode = context();
        owner.renderer.lighting = new Lighting();
        owner.renderer.setMRT(createMrt({}));
        owner.renderer.setRenderObjectFunction((): void => {});
        scene.name = 'prepass';
        scene.overrideMaterial = mesh.material;
        scene.background = new Color();
        camera.layers.set(1);
        owner.ctx.viewCamera.layers.set(3);
        throw Error('injected draw failure');
      },
    },
    complete.testGraph()
  );
  const warm = owner._warmGraph();
  fireFrame();
  await assert.rejects(warm, /injected draw failure/);
  assert(failed instanceof Error);
  assert.match(failed.message, /injected draw failure/);
  assert.deepEqual(camera.view, view, 'restore original camera sub-frustum on failure');
  assert(camera.projectionMatrix.equals(projection));
  assert.equal(mesh.visible, false);
  assert.deepEqual(mesh.geometry.drawRange, { start: 2, count: 12 });
  assert(passes.every((p): boolean => p.opaque && !p.transparent));
  assert.equal(target, originalTarget);
  assert.equal(alpha, 0.4);
  assert.equal(clear.r, 0.1);
  assert.equal(owner.renderer.toneMapping, 4);
  assert.equal(owner.renderer.outputColorSpace, 'original');
  assert.equal(owner.renderer.xr.enabled, true);
  assert.equal(callbacks.size, 0);
  assert.equal(owner.ctx.time.frame, 42);
  assert.equal(mrt, originalMrt);
  assert.equal(renderObject, originalRenderObject);
  for (const key of [...booleanRendererKeys, 'lighting', 'contextNode'] as const)
    assert.equal(owner.renderer[key], rendererProps[key], `restore ${key}`);
  assert.equal(camera.layers.mask, 1);
  assert.equal(owner.ctx.viewCamera.layers.mask, 1);
  assert.equal(scene.name, '');
  assert.equal(scene.overrideMaterial, null);
  assert.equal(scene.background, null);
  assert.equal(owner.renderer.shadowMap.enabled, true);
  mesh.geometry.dispose();
  mesh.material.dispose();
} finally {
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
}

// Explicit fixed-target readback layout, including a wrong layout that would
// pass the old inferred-integer-stride test. Last valid exposure is not reset.
let pixels: Uint16Array | Float32Array = new Uint16Array(64 * 64 * 4),
  target: RenderTarget | null = null,
  warnings = 0;
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = DataUtils.toHalfFloat(-1);
  pixels[i + 1] = DataUtils.toHalfFloat(1);
}
const renderer = fixture<Renderer>(
  {
    xr: fixture<Renderer['xr']>({ enabled: false }, complete.testRenderer().xr),
    toneMapping: 0,
    outputColorSpace: 'srgb-linear',
    getRenderTarget: (): RenderTarget | null => target,
    setRenderTarget: (t): void => {
      target = t;
    },
    render(): void {},
    async readRenderTargetPixelsAsync(): Promise<Uint16Array | Float32Array> {
      return pixels;
    },
  },
  complete.testRenderer()
);
const meter = createHdrMeter(renderer, new Texture(), new Texture()),
  warn = console.warn;
try {
  assert.equal(await meter.sample(), 0.5);
  console.warn = (): void => {
    warnings++;
  };
  pixels = new Uint16Array(256 + 63 * 512);
  assert.equal(await meter.sample(), null);
  pixels = new Float32Array(64 * 64 * 4);
  assert.equal(await meter.sample(), null);
  assert.equal(warnings, 1);
  assert.equal(target, null);
} finally {
  console.warn = warn;
  meter.dispose();
}
console.log(
  'teardown isolation, bounded/cancelled warmup, jitter restoration and meter layout passed'
);
