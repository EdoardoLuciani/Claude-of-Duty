import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three/webgpu';
import type { Texture } from 'three/webgpu';

/** Pack the equal-sized soldier bakes without resampling or atlas edge bleeding. */
export function soldierTextureArray(
  maps: readonly (Texture | null)[],
  fallback: readonly [number, number, number, number],
  srgb: boolean,
  anisotropy: number
): DataArrayTexture {
  const first = maps.find((map) => map !== null)?.image as ImageBitmap;
  if (!first?.width || !first.height) throw new Error('[ai] missing soldier texture array images');
  const { width, height } = first;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('[ai] soldier texture packing needs a 2D canvas');
  const stride = width * height * 4;
  const pixels = new Uint8Array(stride * maps.length);
  for (let layer = 0; layer < maps.length; layer++) {
    const image = maps[layer]?.image as ImageBitmap | undefined;
    if (image) {
      if (image.width !== width || image.height !== height)
        throw new Error('[ai] soldier texture array layers must have matching dimensions');
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      pixels.set(ctx.getImageData(0, 0, width, height).data, layer * stride);
    } else {
      for (let i = layer * stride; i < (layer + 1) * stride; i += 4) pixels.set(fallback, i);
    }
  }
  const array = new DataArrayTexture(pixels, width, height, maps.length);
  array.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  array.flipY = false;
  array.wrapS = array.wrapT = RepeatWrapping;
  array.magFilter = LinearFilter;
  array.minFilter = LinearMipmapLinearFilter;
  array.generateMipmaps = true;
  array.anisotropy = anisotropy;
  array.needsUpdate = true;
  return array;
}
