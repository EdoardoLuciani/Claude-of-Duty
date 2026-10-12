import assert from 'node:assert/strict';
import { assertHardwareDevice, verifyPreviewNative } from '../../tools/lib/native-render.mjs';

for (const vendor of ['intel', 'nvidia', 'amd', 'apple']) {
  const device = { vendor, architecture: 'test', fallback: false };
  assert.equal(assertHardwareDevice(device, ''), device, 'correctness is not vendor-specific');
  assert.throws(() => assertHardwareDevice({ ...device, fallback: true }, ''), /hardware WebGPU/);
  assert.throws(() => assertHardwareDevice(device, '1002:7550!'), /deep-equal/);
}
assertHardwareDevice({ vendor: 'amd', architecture: 'rdna-4', fallback: false }, '1002:7550!');
assert.throws(() => assertHardwareDevice({ vendor: 'amd', architecture: 'rdna-4', fallback: true }, ''), /hardware WebGPU/);
assert.throws(() => assertHardwareDevice({ vendor: 'intel', architecture: 'test' }, ''), /hardware WebGPU/);

const previous = globalThis.window;
try {
  const adapterInfo = { vendor: 'amd', architecture: 'rdna-4', isFallbackAdapter: false };
  const backend = { isWebGPUBackend: true, device: { adapterInfo } };
  globalThis.window = { __PREVIEW_RENDERER__: { backend } };
  const page = { evaluate: fn => fn() };
  assert.deepEqual(await verifyPreviewNative(page), { vendor: 'amd', architecture: 'rdna-4', fallback: false });
  backend.isWebGPUBackend = false;
  await assert.rejects(verifyPreviewNative(page), /native WebGPU required/);
  backend.isWebGPUBackend = true; adapterInfo.isFallbackAdapter = true;
  await assert.rejects(verifyPreviewNative(page), /hardware WebGPU/);
} finally {
  globalThis.window = previous;
}
console.log('native adapter policy: hardware required, exact AMD adapter opt-in; preview shares policy');
