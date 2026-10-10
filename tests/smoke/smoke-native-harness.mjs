import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { runInThisContext } from 'node:vm';
import { launchChromium } from '../../tools/lib/browser-harness.mjs';
import { waitForGame, verifyNative, captureNative } from '../../tools/lib/native-render.mjs';

// Exercise launcher options without requiring a GPU/browser on CPU CI.
const launch = chromium.launch;
chromium.launch = async options => options;
try {
  const native = await launchChromium({ headless: true, args: ['--mute-audio'] });
  assert(native.args.includes('--enable-unsafe-webgpu'));
  if (process.platform === 'linux') assert(native.args.includes('--enable-features=Vulkan'));
  assert(native.args.includes('--mute-audio'));
  const legacy = await launchChromium({ webgpu: false });
  assert(!legacy.args.includes('--enable-unsafe-webgpu'));
} finally { chromium.launch = launch; }

let dialog = null;
globalThis.document = { getElementById: () => dialog };
globalThis.window = { __READY__: false };
const page = {
  async waitForFunction(predicate) { assert(predicate(), 'readiness must observe the boot failure immediately'); },
  async evaluate(fn, arg) { return typeof fn === 'string' ? runInThisContext(fn) : fn(arg); },
};
try {
  dialog = { textContent: 'BOOT FAILURE: Unable to create WebGPU adapter' };
  await assert.rejects(waitForGame(page), /Unable to create WebGPU adapter/);
  window.__READY__ = true; // A late error must not be mistaken for readiness.
  await assert.rejects(waitForGame(page), /BOOT FAILURE/);
  dialog = null;
  window.__ENGINE__ = { ctx: { get: () => ({ renderer: {
    backend: { isWebGPUBackend: false }, debug: {},
  } }) } };
  await assert.rejects(waitForGame(page), /native WebGPU required/);
  const debug = { onNodeBuilderCreated: function () { assert.equal(this, debug); return 42; } };
  const previous = debug.onNodeBuilderCreated, renderer = {
    backend: { isWebGPUBackend: true, device: { adapterInfo: {
      vendor: 'amd', architecture: 'rdna-4', isFallbackAdapter: false,
    } } }, debug,
  };
  window.__ENGINE__.ctx.get = () => ({ renderer });
  const builds = [{ object: { name: 'mesh' } }, { material: { name: 'test' } }];
  await verifyNative(page); assert.equal(debug.onNodeBuilderCreated(...builds), 42);
  assert.equal(window.__NATIVE_BUILDS__, 1); assert.equal(window.__NATIVE_BUILD_INFO__.length, 1);
  const first = window.__NATIVE_BUILD_OBSERVER__;
  await verifyNative(page); assert.equal(debug.onNodeBuilderCreated(...builds), 42);
  assert.equal(window.__NATIVE_BUILDS__, 1, 're-verification must not double-count');
  assert.equal(first?.count, 1, 're-verification disposes the old observer');
  assert.equal(window.__NATIVE_BUILD_INFO__.length, 1);
  window.__NATIVE_BUILD_OBSERVER__.dispose();
  assert.equal(debug.onNodeBuilderCreated, previous);

  // The serialized capture works without dev module URLs. Check restoration
  // and blank/malformed guards, including rejected readback and screenshot.
  let target = {}, face = 2, mip = 3, disposed = 0, removed = 0, shotError = false, readError = false;
  let pixels = new Uint8Array(9 * 5 * 4).fill(80);
  const saved = target;
  class Target { dispose() { disposed++; } }
  Object.assign(renderer, {
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(t, f = 0, m = 0) { target = t; face = f; mip = m; },
    async readRenderTargetPixelsAsync() { if (readError) throw Error('read failure'); return pixels; },
  });
  window.__ENGINE__.ctx.get = () => ({ renderer, screenSize: { width: 9, height: 5 },
    viewRt: new Target(), _graph: { render() {} } });
  globalThis.ImageData = class { constructor(data) { assert.deepEqual(Array.from(data), Array.from(pixels)); } };
  document.createElement = () => ({ style: {}, getContext: () => ({ putImageData() {} }) });
  document.body = { append() {} };
  document.getElementById = () => ({ remove() { removed++; } });
  page.screenshot = async () => { if (shotError) throw Error('shot failure'); };
  await captureNative(page, '/tmp/unused.png');
  shotError = true; await assert.rejects(captureNative(page, '/tmp/unused.png'), /shot failure/);
  shotError = false; readError = true; await assert.rejects(captureNative(page, '/tmp/unused.png'), /read failure/);
  readError = false; pixels = new Uint8Array(9 * 5 * 4);
  await assert.rejects(captureNative(page, '/tmp/unused.png'), /blank native capture/);
  pixels = new Uint8Array(256 * 5);
  await assert.rejects(captureNative(page, '/tmp/unused.png'), /invalid packed readback/);
  assert.equal(target, saved); assert.equal(face, 2); assert.equal(mip, 3);
  assert.equal(disposed, 5); assert.equal(removed, 2, 'overlay removed on successful/failed screenshot');
} finally { delete globalThis.document; delete globalThis.window; delete globalThis.ImageData; }
console.log('native default, legacy opt-out and actionable readiness failures passed');
