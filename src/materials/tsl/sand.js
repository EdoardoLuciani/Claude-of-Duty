import { Fn, clamp, float, mix, pow, sin, smoothstep, step, vec2 } from 'three/tsl';
import { authoredColor } from '../color-tsl.js';
import { fbm01, fbm3, fbm4, fbm5, shear, shearPeriod, worley } from '../noise-tsl.js';
import { Surface } from './surface.js';

// Wind ripples, damp hollows, loose grains and sparse buried shell fragments.
export const sandSurface = Fn(([coords, seed]) => {
  const period = vec2(8);
  const p = coords.mul(period).add(seed.mul(8.2));
  const warp = fbm3(p.mul(0.9), period.mul(0.9), 0.55);
  const phase = p.y.add(warp.mul(0.55)).mul(6.28318);
  const wave = sin(phase).mul(0.5).add(0.5);
  const ripple = pow(wave, 1.7).mul(0.75).add(wave.mul(0.25));
  const rippleAmp = smoothstep(0.20, 0.70,
    fbm01(fbm3(p.mul(0.7), period.mul(0.7), 0.6)));
  const secondary = sin(p.y.mul(3).add(p.x).add(warp.mul(0.8)).mul(6.28318))
    .mul(0.5).add(0.5);
  const dune = fbm01(fbm4(p.mul(0.5), period.mul(0.5), 0.6));
  const mid = fbm01(fbm5(p.mul(5), period.mul(5), 0.5));
  const grain = fbm01(fbm4(p.mul(18), period.mul(18), 0.55));
  const gcell = worley(p.mul(24), period.mul(24), 1);
  const height = float(0.50).add(dune.sub(0.5).mul(0.16))
    .add(mid.sub(0.5).mul(0.05))
    .add(ripple.sub(0.5).mul(0.26).mul(rippleAmp))
    .add(secondary.sub(0.5).mul(0.06).mul(rippleAmp))
    .add(grain.sub(0.5).mul(0.018)).toVar();

  const light = authoredColor(0.760, 0.660, 0.480);
  const midColor = authoredColor(0.610, 0.510, 0.360);
  const damp = authoredColor(0.360, 0.290, 0.205);
  const color = mix(midColor, light, smoothstep(0.3, 0.8, dune)).toVar();
  color.assign(mix(color, damp, smoothstep(0.28, 0.62, height).oneMinus().mul(0.55)));
  color.assign(mix(color, light.mul(1.06),
    smoothstep(0.45, 0.85, ripple).mul(rippleAmp).mul(0.35)));
  color.assign(mix(color, midColor.mul(0.88),
    smoothstep(0.10, 0.45, ripple).oneMinus().mul(rippleAmp).mul(0.30)));
  color.mulAssign(grain.mul(0.18).add(0.90));
  color.addAssign(smoothstep(0, 0.22, gcell.x).oneMinus()
    .mul(step(0.86, gcell.z)).mul(0.10));
  const rough = float(0.90).add(grain.sub(0.5).mul(0.10))
    .sub(smoothstep(0.3, 0.6, height).oneMinus().mul(0.12)).toVar();
  const ao = float(1).sub(smoothstep(0.25, 0.55, height).oneMinus().mul(0.10)).toVar();

  const peb = worley(p.mul(18), period.mul(18), 1);
  const pebble = smoothstep(0.10, 0.30, peb.x).oneMinus().mul(step(0.80, peb.w));
  const pebColor = mix(authoredColor(0.400, 0.370, 0.330),
    authoredColor(0.690, 0.660, 0.620), peb.z);
  color.assign(mix(color, pebColor, pebble.mul(0.85)));
  height.addAssign(pebble.mul(0.05));
  rough.assign(mix(rough, peb.z.mul(0.25).add(0.55), pebble.mul(0.8)));
  ao.subAssign(smoothstep(0.30, 0.40, peb.x).oneMinus()
    .mul(step(0.80, peb.w)).mul(0.08));

  const streak = smoothstep(0.62, 0.88, fbm01(fbm4(
    shear(p.mul(2.5), 2, 4), shearPeriod(period.mul(2.5), 4), 0.5)));
  color.assign(mix(color, damp.mul(1.1), streak.mul(0.22)));
  return Surface(clamp(color, 0.02, 0.82), clamp(height, 0, 1),
    clamp(rough, 0.35, 0.99), float(0), clamp(ao, 0.80, 1));
});
