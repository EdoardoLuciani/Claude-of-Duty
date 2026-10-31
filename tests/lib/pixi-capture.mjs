import { captureNative } from '../../tools/lib/native-render.mjs';

/** Read back the real Pixi target before DOM composition (headless Vulkan can
 * present blank swapchains). Capture-only copies never enter runtime code. */
export async function capturePixi(page, path, kind = 'panel') {
  await page.evaluate(async (kind) => {
    const ui = window.__ENGINE__.ctx.get('ui');
    const p = kind === 'hud' ? ui.pixiHud : kind === 'ammo' ? ui.ammo.pixi : ui.pixiExperiment;
    const r = p.renderer;
    const texture = r.textureGenerator.generateTexture({
      target: p.stage,
      ...(kind === 'hud' ? { frame: r.screen.clone() } : {}),
      resolution: r.resolution,
    });
    const source = r.texture.getGpuSource(texture.source),
      device = r.gpu.device;
    const width = source.width,
      height = source.height,
      bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: source }, { buffer, bytesPerRow }, { width, height });
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const raw = new Uint8Array(buffer.getMappedRange()),
        rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        rgba.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
      if (source.format.startsWith('bgra'))
        for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
      const overlay = document.createElement('canvas'),
        parent = p.canvas.parentElement;
      const position = parent.style.position;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      overlay.width = width;
      overlay.height = height;
      overlay.style.cssText = `position:absolute;left:${p.canvas.offsetLeft}px;top:${p.canvas.offsetTop}px;width:${p.canvas.clientWidth}px;height:${p.canvas.clientHeight}px;pointer-events:none`;
      overlay.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
      overlay.style.opacity = p.canvas.style.opacity;
      overlay.style.visibility = p.canvas.style.visibility;
      parent.insertBefore(overlay, p.canvas.nextSibling);
      window.__PIXI_CAPTURE__ = { overlay, parent, position };
    } finally {
      buffer.destroy();
      texture.destroy(true);
    }
  }, kind);
  try {
    await captureNative(page, path);
  } finally {
    await page.evaluate(() => {
      const c = window.__PIXI_CAPTURE__;
      c?.overlay.remove();
      if (c) c.parent.style.position = c.position;
      delete window.__PIXI_CAPTURE__;
    });
  }
}
