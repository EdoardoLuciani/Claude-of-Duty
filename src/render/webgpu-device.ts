import { Renderer, WebGPUBackend, StandardNodeLibrary } from 'three/webgpu';

/**
 * Use Three's public WebGPU backend directly: WebGPURenderer would install an
 * automatic WebGL2 fallback. Initialize before materials or the game loop.
 */
export async function createWebGpuRenderer(canvas: HTMLCanvasElement, onDeviceLost?: (error: Error) => void): Promise<Renderer> {
  if (!globalThis.navigator?.gpu) {
    throw new Error('WebGPU is required to play. Use a WebGPU-capable browser and device.');
  }

  const parameters = {
    canvas, alpha: false, depth: true, stencil: false, antialias: false,
    powerPreference: 'high-performance' as const,
  };
  const renderer = new Renderer(new WebGPUBackend(parameters), parameters);
  renderer.library = new StandardNodeLibrary();
  let lost = null;
  const defaultDeviceLost = renderer.onDeviceLost;
  renderer.onDeviceLost = info => {
    if (info.reason === 'destroyed') return; // Explicit disposal is not a failure.
    defaultDeviceLost.call(renderer, info); // Preserve Three's lost-device state.
    lost = new Error(`WebGPU device lost (${info.reason}): ${info.message ?? 'unknown GPU error'}`);
    onDeviceLost?.(lost);
  };
  try {
    await renderer.init();
    if (lost) throw lost;
  } catch (error) {
    // No WebGL fallback was registered; failed device initialization cannot
    // enter gameplay or construct a WebGL context.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`WebGPU initialization failed: ${message}`, { cause: error });
  }
  return renderer;
}
