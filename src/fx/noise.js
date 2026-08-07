/**
 * FX noise toolkit used to bake the FX texture atlases at load time.
 *
 * The `Noise` class and the math helpers live in src/core/ (shared,
 * lead-owned — any subsystem may import them); this file re-exports them and
 * keeps the sRGB encode helper that is FX-specific.
 *
 * Everything is seeded from `ctx.rng` so a capture is byte-identical run to
 * run. Nothing in this file runs per frame.
 */

export { Noise } from '../core/noise.js';
import { clamp01, smoothstep } from '../core/math.js';
// Local import AND re-export: encodeSrgb below calls clamp01, and a bare
// re-export does not create a module-local binding.
export { clamp01, smoothstep };

/** sRGB encode for atlases sampled as sRGB textures. */
export function encodeSrgb(v) {
  v = clamp01(v);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
