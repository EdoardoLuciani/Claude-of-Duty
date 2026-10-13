// Pinned WebGPUTextureUtils removes 256-byte row padding before returning data.
// Preserve element type and values: half/float decoding belongs to the caller.
export function packedReadback(pixels, width, height, channels = 4) {
  if (pixels.length !== width * height * channels)
    throw new Error(`invalid packed readback: ${pixels.length} elements, expected ${width * height * channels}`);
  return pixels;
}
