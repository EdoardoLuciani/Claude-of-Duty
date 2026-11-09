// Pinned WebGPUTextureUtils removes 256-byte row padding before returning data.
// Preserve element type and values: half/float decoding belongs to the caller.
export function packedReadback<T extends { readonly length: number }>(
  pixels: T,
  width: number,
  height: number,
  channels = 4
): T {
  if (pixels.length !== width * height * channels)
    throw new Error(
      `invalid packed readback: ${pixels.length} elements, expected ${width * height * channels}`
    );
  return pixels;
}
