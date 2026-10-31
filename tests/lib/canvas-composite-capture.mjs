// Capture-only actual final swapchain readback, never part of timed/runtime work.
export async function captureCompositedCanvas(page, path) {
  await page.evaluate(async () => {
    const e = window.__ENGINE__,
      r = e.ctx.get('render'),
      device = r.renderer.backend.device;
    r.render(e.ctx);
    const texture = e.canvas.getContext('webgpu').getCurrentTexture();
    const width = texture.width,
      height = texture.height,
      bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height });
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const raw = new Uint8Array(buffer.getMappedRange()),
        rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        rgba.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
      if (texture.format.startsWith('bgra'))
        for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
      const overlay = document.createElement('canvas');
      overlay.id = 'native-test-capture';
      overlay.width = width;
      overlay.height = height;
      overlay.style.cssText =
        'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;pointer-events:none';
      overlay.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
      document.body.append(overlay);
    } finally {
      buffer.destroy();
    }
  });
  try {
    await page.screenshot({ path });
  } finally {
    await page.evaluate(() => document.getElementById('native-test-capture')?.remove());
  }
}
