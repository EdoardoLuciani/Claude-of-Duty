import assert from 'node:assert/strict';
import { MaterialSystem } from '../../src/materials/index.js';

// Stable flags, not class names or the convenience renderer's fallback API.
for (const renderer of [
  { backend: { constructor: { name: 'WebGPUBackend' } } },
  { isWebGPURenderer: true, backend: { isWebGLBackend: true } },
]) {
  await assert.rejects(() => new MaterialSystem({ renderer }).init({}), /WebGPU renderer required/);
}
const accepted = new Error('native backend accepted; stop before GPU baking');
const renderer = {
  backend: { isWebGPUBackend: true, constructor: { name: 'minified' } },
  getRenderTarget() { throw accepted; },
};
await assert.rejects(() => new MaterialSystem({ renderer }).init({}), error => error === accepted,
  'minification must not reject a native backend');
console.log('native material backend guard is minification-safe and rejects fallback');
