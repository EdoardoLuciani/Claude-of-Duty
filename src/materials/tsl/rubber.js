import { Fn, abs, clamp, float, fract, mix, smoothstep, vec2 } from 'three/tsl';
import { authoredColor } from '../color-tsl.js';
import { cracks, fbm01, fbm3, fbm4, warp, worley } from '../noise-tsl.js';
import { Surface } from './surface.js';

// Moulded rubber: tileable pebble relief, seam, chalky wear and ozone cracks.
export const rubberSurface = Fn(([coords, seed]) => {
  const period = vec2(8);
  const p = coords.mul(period).add(seed.mul(9.6));
  const pb = worley(p.mul(12), period.mul(12), 1).toVar();
  const pebble = smoothstep(0.10, 0.42, pb.x).oneMinus().toVar();
  const fine = fbm01(fbm3(p.mul(12), period.mul(12), 0.5)).toVar();
  const macro = fbm01(fbm4(p.mul(1.5), period.mul(1.5), 0.6)).toVar();
  const height = float(0.60).add(pebble.mul(0.10))
    .add(fine.sub(0.5).mul(0.02)).add(macro.sub(0.5).mul(0.03)).toVar();
  const color = authoredColor(0.200, 0.200, 0.206).toVar();
  color.mulAssign(pebble.mul(0.5).add(0.5).mul(0.25).add(0.85));
  color.mulAssign(fine.mul(0.10).add(0.94));
  const rough = float(0.88).sub(pebble.mul(0.06))
    .add(fine.sub(0.5).mul(0.08)).toVar();
  const ao = mix(0.6, 1, pebble.mul(0.5).add(0.5)).toVar();

  const seam = smoothstep(0, 0.012,
    abs(fract(coords.y.mul(2).add(0.5)).sub(0.5))).oneMinus();
  height.addAssign(seam.mul(0.03));
  color.mulAssign(seam.mul(0.35).add(1));
  rough.subAssign(seam.mul(0.10));

  const scuff = smoothstep(0.55, 0.88, fbm01(fbm4(
    warp(p.mul(3), period.mul(3), 0.8), period.mul(3), 0.55)));
  color.assign(mix(color, authoredColor(0.220, 0.218, 0.212), scuff.mul(0.45)));
  rough.addAssign(scuff.mul(0.06));
  height.subAssign(scuff.mul(0.015));
  const crack = cracks(p.mul(7), period.mul(7), 0.9, 0.028, 0.62).toVar();
  height.subAssign(crack.mul(0.06));
  color.mulAssign(float(1).sub(crack.mul(0.35)));
  ao.subAssign(crack.mul(0.35));

  const dust = smoothstep(0.5, 0.9, fbm01(fbm4(p.mul(8), period.mul(8), 0.5)));
  color.assign(mix(color, authoredColor(0.290, 0.275, 0.250), dust.mul(0.16)));
  return Surface(clamp(color, 0.02, 0.35), clamp(height, 0, 1),
    clamp(rough, 0.55, 0.99), float(0), clamp(ao, 0.3, 1));
});
