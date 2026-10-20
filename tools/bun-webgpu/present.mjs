// Public @kmamal/gpu window API. Explicit non-sRGB format preserves #476's
// shader gamma encoding; Immediate is required, never a FIFO fallback.
export function createPresentation(gpu, device, window) {
  const surface = gpu.renderGPUDeviceToWindow({
    device,
    window,
    presentMode: 'immediate',
    format: 'bgra8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const format = surface.getPreferredFormat();
  if (format !== 'bgra8unorm') throw Error(`unexpected surface format: ${format}`);
  let current;
  return {
    format,
    view() {
      current = surface.getCurrentTexture();
      return current.createView();
    },
    texture: () => current,
    swap: () => surface.swap(),
  };
}
