import assert from 'node:assert/strict';

import type { Renderer, Backend } from 'three/webgpu';

import { MaterialSystem } from '../../src/materials/index.ts';
import { fixture } from '../lib/fixture.ts';

// Stable flags, not class names or the convenience renderer's fallback API.
for (const renderer of [
  { backend: { constructor: fixture<Function>({ name: 'WebGPUBackend' }) } },
  { isWebGPURenderer: true, backend: { isWebGLBackend: true } },
]) {
  await assert.rejects(
    (): Promise<void> =>
      new MaterialSystem({
        renderer: fixture<Renderer>({
          ...renderer,
          backend: fixture<Backend & { isWebGPUBackend?: boolean; isWebGLBackend?: boolean }>(
            renderer.backend,
            ['isWebGPUBackend']
          ),
        }),
      }).init({}),
    /WebGPU renderer required/
  );
}
const accepted = new Error('native backend accepted; stop before GPU baking');
const renderer = {
  backend: { isWebGPUBackend: true, constructor: fixture<Function>({ name: 'minified' }) },
  getRenderTarget(): never {
    throw accepted;
  },
};
await assert.rejects(
  (): Promise<void> =>
    new MaterialSystem({
      renderer: fixture<Renderer>({
        ...renderer,
        backend: fixture<Backend & { isWebGPUBackend?: boolean; isWebGLBackend?: boolean }>(
          renderer.backend
        ),
      }),
    }).init({}),
  (error: unknown): boolean => error === accepted,
  'minification must not reject a native backend'
);
console.log('native material backend guard is minification-safe and rejects fallback');
