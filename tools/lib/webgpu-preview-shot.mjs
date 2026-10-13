import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { packedReadback } from './native-readback.js';

/** Offscreen WebGPU readback: Chromium headless screenshots may show a black canvas. */
export async function capturePreview(page, path) {
  const image = await page.evaluate(async () => {
    const renderer = window.__PREVIEW_RENDERER__;
    if (!renderer?.backend?.isWebGPUBackend) throw new Error('native preview renderer required');
    const { RenderTarget } = await import('/node_modules/.vite/deps/three_webgpu.js');
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const target = new RenderTarget(w, h);
    // The output pass writes display-encoded values; an sRGB attachment would encode twice.
    const previous = renderer.getRenderTarget(), output = renderer.getOutputRenderTarget();
    const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    try {
      // Ordinary render targets bypass renderer tone mapping and exposure.
      // Redirect screen output instead, retaining the preview's display transform.
      renderer.setRenderTarget(null);
      renderer.setOutputRenderTarget(target);
      await window.__PREVIEW_DRAW__();
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h);
      return { width: w, height: h, pixels: Array.from(pixels) };
    } finally {
      renderer.setOutputRenderTarget(output);
      renderer.setRenderTarget(previous, face, mip);
      target.dispose();
    }
  });
  const { width: w, height: h, pixels } = image;
  packedReadback(pixels, w, h);
  const png = new PNG({ width: w, height: h });
  let lit = 0;
  for (let y = 0; y < h; y++) for (let i = 0; i < w * 4; i++) {
    const value = pixels[y * w * 4 + i];
    png.data[y * w * 4 + i] = value;
    if (i % 4 !== 3 && value > 20) lit++;
  }
  if (lit < w * h * 0.01) throw new Error('WebGPU preview is blank');
  writeFileSync(path, PNG.sync.write(png));
}
