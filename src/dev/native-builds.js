// Diagnostic node-builder activity, NOT GPU pipeline compilation or GPU time.
// Preserve existing observers; a disposed observer is inert even if another
// wrapper still holds it. Only restore the callback when we still own it.
export function trackNodeBuilders(renderer, { onBuild } = {}) {
  const supported = !!renderer?.backend?.isWebGPUBackend && !!renderer.debug;
  let count = supported ? 0 : null;
  let active = true;
  const previous = renderer?.debug?.onNodeBuilderCreated;
  function observe(...args) {
    if (active) count++;
    const result = previous?.apply(this, args);
    if (active) onBuild?.apply(this, args);
    return result;
  }
  if (supported) renderer.debug.onNodeBuilderCreated = observe;
  return {
    get count() { return count; },
    dispose() {
      active = false;
      if (supported && renderer.debug.onNodeBuilderCreated === observe)
        renderer.debug.onNodeBuilderCreated = previous;
    },
  };
}
