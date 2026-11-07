import {
  Fn,
  abs,
  clamp,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  pow,
  sign,
  sin,
  smoothstep,
  step,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { StructNode } from 'three/webgpu';

import { authoredColor } from '../color-tsl.ts';
import {
  billow5,
  fbm01,
  fbm3,
  fbm4,
  fbm5,
  hash11,
  hash12,
  scratches,
  shear,
  shearPeriod,
  warp as domainWarp,
  worley,
} from '../noise-tsl.ts';
import { rustColor } from './rust-color.ts';
import { Surface } from './surface.ts';

// METAL_RUST: authored channel stack migrated from surfaces-metal.js.
export const metalRustSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const p = coords.mul(P).add(seed.mul(7.7)).toVar();
    const mill = fbm01(
      fbm4(shear(p.mul(4.0), 1.0, 6.0), shearPeriod(P.mul(4.0), 6.0), 0.5)
    ).toVar();
    const fine = fbm01(fbm4(p.mul(22.0), P.mul(22.0), 0.5)).toVar();
    const steel = authoredColor(0.33, 0.335, 0.345)
      .mul(float(0.9).add(float(0.18).mul(mill)))
      .toVar();
    const c = steel.toVar();
    h.assign(float(0.72).add(mill.sub(0.5).mul(0.02)).add(fine.sub(0.5).mul(0.01)));
    rough.assign(float(0.4).add(mill.sub(0.5).mul(0.16)).add(fine.sub(0.5).mul(0.08)));
    metal.assign(1.0);
    ao.assign(1.0);
    const wp = domainWarp(p.mul(1.4), P.mul(1.4), 1.2, 4).toVar();
    const bloom = billow5(wp, P.mul(1.4), 0.6).toVar();
    bloom.assign(float(1.0).sub(bloom));
    const spread = fbm01(fbm3(p.mul(0.7).add(12.0), P.mul(0.7), 0.6)).toVar();
    const rust = smoothstep(
      0.36,
      0.72,
      bloom.mul(float(0.55).add(float(0.85).mul(spread)))
    ).toVar();
    const rustGrain = fbm01(fbm4(p.mul(26.0), P.mul(26.0), 0.55)).toVar();
    const pit = fbm01(fbm3(p.mul(24.0), P.mul(24.0), 0.5)).toVar();
    const scale = worley(p.mul(16.0), P.mul(16.0), 1.0).x.toVar();
    const flake = smoothstep(0.1, 0.3, scale)
      .oneMinus()
      .mul(smoothstep(0.25, 0.55, rust))
      .mul(float(1.0).sub(smoothstep(0.8, 1.0, rust)))
      .toVar();
    const rustAge = fbm01(fbm4(p.mul(0.85).add(21.0), P.mul(0.85), 0.62)).toVar();
    const rustCol = rustColor(rustAge.mul(0.8).add(rust.mul(0.3)), rustGrain).toVar();
    c.assign(mix(c, rustCol, rust));
    metal.assign(mix(1.0, 0.0, smoothstep(0.15, 0.55, rust)));
    rough.assign(
      mix(rough, float(0.86).add(float(0.1).mul(rustGrain)), smoothstep(0.1, 0.6, rust))
    );
    h.addAssign(rust.mul(0.11).mul(float(0.4).add(rustGrain)).add(flake.mul(0.13)));
    h.subAssign(smoothstep(0.5, 0.95, rust).mul(pit).mul(0.14));
    ao.subAssign(flake.mul(0.3).add(smoothstep(0.6, 1.0, rust).mul(0.15)));
    const pits = worley(p.mul(22.0), P.mul(22.0), 1.0).toVar();
    const deep = smoothstep(0.0, 0.22, pits.x)
      .oneMinus()
      .mul(step(0.72, pits.w))
      .mul(smoothstep(0.3, 0.8, rust))
      .toVar();
    h.subAssign(deep.mul(0.22));
    ao.subAssign(deep.mul(0.45));
    c.assign(mix(c, rustCol.mul(0.35), deep.mul(0.7)));
    const scr = scratches(p.mul(3.0), P.mul(3.0), 12.0, 1.0, 0.6).toVar();
    scr.addAssign(
      scratches(p.mul(5.0).add(8.0), P.mul(5.0), 9.0, float(2.0).negate(), 0.66).mul(0.7)
    );
    scr.assign(clamp(scr, 0.0, 1.0).mul(0.6));
    c.assign(mix(c, authoredColor(0.48, 0.485, 0.495), scr.mul(0.8)));
    metal.assign(mix(metal, 1.0, scr.mul(0.85)));
    rough.assign(mix(rough, 0.24, scr.mul(0.7)));
    h.subAssign(scr.mul(0.01));
    const grime = smoothstep(
      0.55,
      0.9,
      fbm01(fbm5(vec2(p.x.mul(5.0), p.y.mul(0.8)), vec2(P.x.mul(5.0), max(P.y, 1.0)), 0.55))
    ).toVar();
    c.mulAssign(float(1.0).sub(grime.mul(0.25)));
    rough.addAssign(grime.mul(0.08));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.8))));
    rough.assign(clamp(rough, 0.12, 0.99));
    ao.assign(clamp(ao, 0.15, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);

// METAL_PAINTED: authored channel stack migrated from surfaces-metal.js.
export const metalPaintedSurface = Fn<
  [Node<'vec2'>, Node<'float'>, Node<'vec3'>, Node<'vec3'>, Node<'vec4'>],
  ReturnType<typeof Surface>
>(([coords, seed, tintA, , param]): StructNode => {
  const alb = vec3(0.5).toVar(),
    h = float(0.5).toVar();
  const rough = float(0.5).toVar(),
    metal = float(0).toVar(),
    ao = float(1).toVar();
  const P = vec2(float(8.0)).toVar();
  const p = coords.mul(P).add(seed.mul(11.3)).toVar();
  const mill = fbm01(fbm4(shear(p.mul(5.0), 1.0, 8.0), shearPeriod(P.mul(5.0), 8.0), 0.5)).toVar();
  const steel = authoredColor(0.33, 0.335, 0.345)
    .mul(float(0.88).add(float(0.2).mul(mill)))
    .toVar();
  const bloom = float(1.0)
    .sub(billow5(domainWarp(p.mul(1.8), P.mul(1.8), 1.1, 4), P.mul(1.8), 0.6))
    .toVar();
  const rustField = smoothstep(0.6, 0.92, bloom).toVar();
  const rustGrain = fbm01(fbm4(p.mul(22.0), P.mul(22.0), 0.55)).toVar();
  const rustCol = rustColor(rustField, rustGrain).toVar();
  const peel = fbm01(fbm4(p.mul(22.0), P.mul(22.0), 0.5)).toVar();
  const roller = fbm01(
    fbm4(shear(p.mul(2.0), 0.0, 3.0), shearPeriod(P.mul(2.0), 3.0), 0.5)
  ).toVar();
  const paint = tintA.mul(float(0.9).add(float(0.16).mul(roller))).toVar();
  paint.mulAssign(float(0.96).add(float(0.08).mul(peel)));
  const bleach = smoothstep(0.35, 0.85, fbm01(fbm3(p.mul(0.8), P.mul(0.8), 0.6))).toVar();
  paint.assign(mix(paint, paint.mul(1.25).add(0.03), bleach.mul(0.5)));
  const chipField = fbm01(
    fbm5(domainWarp(p.mul(2.6).add(4.0), P.mul(2.6), 0.9, 3), P.mul(2.6), 0.55)
  ).toVar();
  const chipEdge = fbm01(fbm4(p.mul(12.0), P.mul(12.0), 0.5)).toVar();
  const chipSrc = chipField
    .mul(0.6)
    .add(chipEdge.mul(0.2))
    .add(rustField.mul(0.32))
    .add(param.z.mul(0.25))
    .toVar();
  const chip = smoothstep(0.66, 0.92, chipSrc).toVar();
  const dings = worley(p.mul(20.0), P.mul(20.0), 1.0).toVar();
  const ding = smoothstep(0.03, 0.14, dings.x).oneMinus().mul(step(0.88, dings.w)).toVar();
  chip.assign(clamp(chip.add(ding), 0.0, 1.0));
  const scr = scratches(p.mul(2.5), P.mul(2.5), 14.0, 1.0, 0.62).toVar();
  scr.addAssign(
    scratches(p.mul(4.0).add(21.0), P.mul(4.0), 10.0, float(1.0).negate(), 0.66).mul(0.8)
  );
  scr.assign(clamp(scr, 0.0, 1.0));
  const primer = authoredColor(0.47, 0.3, 0.18).toVar();
  const primerBand = smoothstep(0.0, 0.35, chip)
    .mul(float(1.0).sub(smoothstep(0.35, 0.6, chip)))
    .toVar();
  const c = paint.toVar();
  const r = float(0.42).add(peel.sub(0.5).mul(0.22)).add(bleach.mul(0.16)).toVar();
  const mtl = float(0.0).toVar();
  h.assign(float(0.74).add(roller.sub(0.5).mul(0.02)).add(peel.sub(0.5).mul(0.012)));
  ao.assign(1.0);
  c.assign(mix(c, primer, primerBand.mul(0.7)));
  c.assign(
    mix(c, rustCol, smoothstep(0.35, 0.75, chip).mul(float(0.55).add(float(0.45).mul(rustField))))
  );
  c.assign(mix(c, steel, smoothstep(0.75, 0.95, chip).mul(float(1.0).sub(rustField)).mul(0.9)));
  r.assign(mix(r, 0.88, smoothstep(0.3, 0.8, chip).mul(float(0.4).add(float(0.6).mul(rustField)))));
  r.assign(mix(r, 0.38, smoothstep(0.8, 1.0, chip).mul(float(1.0).sub(rustField))));
  mtl.assign(
    mix(0.0, 1.0, smoothstep(0.78, 0.96, chip).mul(float(1.0).sub(smoothstep(0.2, 0.7, rustField))))
  );
  h.subAssign(smoothstep(0.4, 0.8, chip).mul(0.16));
  ao.subAssign(smoothstep(0.35, 0.7, chip).mul(0.22));
  const lip = smoothstep(0.3, 0.42, chip)
    .mul(float(1.0).sub(smoothstep(0.42, 0.55, chip)))
    .toVar();
  c.mulAssign(float(1.0).add(lip.mul(0.15)));
  h.addAssign(lip.mul(0.05));
  c.assign(mix(c, authoredColor(0.5, 0.505, 0.515), scr.mul(0.55)));
  mtl.assign(mix(mtl, 1.0, scr.mul(0.6)));
  r.assign(mix(r, 0.26, scr.mul(0.55)));
  const streak = fbm01(
    fbm5(vec2(p.x.mul(6.0), p.y.mul(0.7)), vec2(P.x.mul(6.0), max(P.y, 1.0)), 0.55)
  ).toVar();
  const grime = smoothstep(0.52, 0.92, streak).toVar();
  c.mulAssign(float(1.0).sub(grime.mul(0.3)));
  r.addAssign(grime.mul(0.1));
  mtl.mulAssign(float(1.0).sub(grime.mul(0.5)));
  const bleed = smoothstep(0.66, 0.95, streak)
    .mul(smoothstep(0.2, 0.6, rustField))
    .toVar();
  c.assign(mix(c, authoredColor(0.36, 0.19, 0.09), bleed.mul(0.45)));
  const cavity = float(1.0)
    .sub(smoothstep(0.62, 0.78, h))
    .toVar();
  c.mulAssign(float(1.0).sub(cavity.mul(0.18)));
  alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.85))));
  rough.assign(clamp(r, 0.14, 0.99));
  metal.assign(clamp(mtl, 0.0, 1.0));
  ao.assign(clamp(ao, 0.2, 1.0));
  h.assign(clamp(h, 0.0, 1.0));
  return Surface(alb, h, rough, metal, ao);
});

// CORRUGATED: authored channel stack migrated from surfaces-metal.js.
export const corrugatedSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const RIDGES = float(12.0).toVar();
    const p = coords.mul(P).add(seed.mul(6.1)).toVar();
    const t = coords.x.mul(RIDGES).mul(6.28318530718).toVar();
    const wave = sin(t).toVar();
    const profile = sign(wave)
      .mul(pow(abs(wave), 0.72))
      .mul(0.5)
      .add(0.5)
      .toVar();
    const panel = coords.x.mul(RIDGES).div(4.0).toVar();
    const panelId = floor(panel).toVar();
    const lap = smoothstep(0.0, 0.06, fract(panel))
      .mul(smoothstep(0.0, 0.06, float(1.0).sub(fract(panel))))
      .toVar();
    const panelStep = hash11(panelId.add(seed)).sub(0.5).mul(0.05).toVar();
    const dents = fbm01(fbm4(p.mul(2.2), P.mul(2.2), 0.6)).toVar();
    const fine = fbm01(fbm4(p.mul(11.0), P.mul(11.0), 0.5)).toVar();
    h.assign(
      float(0.18)
        .add(profile.mul(0.62))
        .add(panelStep)
        .add(dents.sub(0.5).mul(0.07))
        .add(fine.sub(0.5).mul(0.012))
    );
    h.subAssign(float(1.0).sub(lap).mul(0.06));
    const sp = worley(p.mul(7.0), P.mul(7.0), 1.0).toVar();
    const spangle = smoothstep(0.05, 0.55, sp.x).oneMinus().toVar();
    const zinc = authoredColor(0.52, 0.535, 0.545).toVar();
    const c = mix(
      zinc.mul(0.86),
      zinc.mul(1.12),
      spangle.mul(float(0.3).add(float(0.7).mul(sp.z)))
    ).toVar();
    c.mulAssign(float(0.94).add(float(0.12).mul(fine)));
    metal.assign(1.0);
    rough.assign(float(0.34).add(float(1.0).sub(spangle).mul(0.16)).add(fine.sub(0.5).mul(0.08)));
    ao.assign(1.0);
    const valley = float(1.0).sub(profile).toVar();
    const rustField = smoothstep(
      0.62,
      0.98,
      float(1.0)
        .sub(billow5(domainWarp(p.mul(1.6), P.mul(1.6), 1.0, 4), P.mul(1.6), 0.6))
        .mul(float(0.58).add(float(0.4).mul(valley)))
        .add(float(1.0).sub(coords.y).mul(0.16))
    ).toVar();
    const rustGrain = fbm01(fbm4(p.mul(22.0), P.mul(22.0), 0.55)).toVar();
    const rustCol = rustColor(rustField, rustGrain).toVar();
    c.assign(mix(c, rustCol, rustField));
    metal.assign(mix(metal, 0.0, smoothstep(0.15, 0.6, rustField)));
    rough.assign(
      mix(rough, float(0.88).add(float(0.08).mul(rustGrain)), smoothstep(0.1, 0.6, rustField))
    );
    h.addAssign(rustField.mul(0.02).mul(rustGrain));
    const hole = worley(p.mul(5.0).add(31.0), P.mul(5.0), 0.95).toVar();
    const perf = smoothstep(0.02, 0.1, hole.x)
      .oneMinus()
      .mul(step(0.94, hole.w))
      .mul(smoothstep(0.5, 0.9, rustField))
      .toVar();
    h.subAssign(perf.mul(0.5));
    ao.subAssign(perf.mul(0.7));
    c.assign(mix(c, rustCol.mul(0.25), perf));
    const crown = smoothstep(0.72, 0.95, profile).toVar();
    const fx = vec2(
      fract(coords.x.mul(RIDGES)).sub(0.5),
      fract(coords.y.mul(3.0)).sub(0.5)
    ).toVar();
    const fd = length(fx.mul(vec2(1.0, RIDGES.div(3.0)))).toVar();
    const screwRnd = hash12(floor(vec2(coords.x.mul(RIDGES), coords.y.mul(3.0))).add(seed)).toVar();
    const screw = smoothstep(0.11, 0.16, fd)
      .oneMinus()
      .mul(crown)
      .mul(step(0.25, screwRnd))
      .toVar();
    const washer = smoothstep(0.18, 0.24, fd)
      .oneMinus()
      .mul(crown)
      .mul(step(0.25, screwRnd))
      .toVar();
    h.addAssign(washer.mul(0.02).add(screw.mul(0.035)));
    c.assign(mix(c, authoredColor(0.12, 0.115, 0.11), washer.mul(0.8)));
    c.assign(mix(c, mix(authoredColor(0.4, 0.405, 0.41), rustCol, rustField), screw));
    rough.assign(mix(rough, 0.85, washer.mul(0.8)));
    rough.assign(mix(rough, float(0.42).add(rustField.mul(0.4)), screw));
    metal.assign(mix(metal, 0.0, washer.mul(0.9)));
    metal.assign(mix(metal, float(1.0).sub(rustField), screw));
    ao.subAssign(washer.sub(screw).mul(0.35));
    const weep = washer
      .mul(0.0)
      .add(
        smoothstep(0.2, 0.34, fd)
          .oneMinus()
          .mul(step(0.25, screwRnd))
          .mul(crown)
          .mul(smoothstep(0.0, 0.5, fract(coords.y.mul(3.0)).sub(0.5)))
      )
      .toVar();
    c.assign(mix(c, authoredColor(0.33, 0.17, 0.08), clamp(weep, 0.0, 1.0).mul(0.5)));
    const dirt = valley
      .mul(smoothstep(0.35, 0.8, fbm01(fbm4(p.mul(3.0), P.mul(3.0), 0.55))))
      .toVar();
    c.assign(mix(c, authoredColor(0.2, 0.185, 0.16), dirt.mul(0.4)));
    rough.addAssign(dirt.mul(0.14));
    metal.mulAssign(float(1.0).sub(dirt.mul(0.5)));
    ao.subAssign(valley.mul(0.18));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.85))));
    rough.assign(clamp(rough, 0.14, 0.99));
    metal.assign(clamp(metal, 0.0, 1.0));
    ao.assign(clamp(ao, 0.15, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);
