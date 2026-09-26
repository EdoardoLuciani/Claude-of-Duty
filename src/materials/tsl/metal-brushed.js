import { Fn, clamp, float, mix, smoothstep, vec2 } from 'three/tsl';
import { authoredColor } from '../color-tsl.js';
import { fbm01, fbm3, fbm4, scratches, shear, shearPeriod, warp } from '../noise-tsl.js';
import { Surface } from './surface.js';

// Directional brushed steel: fibres, score lines, handling and grease.
export const brushedMetalSurface = Fn(([coords, seed]) => {
  const period = vec2(8);
  const p = coords.mul(period).add(seed.mul(15.1));
  const bp = shear(p, 0, 64), tile = shearPeriod(period, 64);
  const brush1 = fbm01(fbm4(bp.mul(2), tile.mul(2), 0.5));
  const brush2 = fbm01(fbm3(bp.mul(8).add(3), tile.mul(8), 0.5));
  const brush3 = fbm01(fbm3(shear(p.mul(4), 0, 24),
    shearPeriod(period.mul(4), 24), 0.5));
  const brush = brush1.mul(0.5).add(brush2.mul(0.32)).add(brush3.mul(0.18));
  const macro = fbm01(fbm3(p.mul(0.9), period.mul(0.9), 0.6));
  const color = authoredColor(0.560, 0.565, 0.575).toVar();
  color.mulAssign(brush.mul(0.13).add(0.93));
  color.mulAssign(macro.mul(0.06).add(0.97));
  const metal = float(1).toVar();
  const rough = float(0.22).add(brush.mul(0.24))
    .add(macro.sub(0.5).mul(0.06)).toVar();
  const height = float(0.78).add(brush.sub(0.5).mul(0.012)).toVar();

  const score = scratches(p, period, 40, 0, 0.60);
  rough.addAssign(score.mul(0.22));
  height.subAssign(score.mul(0.006));
  color.mulAssign(float(1).sub(score.mul(0.05)));
  const cross = scratches(p.mul(3), period.mul(3), 8, 3, 0.70).mul(0.7);
  rough.addAssign(cross.mul(0.20));
  height.subAssign(cross.mul(0.004));
  const dent = fbm01(fbm3(p.mul(3).add(7), period.mul(3), 0.6));
  height.addAssign(dent.sub(0.5).mul(0.05));

  const smudge = smoothstep(0.58, 0.86, fbm01(fbm4(
    warp(p.mul(2.2).add(19), period.mul(2.2), 0.7), period.mul(2.2), 0.55)));
  rough.addAssign(smudge.mul(0.22));
  color.mulAssign(float(1).sub(smudge.mul(0.06)));
  metal.subAssign(smudge.mul(0.10));
  const grime = smoothstep(0.66, 0.95, fbm01(fbm4(p.mul(5), period.mul(5), 0.55)));
  color.assign(mix(color, authoredColor(0.180, 0.175, 0.165), grime.mul(0.35)));
  rough.addAssign(grime.mul(0.18));
  metal.subAssign(grime.mul(0.35));
  return Surface(clamp(color, 0.02, 0.88), clamp(height, 0, 1),
    clamp(rough, 0.08, 0.95), clamp(metal, 0, 1), float(1));
});
