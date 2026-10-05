import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { launchChromium } from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';

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
  async evaluate(fn) { return fn(); },
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
} finally { delete globalThis.document; delete globalThis.window; }
console.log('native default, legacy opt-out and actionable readiness failures passed');
