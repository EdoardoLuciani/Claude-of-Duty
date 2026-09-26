import { Fn, clamp, float, smoothstep, step, vec2, vec3, vec4 } from 'three/tsl';
import { fbm01, fbm3, fbm4, scratches, worley } from './noise-tsl.js';

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

// Shared 0.25 m micro surface: linear RGB is albedo variation, A is height.
// The old detail ORM was never sampled; a second pass derives the normal from A.
export const detailSurface = Fn(([coords, seed]) => {
  const period = vec2(8);
  const p = coords.mul(period).add(seed);
  const a = fbm01(fbm4(p.mul(3), period.mul(3), 0.55));
  const b = fbm01(fbm4(p.mul(9), period.mul(9), 0.52));
  const pores = worley(p.mul(8), period.mul(8), 1);
  const grit = worley(p.mul(20), period.mul(20), 1);
  const scr = scratches(p.mul(2.5), period.mul(2.5), 16, 1, 0.66)
    .add(scratches(p.mul(4).add(5), period.mul(4), 11, -2, 0.70).mul(0.8));
  const gritA = smoothstep(0.08, 0.34, pores.x).oneMinus().mul(step(0.38, pores.z));
  const gritB = smoothstep(0.06, 0.30, grit.x).oneMinus().mul(step(0.34, grit.z));
  const pit = smoothstep(0, 0.26, pores.x).oneMinus().mul(step(0.72, pores.w));
  const h = float(0.5).add(a.sub(0.5).mul(0.34)).add(b.sub(0.5).mul(0.26))
    .sub(pit.mul(0.38)).add(gritA.mul(0.26).mul(grit.z.mul(0.5).add(0.5)))
    .add(gritB.mul(0.20)).sub(clamp(scr, 0, 1).mul(0.18));
  const alb = float(0.5).add(a.sub(0.5).mul(0.22)).add(b.sub(0.5).mul(0.15))
    .add(gritA.mul(0.16)).add(gritB.mul(0.10)).sub(pit.mul(0.14));
  return vec4(vec3(alb), clamp(h, 0, 1));
});
