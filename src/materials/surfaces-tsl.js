import { Fn, vec2, vec4 } from 'three/tsl';
import { fbm01, fbm3, fbm4 } from './noise-tsl.js';

// Shared macro map: R = low-frequency swell, G = warped blotches,
// B = mid-frequency variation, A = fine variation (same packing as generator.js).
export const macroSurface = Fn(([coords, seed]) => {
  const period = vec2(6, 6);
  const p = coords.mul(period).add(seed.mul(3));
  const a = fbm01(fbm4(p.mul(0.5), period.mul(0.5), 0.62));
  const warp = vec2(
    fbm3(p.add(vec2(1.7, 9.2)), period, 0.5),
    fbm3(p.add(vec2(8.3, 2.8)), period, 0.5)
  );
  const b = fbm01(fbm4(p.add(warp.mul(1.1)), period, 0.58));
  const c = fbm01(fbm4(p.mul(2.5), period.mul(2.5), 0.55));
  const d = fbm01(fbm4(p.mul(7), period.mul(7), 0.5));
  return vec4(a, b, c, d);
});
