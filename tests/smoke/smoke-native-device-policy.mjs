import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { collectBrowserErrors } from '../../tools/lib/browser-harness.mjs';
import { assertHardwareDevice, verifyPreviewNative } from '../../tools/lib/native-render.mjs';

for (const vendor of ['intel', 'nvidia', 'amd', 'apple']) {
  const device = { vendor, architecture: 'test', fallback: false };
  assert.equal(assertHardwareDevice(device, ''), device, 'correctness is not vendor-specific');
  assert.throws(() => assertHardwareDevice({ ...device, fallback: true }, ''), /hardware WebGPU/);
  assert.throws(() => assertHardwareDevice(device, '1002:7550!'), /explicitly selected AMD/);
}
assertHardwareDevice({ vendor: 'amd', architecture: 'rdna-4', fallback: false }, '1002:7550!');
assert.throws(
  () => assertHardwareDevice({ vendor: 'amd', architecture: 'rdna-4', fallback: true }, ''),
  /hardware WebGPU/
);
assert.throws(
  () => assertHardwareDevice({ vendor: 'intel', architecture: 'test' }, ''),
  /hardware WebGPU/
);

const previous = globalThis.window;
try {
  const adapterInfo = { vendor: 'amd', architecture: 'rdna-4', isFallbackAdapter: false };
  const backend = { isWebGPUBackend: true, device: { adapterInfo } };
  globalThis.window = { __PREVIEW_RENDERER__: { backend } };
  const page = { evaluate: (fn) => fn() };
  assert.deepEqual(await verifyPreviewNative(page), {
    vendor: 'amd',
    architecture: 'rdna-4',
    fallback: false,
  });
  backend.isWebGPUBackend = false;
  await assert.rejects(verifyPreviewNative(page), /native WebGPU required/);
  backend.isWebGPUBackend = true;
  adapterInfo.isFallbackAdapter = true;
  await assert.rejects(verifyPreviewNative(page), /hardware WebGPU/);
} finally {
  globalThis.window = previous;
}
// Shared plumbing preserves the preview's stricter message gate, while other
// analytic fixtures may retain their separately reported informational warnings.
for (const validationMessages of [false, true]) {
  const page = new EventEmitter(),
    errors = [],
    warnings = [];
  collectBrowserErrors(page, errors, { warnings, validationMessages });
  page.emit('pageerror', new Error('page failure'));
  page.emit('console', { type: () => 'error', text: () => 'console failure' });
  page.emit('console', { type: () => 'warning', text: () => 'THREE.TSL: diagnostic' });
  assert.deepEqual(
    errors,
    validationMessages
      ? ['page failure', 'console failure', 'THREE.TSL: diagnostic']
      : ['page failure', 'console failure']
  );
  assert.deepEqual(warnings, ['THREE.TSL: diagnostic']);
}
console.log('native adapter and shared browser-error policies passed');
