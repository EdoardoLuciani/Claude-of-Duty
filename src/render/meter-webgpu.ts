import { DataUtils, HalfFloatType, NoColorSpace, RenderPipeline, RenderTarget } from 'three/webgpu';
import { clamp, dot, exp, float, log2, screenUV, smoothstep, texture, vec3, vec4 } from 'three/tsl';
import type { Texture } from 'three';
import type { Renderer } from 'three/webgpu';

/** Centre-weighted log luminance across the entire image, ignoring bright sky.
 * Draw only when sampled (not every frame); read 64×64 instead of the full HDR
 * buffer. The opaque prepass's cleared depth is zero on sky pixels. */
export function createHdrMeter(renderer: Renderer, colorTexture: Texture, depthTexture: Texture): { warm(): void; sample(): Promise<number | null>; dispose(): void } {
  const size = 64;
  const target = new RenderTarget(size, size, {
    type: HalfFloatType, colorSpace: NoColorSpace, depthBuffer: false,
  });
  const uv = screenUV;
  const color = texture(colorTexture).sample(uv).rgb;
  const depth = texture(depthTexture).sample(uv).r;
  const luminance = clamp(dot(color, vec3(0.2126, 0.7152, 0.0722)), 1e-5, 40);
  const delta = uv.sub(0.5).mul(2);
  const sky = depth.lessThanEqual(0).or(depth.greaterThan(400));
  const skyWeight = float(1).sub(smoothstep(0.06, 0.3, luminance).mul(0.85));
  const weight = exp(dot(delta, delta).mul(-1.1)).mul(sky.select(skyWeight, float(1)));
  const pipeline = new RenderPipeline(renderer, vec4(log2(luminance).mul(weight), weight, 0, 1));
  pipeline.outputColorTransform = false;

  const draw = () => {
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      pipeline.render();
    } finally { renderer.setRenderTarget(previous); }
  };
  let layoutWarned = false;
  return {
    warm: draw,
    async sample() {
      draw();
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
      // RGBA16F at 64 pixels is 512 bytes/row: already WebGPU's 256-byte
      // alignment. Reject format/layout changes rather than guessing a stride.
      if (!(pixels instanceof Uint16Array) || pixels.length !== size * size * 4) {
        if (!layoutWarned) console.warn('[render] unexpected RGBA16F meter readback layout');
        layoutWarned = true;
        return null;
      }
      const row = size * 4;
      let weightedLog = 0, totalWeight = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * row + x * 4;
        weightedLog += DataUtils.fromHalfFloat(pixels[i]);
        totalWeight += DataUtils.fromHalfFloat(pixels[i + 1]);
      }
      return totalWeight > 0 ? 2 ** (weightedLog / totalWeight) : null;
    },
    dispose() { pipeline.dispose(); target.dispose(); },
  };
}
