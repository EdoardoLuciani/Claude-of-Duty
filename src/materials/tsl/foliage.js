import { Fn, abs, atan, clamp, float, fract, length, max, min, mix, sin,
  smoothstep, vec2 } from 'three/tsl';
import { authoredColor } from '../color-tsl.js';
import { fbm01, fbm3 } from '../noise-tsl.js';
import { Surface } from './surface.js';

// One leaf per tile. Height is a cutout mask, not a parallax field.

export const foliageSurface = Fn(([coords, seed]) => {
  const period = vec2(8);
  const p = coords.mul(period).add(seed.mul(5.9));
  const e = coords.sub(0.5).div(vec2(0.42, 0.17));
  const d = length(e);
  const pinch = float(1).sub(abs(e.x).mul(0.275));
  const serr = sin(atan(e.y, e.x).mul(26)).mul(0.03);
  // Reversed smoothstep is undefined in WGSL; its complement is equivalent.
  const cover = smoothstep(float(0.88).add(serr), float(1.02).add(serr),
    d.div(max(pinch, 0.3))).oneMinus().toVar();
  const inset = min(min(coords.x, coords.x.oneMinus()),
    min(coords.y, coords.y.oneMinus()));
  cover.mulAssign(smoothstep(0, 0.03, inset));

  const sideV = smoothstep(0.75, 1,
    abs(fract(e.x.mul(5).add(e.y.mul(2))).mul(2).sub(1)));
  const vein = clamp(smoothstep(0, 0.08, abs(e.y)).oneMinus()
    .add(sideV.mul(0.45).mul(cover)), 0, 1);
  const young = authoredColor(0.180, 0.330, 0.090);
  const old = authoredColor(0.095, 0.185, 0.060);
  const dry = authoredColor(0.390, 0.320, 0.110);
  const fine = fbm01(fbm3(p.mul(12), period.mul(12), 0.5));
  const spots = fbm01(fbm3(p.mul(22), period.mul(22), 0.5));
  const lc = mix(young, old, 0.4).toVar();
  lc.assign(mix(lc, dry, smoothstep(0.72, 1, spots).mul(0.45)));
  lc.mulAssign(spots.mul(0.30).add(0.85));
  lc.assign(mix(lc, lc.mul(1.35), vein.mul(0.5)));

  const albedo = clamp(lc.mul(fine.mul(0.085).add(0.955)), 0.02, 0.7);
  const rough = clamp(float(0.62).add(vein.oneMinus().mul(0.14))
    .add(fine.sub(0.5).mul(0.10)), 0.35, 0.95);
  const ao = clamp(float(0.55).add(float(1).sub(d.mul(0.3)).mul(0.45)), 0.3, 1);
  return Surface(albedo, cover, rough, float(0), ao);
});
