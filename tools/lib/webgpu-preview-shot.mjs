import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

/** Offscreen WebGPU readback: Chromium headless screenshots may show a black canvas. */
export async function capturePreview(page, path) {
  const image = await page.evaluate(async () => {
    const renderer = window.__PREVIEW_RENDERER__;
    const { RenderTarget, SRGBColorSpace } = await import('/node_modules/.vite/deps/three_webgpu.js');
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const target = new RenderTarget(w, h);
    target.texture.colorSpace = SRGBColorSpace;
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      window.__PREVIEW_DRAW__();
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h);
      return { width: w, height: h, pixels: Array.from(pixels) };
    } finally {
      renderer.setRenderTarget(previous ?? null);
      target.dispose();
    }
  });
  const { width: w, height: h, pixels } = image;
  const stride = (pixels.length - w * 4) / Math.max(1, h - 1);
  if (!Number.isInteger(stride) || stride < w * 4) throw new Error('Bad WebGPU readback stride');
  const png = new PNG({ width: w, height: h });
  let lit = 0;
  for (let y = 0; y < h; y++) for (let i = 0; i < w * 4; i++) {
    const value = pixels[y * stride + i];
    png.data[y * w * 4 + i] = value;
    if (i % 4 !== 3 && value > 20) lit++;
  }
  if (lit < w * h * 0.01) throw new Error('WebGPU preview is blank');
  writeFileSync(path, PNG.sync.write(png));
}
