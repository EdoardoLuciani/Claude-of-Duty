import {
  Fn,
  abs,
  clamp,
  cos,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  smoothstep,
  step,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { StructNode } from 'three/webgpu';

import { authoredColor } from '../color-tsl.ts';
import {
  fbm01,
  fbm3,
  fbm4,
  fbm5,
  hash11,
  hash12,
  hash42,
  scratches,
  shear,
  shearPeriod,
  warp as domainWarp,
} from '../noise-tsl.ts';
import { Surface } from './surface.ts';

// WOOD: authored channel stack migrated from surfaces-organic.js.
export const woodSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const PLANKS = float(5.0).toVar();
    const p = coords.mul(P).add(seed.mul(12.9)).toVar();
    const rowF = coords.y.mul(PLANKS).toVar();
    const row = floor(rowF).toVar();
    const rf = fract(rowF).toVar();
    const stagger = hash11(row.add(seed.mul(2.0))).toVar();
    const lenF = coords.x.mul(2.0).add(stagger).toVar();
    const board = floor(lenF).toVar();
    const lf = fract(lenF).toVar();
    const rnd = hash42(vec2(board, row).add(seed)).toVar();
    const GY = float(0.035).toVar();
    const GX = float(0.01).toVar();
    const ey = min(smoothstep(0.0, GY, rf), smoothstep(0.0, GY, float(1.0).sub(rf))).toVar();
    const ex = min(smoothstep(0.0, GX, lf), smoothstep(0.0, GX, float(1.0).sub(lf))).toVar();
    const face = min(ex, ey).toVar();
    const gp = vec2(lf.mul(2.0).add(rnd.x.mul(13.0)), rf.add(rnd.y.mul(7.0))).toVar();
    const GP = vec2(16.0, 8.0).toVar();
    const warp = fbm4(
      vec2(gp.x.mul(3.0), gp.y.mul(12.0)),
      vec2(GP.x.mul(3.0), GP.y.mul(12.0)),
      0.55
    ).toVar();
    const ringCoord = gp.y
      .mul(float(14.0).add(rnd.z.mul(12.0)))
      .add(warp.mul(2.2))
      .add(rnd.w.mul(5.0))
      .toVar();
    const knotP = vec2(float(0.25).add(rnd.x.mul(0.5)), float(0.35).add(rnd.y.mul(0.3))).toVar();
    const kd = length(vec2(lf, rf).sub(knotP).mul(vec2(2.2, 1.0))).toVar();
    const hasKnot = step(0.68, rnd.z).toVar();
    const knotPull = hasKnot.mul(exp(kd.negate().mul(9.0))).toVar();
    ringCoord.assign(mix(ringCoord, kd.mul(42.0), clamp(knotPull.mul(1.6), 0.0, 1.0)));
    const rings = fract(ringCoord).toVar();
    const ringDark = smoothstep(0.42, 0.5, rings)
      .mul(float(1.0).sub(smoothstep(0.5, 0.62, rings)))
      .toVar();
    const latewood = smoothstep(0.3, 0.52, rings).toVar();
    const fibre = fbm01(
      fbm4(shear(p.mul(6.0), 0.0, 40.0), shearPeriod(P.mul(6.0), 40.0), 0.5)
    ).toVar();
    const micro = fbm01(fbm3(p.mul(22.0), P.mul(22.0), 0.5)).toVar();
    const wLight = authoredColor(0.505, 0.408, 0.29).toVar();
    const wMid = authoredColor(0.362, 0.272, 0.18).toVar();
    const wDark = authoredColor(0.205, 0.142, 0.092).toVar();
    const wGrey = authoredColor(0.372, 0.355, 0.328).toVar();
    const c = mix(wLight, wMid, rnd.w.mul(0.8).add(latewood.mul(0.5))).toVar();
    c.assign(mix(c, wDark, ringDark.mul(0.65)));
    c.mulAssign(float(0.9).add(float(0.18).mul(fibre)));
    c.assign(mix(c, wDark.mul(0.7), clamp(knotPull.mul(2.2), 0.0, 1.0).mul(0.8)));
    const weather = smoothstep(0.2, 0.85, fbm01(fbm3(p.mul(0.8), P.mul(0.8), 0.6)))
      .mul(float(0.4).add(float(0.6).mul(rnd.x)))
      .toVar();
    c.assign(mix(c, wGrey, weather.mul(0.68)));
    const faceH = float(0.74)
      .sub(ringDark.mul(0.02))
      .sub(latewood.mul(0.012))
      .add(fibre.sub(0.5).mul(0.03))
      .add(micro.sub(0.5).mul(0.008))
      .toVar();
    faceH.addAssign(rnd.y.sub(0.5).mul(0.035));
    faceH.subAssign(clamp(knotPull.mul(1.5), 0.0, 1.0).mul(0.03));
    const split = scratches(vec2(p.x, p.y).mul(2.0), P.mul(2.0), 30.0, 0.0, 0.66)
      .mul(weather)
      .toVar();
    faceH.subAssign(split.mul(0.1));
    c.assign(mix(c, wDark.mul(0.45), split.mul(0.7)));
    const saw = fbm01(
      fbm3(shear(p.mul(3.0), 0.0, 1.0).mul(vec2(30.0, 1.0)), vec2(P.x.mul(90.0), P.y.mul(3.0)), 0.5)
    ).toVar();
    faceH.addAssign(saw.sub(0.5).mul(0.012));
    const edgeD = min(
      min(rf, float(1.0).sub(rf)).div(GY),
      min(lf, float(1.0).sub(lf)).div(GX)
    ).toVar();
    const bevel = float(1.0)
      .sub(smoothstep(0.0, 2.4, edgeD))
      .toVar();
    faceH.subAssign(bevel.mul(0.035));
    c.mulAssign(float(1.0).sub(bevel.mul(0.1)));
    c.assign(
      mix(
        c,
        wLight.mul(1.15),
        bevel.mul(smoothstep(0.5, 0.9, fbm01(fbm3(p.mul(20.0), P.mul(20.0), 0.5)))).mul(0.35)
      )
    );
    const m = smoothstep(0.05, 0.7, face).toVar();
    h.assign(mix(0.44, faceH, m));
    c.assign(mix(wDark.mul(0.25), c, m));
    rough.assign(
      mix(
        0.95,
        float(0.62).add(float(0.22).mul(fibre)).add(weather.mul(0.2)).add(split.mul(0.15)),
        m
      )
    );
    ao.assign(mix(0.25, 1.0, smoothstep(0.0, 0.5, face)).sub(bevel.mul(0.12).mul(m)));
    metal.assign(0.0);
    const nf = vec2(fract(lf.mul(3.0).add(0.5)).sub(0.5), rf.sub(0.5)).toVar();
    const nd = length(nf.mul(vec2(3.0, 1.0)).div(vec2(3.0, 1.0)).mul(vec2(1.0, 1.0))).toVar();
    nd.assign(length(vec2(fract(lf.mul(3.0).add(0.5)).sub(0.5), rf.sub(0.22)).mul(vec2(1.4, 1.0))));
    const nail = smoothstep(0.03, 0.055, nd).oneMinus().mul(m).mul(step(0.3, rnd.w)).toVar();
    h.subAssign(nail.mul(0.02));
    c.assign(mix(c, authoredColor(0.23, 0.2, 0.17), nail.mul(0.85)));
    rough.assign(mix(rough, 0.55, nail));
    metal.assign(mix(metal, 0.85, nail.mul(0.7)));
    ao.subAssign(nail.mul(0.25));
    const weep = smoothstep(0.05, 0.11, nd)
      .oneMinus()
      .mul(step(0.3, rnd.w))
      .mul(smoothstep(0.0, 0.6, rf.sub(0.22)))
      .mul(m)
      .toVar();
    c.assign(mix(c, authoredColor(0.33, 0.185, 0.095), clamp(weep, 0.0, 1.0).mul(0.4)));
    const cavity = float(1.0)
      .sub(smoothstep(0.55, 0.78, h))
      .toVar();
    c.assign(mix(c, authoredColor(0.12, 0.106, 0.088), cavity.mul(0.45)));
    const soil = smoothstep(
      0.4,
      0.88,
      fbm01(fbm5(domainWarp(p.mul(2.2).add(5.0), P.mul(2.2), 0.9, 3), P.mul(2.2), 0.6))
    ).toVar();
    c.assign(mix(c, authoredColor(0.185, 0.16, 0.128), soil.mul(0.4)));
    rough.addAssign(soil.mul(0.08));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.8))));
    rough.assign(clamp(rough, 0.25, 0.99));
    ao.assign(clamp(ao, 0.12, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);

// FABRIC: authored channel stack migrated from surfaces-organic.js.
export const fabricSurface = Fn<
  [Node<'vec2'>, Node<'float'>, Node<'vec3'>, Node<'vec3'>],
  ReturnType<typeof Surface>
>(([coords, seed, tintA, tintB]): StructNode => {
  const alb = vec3(0.5).toVar(),
    h = float(0.5).toVar();
  const rough = float(0.5).toVar(),
    metal = float(0).toVar(),
    ao = float(1).toVar();
  const P = vec2(float(8.0)).toVar();
  const THREADS = float(96.0).toVar();
  const p = coords.mul(P).add(seed.mul(3.9)).toVar();
  const t = coords.mul(THREADS).toVar();
  const cell = floor(t).toVar();
  const f = fract(t).sub(0.5).toVar();
  const over = mod(cell.x.add(cell.y), 2.0).toVar();
  const warpProfile = cos(f.x.mul(3.14159)).toVar();
  const weftProfile = cos(f.y.mul(3.14159)).toVar();
  const top = mix(warpProfile, weftProfile, over).toVar();
  const bot = mix(weftProfile, warpProfile, over).mul(0.45).toVar();
  const weave = max(top, bot).toVar();
  const threadId = hash12(cell.add(seed)).toVar();
  const fuzz = fbm01(fbm3(p.mul(12.0), P.mul(12.0), 0.55)).toVar();
  const slub = fbm01(fbm4(p.mul(14.0), P.mul(14.0), 0.5)).toVar();
  const macro = fbm01(fbm4(p.mul(1.2), P.mul(1.2), 0.6)).toVar();
  const cA = tintA.toVar();
  const cB = tintB.toVar();
  const c = mix(cA, cB, threadId.mul(0.6).add(slub.mul(0.4))).toVar();
  c.mulAssign(float(0.865).add(float(0.215).mul(weave.mul(0.5).add(0.5))));
  c.mulAssign(float(0.96).add(float(0.075).mul(fuzz)));
  c.mulAssign(float(0.9).add(float(0.2).mul(macro)));
  h.assign(
    float(0.55).add(weave.mul(0.3)).add(fuzz.sub(0.5).mul(0.03)).add(slub.sub(0.5).mul(0.05))
  );
  rough.assign(float(0.86).add(float(1.0).sub(weave).mul(0.08)).add(fuzz.sub(0.5).mul(0.06)));
  metal.assign(0.0);
  ao.assign(mix(0.82, 1.0, smoothstep(float(0.4).negate(), 0.9, weave)));
  const foldC = coords.y
    .mul(2.6)
    .add(coords.x.mul(0.55))
    .add(fbm01(fbm3(p.mul(0.9), P.mul(0.9), 0.62)).mul(2.2))
    .toVar();
  const foldT = abs(fract(foldC).sub(0.5)).mul(2.0).toVar();
  const crest = float(1.0).sub(foldT).toVar();
  const foldR = hash11(floor(foldC).mul(2.13).add(seed)).toVar();
  const fold = crest
    .mul(crest)
    .mul(float(0.55).add(float(0.75).mul(foldR)))
    .toVar();
  h.addAssign(fold.sub(0.3).mul(0.115));
  c.mulAssign(float(0.895).add(float(0.21).mul(fold)));
  ao.subAssign(float(1.0).sub(crest).mul(0.14));
  const creaseLine = float(1.0)
    .sub(smoothstep(0.0, 0.1, foldT))
    .toVar();
  rough.subAssign(creaseLine.mul(0.06));
  c.mulAssign(float(1.0).add(creaseLine.mul(0.05)));
  const wearField = smoothstep(
    0.58,
    0.82,
    fbm01(fbm4(domainWarp(p.mul(2.0), P.mul(2.0), 0.8, 3), P.mul(2.0), 0.55))
  ).toVar();
  c.assign(mix(c, c.mul(1.35).add(0.02), wearField.mul(0.5)));
  rough.addAssign(wearField.mul(0.06));
  h.subAssign(wearField.mul(0.05));
  const pulled = scratches(p.mul(3.0), P.mul(3.0), 18.0, 1.0, 0.68).toVar();
  h.addAssign(pulled.mul(0.05));
  c.mulAssign(float(1.0).sub(pulled.mul(0.1)));
  const stain = smoothstep(
    0.55,
    0.9,
    fbm01(fbm5(domainWarp(p.mul(1.5).add(7.0), P.mul(1.5), 1.0, 3), P.mul(1.5), 0.6))
  ).toVar();
  c.assign(mix(c, c.mul(0.42).add(authoredColor(0.09, 0.08, 0.06)), stain.mul(0.55)));
  rough.addAssign(stain.mul(0.05));
  const dust = smoothstep(0.4, 0.85, fbm01(fbm4(p.mul(6.0), P.mul(6.0), 0.5))).toVar();
  c.assign(mix(c, authoredColor(0.4, 0.375, 0.335), dust.mul(0.14)));
  alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.85))));
  rough.assign(clamp(rough, 0.5, 0.99));
  ao.assign(clamp(ao, 0.25, 1.0));
  h.assign(clamp(h, 0.0, 1.0));
  return Surface(alb, h, rough, metal, ao);
});

// BURLAP: authored channel stack migrated from surfaces-organic.js.
export const burlapSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const THREADS = float(34.0).toVar();
    const p = coords.mul(P).add(seed.mul(4.7)).toVar();
    const t = coords.mul(THREADS).toVar();
    const cell = floor(t).toVar();
    const f = fract(t).sub(0.5).toVar();
    const over = mod(cell.x.add(cell.y), 2.0).toVar();
    const twx = float(0.62)
      .add(float(0.3).mul(hash12(vec2(cell.x, 0.0).add(seed))))
      .toVar();
    const twy = float(0.62)
      .add(float(0.3).mul(hash12(vec2(0.0, cell.y).add(seed.mul(1.7)))))
      .toVar();
    const warpP = cos(clamp(f.x.div(twx), float(0.5).negate(), 0.5).mul(3.14159)).toVar();
    const weftP = cos(clamp(f.y.div(twy), float(0.5).negate(), 0.5).mul(3.14159)).toVar();
    const top = mix(warpP, weftP, over).toVar();
    const bot = mix(weftP, warpP, over).mul(0.4).toVar();
    const weave = max(top, bot).toVar();
    const fibre = fbm01(
      fbm3(shear(p.mul(12.0), 0.0, 8.0), shearPeriod(P.mul(12.0), 8.0), 0.5)
    ).toVar();
    const macro = fbm01(fbm4(p.mul(1.0), P.mul(1.0), 0.62)).toVar();
    const dirt = fbm01(fbm5(domainWarp(p.mul(2.5), P.mul(2.5), 0.8, 3), P.mul(2.5), 0.55)).toVar();
    const cJute = authoredColor(0.52, 0.43, 0.275).toVar();
    const cPale = authoredColor(0.64, 0.56, 0.4).toVar();
    const cSoil = authoredColor(0.23, 0.18, 0.12).toVar();
    const c = mix(cJute, cPale, hash12(cell.add(3.0)).mul(0.5).add(fibre.mul(0.15))).toVar();
    c.mulAssign(float(0.855).add(float(0.235).mul(weave.mul(0.5).add(0.5))));
    c.mulAssign(float(0.9).add(float(0.18).mul(macro)));
    c.assign(mix(c, cSoil, smoothstep(0.42, 0.85, dirt).mul(0.6)));
    h.assign(float(0.5).add(weave.mul(0.38)).add(fibre.sub(0.5).mul(0.05)));
    rough.assign(float(0.9).add(float(1.0).sub(weave).mul(0.06)));
    metal.assign(0.0);
    ao.assign(mix(0.74, 1.0, smoothstep(float(0.4).negate(), 0.9, weave)));
    const rot = smoothstep(0.55, 0.9, fbm01(fbm3(p.mul(0.7).add(11.0), P.mul(0.7), 0.6))).toVar();
    c.assign(mix(c, cPale.mul(1.15), rot.mul(0.4)));
    rough.addAssign(rot.mul(0.05));
    const loose = scratches(p.mul(4.0), P.mul(4.0), 10.0, 2.0, 0.7).toVar();
    h.addAssign(loose.mul(0.06));
    c.assign(mix(c, cPale, loose.mul(0.3)));
    const sand = smoothstep(0.5, 0.85, fbm01(fbm4(p.mul(12.0), P.mul(12.0), 0.5)))
      .mul(float(1.0).sub(smoothstep(0.2, 0.7, weave)))
      .toVar();
    c.assign(mix(c, authoredColor(0.64, 0.545, 0.39), sand.mul(0.45)));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.8))));
    rough.assign(clamp(rough, 0.6, 0.99));
    ao.assign(clamp(ao, 0.2, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);
