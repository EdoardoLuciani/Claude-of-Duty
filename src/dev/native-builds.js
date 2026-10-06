// Diagnostic node-builder activity, NOT GPU pipeline compilation or GPU time.
// Preserve existing observers; a disposed observer is inert even if another
// wrapper still holds it. Only restore the callback when we still own it.
export function trackNodeBuilders(renderer) {
  const supported = !!renderer?.backend?.isWebGPUBackend && !!renderer.debug;
  let count = supported ? 0 : null;
  let active = true;
  const previous = renderer?.debug?.onNodeBuilderCreated;
  function observe(...args) {
    if (active) count++;
    return previous?.apply(this, args);
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
