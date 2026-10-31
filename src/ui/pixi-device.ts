import { DOMAdapter } from 'pixi.js';
import type { WebGPURenderer } from 'pixi.js';
import type { Renderer } from 'three/webgpu';

/** One opt-in Pixi instance at a time. Restore even if its constructor fails. */
export function restrictPixiCanvases(): () => void {
  const adapter = DOMAdapter.get();
  DOMAdapter.set({
    ...adapter,
    createCanvas: (...size): ReturnType<typeof adapter.createCanvas> => {
      const canvas = adapter.createCanvas(...size);
      canvas.getContext = new Proxy(canvas.getContext.bind(canvas), {
        apply(target, context, args): unknown {
          if (typeof args[0] === 'string' && /^(experimental-)?webgl/.test(args[0])) return null;
          return Reflect.apply(target, context, args);
        },
      });
      return canvas;
    },
  });
  return (): void => DOMAdapter.set(adapter);
}

export async function initPixiRenderer(
  renderer: WebGPURenderer,
  game: Renderer,
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): Promise<void> {
  const backend = game.backend;
  if (!('device' in backend) || !(backend.device instanceof GPUDevice))
    throw new Error('The Pixi experiment requires the initialized WebGPU device');
  // Three does not retain its adapter; this queries metadata, not a new device.
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || adapter.info.vendor !== backend.device.adapterInfo.vendor)
    throw new Error('Could not query matching adapter metadata for Pixi');
  await renderer.init({
    canvas,
    gpu: { adapter, device: backend.device },
    width,
    height,
    resolution: Math.min(devicePixelRatio || 1, 2),
    autoDensity: true,
    antialias: true,
    backgroundAlpha: 0,
  });
}
