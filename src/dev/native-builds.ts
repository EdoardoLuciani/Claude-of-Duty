import type { Renderer } from 'three/webgpu';
import type { NodeBuilder } from 'three/webgpu';

// Diagnostic node-builder activity, NOT GPU pipeline compilation or GPU time.
// Preserve existing observers; a disposed observer is inert even if another
// wrapper still holds it. Only restore the callback when we still own it.
export function trackNodeBuilders(
  renderer: Renderer | null | undefined,
  { onBuild }: { onBuild?: (builder: NodeBuilder, object: unknown) => unknown } = {}
) {
  const supported =
    !!renderer?.backend &&
    'isWebGPUBackend' in renderer.backend &&
    renderer.backend.isWebGPUBackend === true &&
    !!renderer.debug;
  let count: number | null = supported ? 0 : null;
  let active = true;
  const previous = renderer?.debug?.onNodeBuilderCreated ?? null;
  function observe(this: unknown, builder: NodeBuilder, object: unknown): unknown {
    if (active && count !== null) count++;
    const result = previous?.call(this, builder, object);
    if (active) onBuild?.call(this, builder, object);
    return result;
  }
  if (supported) renderer.debug.onNodeBuilderCreated = observe;
  return {
    get count() {
      return count;
    },
    dispose() {
      active = false;
      if (supported && renderer.debug.onNodeBuilderCreated === observe)
        renderer.debug.onNodeBuilderCreated = previous;
    },
  };
}
