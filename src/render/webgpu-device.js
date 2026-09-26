import { Renderer, WebGPUBackend, StandardNodeLibrary } from 'three/webgpu';

/**
 * Use Three's public WebGPU backend directly: WebGPURenderer would install an
 * automatic WebGL2 fallback. Initialize before materials or the game loop.
 */
export async function createWebGpuRenderer(canvas) {
  if (!globalThis.navigator?.gpu) {
    throw new Error('WebGPU is required to play. Use a WebGPU-capable browser and device.');
  }

  const parameters = {
    canvas, alpha: false, depth: true, stencil: false, antialias: false,
    powerPreference: 'high-performance',
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
  return renderer;
}
