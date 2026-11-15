import assert from 'node:assert/strict';

import { RenderTarget, type Renderer, type Backend } from 'three/webgpu';

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

// Detail draws complete before the macro draw fails: the material owner must
// release those targets as well as the macro helper's own failed target.
const macroFailure = new Error('macro draw failed');
const targets = new Set<import('three/webgpu').RenderTarget>();
const disposed = new Map<import('three/webgpu').RenderTarget, number>();
const previous = new RenderTarget(1, 1);
let current: RenderTarget | null = previous;
let draws = 0;
const materials = new MaterialSystem({
  renderer: fixture<Renderer>({
    backend: fixture<Backend & { isWebGPUBackend: boolean }>({ isWebGPUBackend: true }),
    getRenderTarget: (): import('three/webgpu').RenderTarget | null => current,
    setRenderTarget(target): void {
      current = target;
      if (!target || target === previous || targets.has(target)) return;
      targets.add(target);
      target.addEventListener('dispose', (): void => {
        disposed.set(target, (disposed.get(target) ?? 0) + 1);
      });
    },
    render(): void {
      if (++draws === 4) throw macroFailure;
    },
  }),
});
await assert.rejects(materials.init({}), (error: unknown): boolean => error === macroFailure);
assert.equal(draws, 4);
assert.equal(current, previous, 'restore the previous render target');
assert.equal(targets.size, 4, 'height scratch, completed detail pair and failed macro');
assert.equal(disposed.size, 4, 'release every successful and failed allocation');
materials.dispose();
assert([...disposed.values()].every((count): boolean => count === 1));
console.log(
  'failed macro bake releases completed detail targets and preserves its original failure'
);
