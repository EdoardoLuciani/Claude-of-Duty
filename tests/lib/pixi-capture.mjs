import { captureNative } from '../../tools/lib/native-render.mjs';

/** Read back the real Pixi target before DOM composition (headless Vulkan can
 * present blank swapchains). Capture-only copies never enter runtime code. */
export async function capturePixi(page, path, kind = 'panel') {
  const readback = await page.evaluate(async (kind) => {
    const ui = window.__ENGINE__.ctx.get('ui');
    const p = kind === 'hud' ? ui.pixiHud : kind === 'ammo' ? ui.ammo.pixi : ui.pixiExperiment;
    const r = p.renderer;
    const fullView = kind === 'hud' || kind === 'ammo';
    const texture = r.textureGenerator.generateTexture({
      target: p.stage,
      ...(fullView ? { frame: r.screen.clone() } : {}),
      resolution: r.resolution,
    });
    // generateTexture crops local bounds and overrides the root transform.
    // Replay into the full viewport with the normal root scale, so removing
    // panels cannot crop/stretch ammo captures or break resized/DPR-2 HUD shots.
    if (fullView) r.render({ container: p.stage, target: texture, clear: true });
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
      // GPU targets are premultiplied; ImageData expects straight-alpha RGB.
      for (let i = 0; i < rgba.length; i += 4) {
        const alpha = rgba[i + 3];
        if (alpha > 0 && alpha < 255) {
          rgba[i] = Math.min(255, Math.round((rgba[i] * 255) / alpha));
          rgba[i + 1] = Math.min(255, Math.round((rgba[i + 1] * 255) / alpha));
          rgba[i + 2] = Math.min(255, Math.round((rgba[i + 2] * 255) / alpha));
        }
      }
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
      if (kind === 'hud') {
        const scale = p.stage.scale.x * r.resolution;
        const alpha = (node, x, y) =>
          rgba[
            (Math.floor((node.y + y) * scale) * width + Math.floor((node.x + x) * scale)) * 4 + 3
          ];
        const ink = (node, x, y, w, h) => {
          let pixels = 0;
          for (let py = Math.floor(y * scale); py < Math.floor((y + h) * scale); py++)
            for (let px = Math.floor(x * scale); px < Math.floor((x + w) * scale); px++) {
              const ox = Math.floor(node.x * scale) + px,
                oy = Math.floor(node.y * scale) + py;
              if (rgba[(oy * width + ox) * 4 + 3] > 32) pixels++;
            }
          return pixels;
        };
        return {
          cornerAlpha: [
            rgba[3],
            rgba[(width - 1) * 4 + 3],
            rgba[(height - 1) * width * 4 + 3],
            rgba[(width * height - 1) * 4 + 3],
          ],
          panelAlpha: [alpha(p.vitals, 4, 4), alpha(p.ammo.stage, 4, 4)],
          readoutPixels: [ink(p.vitals, 12, 24, 90, 46), ink(p.ammo.stage, 12, 34, 206, 62)],
        };
      }
      return null;
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
  return readback;
}
