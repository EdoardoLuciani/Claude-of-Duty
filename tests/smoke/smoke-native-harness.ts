import assert from 'node:assert/strict';
import { runInThisContext } from 'node:vm';

import { chromium, type LaunchOptions } from 'playwright';

import { launchChromium } from '../../tools/lib/browser-harness.ts';
import { waitForGame, verifyNative, captureNative } from '../../tools/lib/native-render.ts';
import { captureMethod } from '../lib/render-fixture.ts';

// Exercise launcher options without requiring a GPU/browser on CPU CI.
const launch = captureMethod(chromium, 'launch');
let launched: LaunchOptions = {};
const launchObserved = new Error('launch observed');
chromium.launch = async (options): Promise<never> => {
  launched = options ?? {};
  throw launchObserved;
};
try {
  await assert.rejects(
    launchChromium({ headless: true, args: ['--mute-audio'] }),
    (error: unknown): boolean => error === launchObserved
  );
  const native = launched;
  assert(native.args);
  assert(native.args.includes('--enable-unsafe-webgpu'));
  if (process.platform === 'linux') assert(native.args.includes('--enable-features=Vulkan'));
  assert(native.args.includes('--mute-audio'));
} finally {
  chromium.launch = launch;
}

let dialog: { textContent?: string; remove?(): void } | null = null;
const documentStub = {
  getElementById: (): typeof dialog => dialog,
  createElement: (): { style: object; getContext(): { putImageData(): void } } => ({
    style: {},
    getContext: (): { putImageData(): void } => ({ putImageData(): void {} }),
  }),
  body: { append(): void {} },
};
interface NativeObservation {
  count: number | null;
  dispose(): void;
}
const nativeWindow: {
  __READY__: boolean;
  __ENGINE__?: { ctx: { get(): object } };
  __NATIVE_BUILDS__: number;
  __NATIVE_BUILD_INFO__: object[];
  __NATIVE_BUILD_OBSERVER__?: NativeObservation;
} = { __READY__: false, __NATIVE_BUILDS__: 0, __NATIVE_BUILD_INFO__: [] };
Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
Object.defineProperty(globalThis, 'window', { configurable: true, value: nativeWindow });
const page = {
  async waitForFunction(predicate: () => boolean): Promise<void> {
    assert(predicate(), 'readiness must observe the boot failure immediately');
  },
  async evaluate(fn: string | (() => unknown)): Promise<unknown> {
    const result: unknown = typeof fn === 'string' ? runInThisContext(fn) : fn();
    return result;
  },
  async screenshot(): Promise<Buffer> {
    if (shotError) throw Error('shot failure');
    return Buffer.alloc(0);
  },
};
let shotError = false;
try {
  dialog = { textContent: 'BOOT FAILURE: Unable to create WebGPU adapter' };
  await assert.rejects(waitForGame(page), /Unable to create WebGPU adapter/);
  nativeWindow.__READY__ = true; // A late error must not be mistaken for readiness.
  await assert.rejects(waitForGame(page), /BOOT FAILURE/);
  dialog = null;
  nativeWindow.__ENGINE__ = {
    ctx: {
      get: (): object => ({
        renderer: {
          backend: { isWebGPUBackend: false },
          debug: {},
        },
      }),
    },
  };
  await assert.rejects(waitForGame(page), /native WebGPU required/);
  const debug = {
    onNodeBuilderCreated: function (...args: unknown[]): number {
      assert.equal(args.length, 2);
      assert.equal(this, debug);
      return 42;
    },
  };
  const previous = captureMethod(debug, 'onNodeBuilderCreated'),
    renderer = {
      backend: {
        isWebGPUBackend: true,
        device: {
          adapterInfo: {
            vendor: 'amd',
            architecture: 'rdna-4',
            isFallbackAdapter: false,
          },
        },
      },
      debug,
    };
  nativeWindow.__ENGINE__!.ctx.get = (): object => ({ renderer });
  const builds: [{ object: { name: string } }, { material: { name: string } }] = [
    { object: { name: 'mesh' } },
    { material: { name: 'test' } },
  ];
  await verifyNative(page);
  assert.equal(debug.onNodeBuilderCreated(...builds), 42);
  assert.equal(nativeWindow.__NATIVE_BUILDS__, 1);
  assert.equal(nativeWindow.__NATIVE_BUILD_INFO__.length, 1);
  const first = nativeWindow.__NATIVE_BUILD_OBSERVER__;
  await verifyNative(page);
  assert.equal(debug.onNodeBuilderCreated(...builds), 42);
  assert.equal(nativeWindow.__NATIVE_BUILDS__, 1, 're-verification must not double-count');
  assert.equal(first?.count, 1, 're-verification disposes the old observer');
  assert.equal(nativeWindow.__NATIVE_BUILD_INFO__.length, 1);
  nativeWindow.__NATIVE_BUILD_OBSERVER__!.dispose();
  assert.equal(captureMethod(debug, 'onNodeBuilderCreated'), previous);

  // The serialized capture works without dev module URLs. Check restoration
  // and blank/malformed guards, including rejected readback and screenshot.
  let target: object | null = {},
    face = 2,
    mip = 3,
    disposed = 0,
    removed = 0,
    readError = false;
  let pixels = new Uint8Array(9 * 5 * 4).fill(80);
  const saved = target;
  class Target {
    dispose(): void {
      disposed++;
    }
  }
  const captureRenderer = {
    ...renderer,
    getRenderTarget: (): object | null => target,
    getActiveCubeFace: (): number => face,
    getActiveMipmapLevel: (): number => mip,
    setRenderTarget(t: object | null, f = 0, m = 0): void {
      target = t;
      face = f;
      mip = m;
    },
    async readRenderTargetPixelsAsync(): Promise<Uint8Array> {
      if (readError) throw Error('read failure');
      return pixels;
    },
  };
  nativeWindow.__ENGINE__!.ctx.get = (): object => ({
    renderer: captureRenderer,
    screenSize: { width: 9, height: 5 },
    viewRt: new Target(),
    _graph: { render(): void {} },
  });
  Object.defineProperty(globalThis, 'ImageData', {
    configurable: true,
    value: class {
      constructor(data: Uint8ClampedArray) {
        assert.deepEqual(Array.from(data), Array.from(pixels));
      }
    },
  });
  documentStub.getElementById = (): typeof dialog => ({
    remove(): void {
      removed++;
    },
  });
  await captureNative(page, '/tmp/unused.png');
  shotError = true;
  await assert.rejects(captureNative(page, '/tmp/unused.png'), /shot failure/);
  shotError = false;
  readError = true;
  await assert.rejects(captureNative(page, '/tmp/unused.png'), /read failure/);
  readError = false;
  pixels = new Uint8Array(9 * 5 * 4);
  await assert.rejects(captureNative(page, '/tmp/unused.png'), /blank native capture/);
  pixels = new Uint8Array(256 * 5);
  await assert.rejects(captureNative(page, '/tmp/unused.png'), /invalid packed readback/);
  assert.equal(target, saved);
  assert.equal(face, 2);
  assert.equal(mip, 3);
  assert.equal(disposed, 5);
  assert.equal(removed, 2, 'overlay removed on successful/failed screenshot');
} finally {
  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'ImageData');
}
console.log('native default and actionable readiness failures passed');
