import { Renderer, WebGPUBackend, StandardNodeLibrary } from 'three/webgpu';

/**
 * Construct Three's standard WebGPU node renderer without WebGPURenderer's
 * automatic WebGL2 fallback. All three types are public `three/webgpu` exports;
 * no backend replacement, private-field override or WebGL context is involved.
 * Call this before initializing materials or starting the game loop.
 */
export async function createWebGpuRenderer(canvas, { trackTimestamp = false } = {}) {
  if (!globalThis.navigator?.gpu) {
    throw new Error('WebGPU is required to play. Use a WebGPU-capable browser and device.');
  }

  const parameters = {
    canvas, alpha: false, depth: true, stencil: false, antialias: false,
    powerPreference: 'high-performance', trackTimestamp,
  };
  const renderer = new Renderer(new WebGPUBackend(parameters), parameters);
  renderer.library = new StandardNodeLibrary();
  try {
    await renderer.init();
  } catch (error) {
    // No WebGL fallback was registered; failed device initialization cannot
    // enter gameplay or construct a WebGL context.
    throw new Error(`WebGPU initialization failed: ${error.message}`, { cause: error });
  }
  if (!renderer.backend.isWebGPUBackend) {
    renderer.dispose();
    throw new Error('A WebGPU backend is required.');
  }
  return renderer;
}
