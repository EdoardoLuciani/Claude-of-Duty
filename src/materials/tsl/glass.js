import { Fn, clamp, float, mix, smoothstep, vec2 } from 'three/tsl';
import { authoredColor } from '../color-tsl.js';
import { fbm01, fbm3, fbm4, fbm5, scratches, shear, shearPeriod, worley } from '../noise-tsl.js';
import { Surface } from './surface.js';

export const glassSurface = Fn(([coords, seed]) => {
  const period = vec2(8);
  const p = coords.mul(period).add(seed.mul(2.2));
  const smear = fbm01(fbm4(shear(p.mul(3), 1, 6),
    shearPeriod(period.mul(3), 6), 0.5));
  const dust = fbm01(fbm5(p.mul(5), period.mul(5), 0.55));
  const spots = worley(p.mul(24), period.mul(24), 1).x;
  const fine = fbm01(fbm3(p.mul(12), period.mul(12), 0.5));
  const dirty = smoothstep(0.45, 0.85, dust);
  const c = authoredColor(0.045, 0.050, 0.052).toVar();
  c.assign(mix(c, authoredColor(0.300, 0.290, 0.265), dirty.mul(0.35)));
  const rough = float(0.045).add(smear.mul(0.10)
    .mul(smoothstep(0.3, 0.9, dust))).add(dirty.mul(0.22)).toVar();
  rough.addAssign(smoothstep(0.05, 0.30, spots).oneMinus().mul(0.25));
  rough.addAssign(fine.sub(0.5).mul(0.02));
  const scr = scratches(p.mul(2), period.mul(2), 24, 1, 0.70);
  rough.addAssign(scr.mul(0.25));
  c.addAssign(scr.mul(0.02));
  const height = clamp(float(0.5).add(smear.sub(0.5).mul(0.004)), 0, 1);
  const ao = float(1).sub(dirty.mul(0.1));
  return Surface(clamp(c, 0.02, 0.5), height, clamp(rough, 0.02, 0.7), float(0), ao);
});
