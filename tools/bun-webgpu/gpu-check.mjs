// Optional hardware integration negative: prove uncaptured validation errors
// actually reach the public listener. Not a throughput measurement.
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';

import gpu from '@kmamal/gpu';
globalThis.navigator ??= {};
globalThis.navigator.gpu = gpu.create(['backend=vulkan']);
let device;
try {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  assert(adapter && !adapter.info.isFallbackAdapter, 'hardware adapter required');
  device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  const b = device.createBuffer({ size: 16, usage: gpu.GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 2, new Uint32Array([1])); // deliberately misaligned
  await device.queue.onSubmittedWorkDone();
  await turn();
  assert.equal(errors.length, 1, 'validation callback must not silently disappear');
  assert.match(errors[0], /offset|align|multiple/i);
  b.destroy();
  console.log('Expected invalid write rejected; public error callback verified.');
} finally {
  device?.destroy();
  await turn();
  delete navigator.gpu;
}
