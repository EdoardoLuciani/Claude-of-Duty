import assert from 'node:assert/strict';
import { createWebGpuRenderer } from '../src/render/webgpu-device.js';

let webglRequests = 0;
const canvas = { getContext(type) {
  if (type.startsWith('webgl')) webglRequests++;
  throw new Error(`Unexpected context: ${type}`);
} };

await assert.rejects(createWebGpuRenderer(canvas), /WebGPU is required/);
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, value: { gpu: { requestAdapter: async () => null } },
});
await assert.rejects(createWebGpuRenderer(canvas), /Unable to create WebGPU adapter/);
assert.equal(webglRequests, 0, 'unsupported devices must never try WebGL');
console.log('webgpu-device: unsupported and adapter failure never try WebGL');
