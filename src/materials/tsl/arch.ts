import {
  Fn,
  abs,
  clamp,
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
  cracks,
  fbm01,
  fbm3,
  fbm4,
  fbm5,
  hash11,
  hash12,
  hash42,
  shear,
  shearPeriod,
  warp as domainWarp,
  worley,
} from '../noise-tsl.ts';
import { Surface } from './surface.ts';

// CONCRETE: authored channel stack migrated from surfaces-arch.js.
export const concreteSurface = Fn<
  [Node<'vec2'>, Node<'float'>, Node<'vec3'>, Node<'vec3'>, Node<'vec4'>],
  ReturnType<typeof Surface>
>(([coords, seed, , , param]): StructNode => {
  const alb = vec3(0.5).toVar(),
    h = float(0.5).toVar();
  const rough = float(0.5).toVar(),
    metal = float(0).toVar(),
    ao = float(1).toVar();
  const P = vec2(float(8.0)).toVar();
  const p = coords.mul(P).add(seed.mul(13.7)).toVar();
  const macro = fbm01(fbm4(p.mul(0.5), P.mul(0.5), 0.58)).toVar();
  const mid = fbm01(fbm5(domainWarp(p.mul(2.0), P.mul(2.0), 0.7, 3), P.mul(2.0), 0.5)).toVar();
  const fine = fbm01(fbm4(p.mul(18.0), P.mul(18.0), 0.5)).toVar();
  const micro = fbm01(fbm3(p.mul(26.0), P.mul(26.0), 0.5)).toVar();
  const cLight = authoredColor(0.52, 0.512, 0.492).toVar();
  const cMid = authoredColor(0.395, 0.392, 0.385).toVar();
  const cDark = authoredColor(0.255, 0.253, 0.258).toVar();
  const c = mix(cMid, cLight, smoothstep(0.35, 0.85, macro)).toVar();
  c.assign(mix(c, cDark, smoothstep(0.55, 0.95, mid).mul(0.55)));
  c.mulAssign(float(0.93).add(float(0.14).mul(fine)));
  const pourB = fbm01(
    fbm4(domainWarp(p.mul(1.5).add(8.3), P.mul(1.5), 0.6, 3), P.mul(1.5), 0.58)
  ).toVar();
  pourB.assign(clamp(pourB.sub(0.5).mul(2.5).add(0.5), 0.0, 1.0));
  c.mulAssign(float(0.82).add(float(0.38).mul(pourB)));
  const wash = fbm01(fbm4(p.mul(7.0).add(2.0), P.mul(7.0), 0.5)).toVar();
  wash.assign(clamp(wash.sub(0.5).mul(2.2).add(0.5), 0.0, 1.0));
  c.mulAssign(float(0.925).add(float(0.155).mul(wash)));
  h.assign(float(0.62).add(fine.sub(0.5).mul(0.035)).add(mid.sub(0.5).mul(0.05)));
  rough.assign(float(0.7).add(mid.sub(0.5).mul(0.16)).add(micro.sub(0.5).mul(0.07)));
  ao.assign(1.0);
  metal.assign(0.0);
  const agg = worley(p.mul(13.0), P.mul(13.0), 0.95).toVar();
  const aggShape = smoothstep(0.1, 0.46, agg.x).oneMinus().toVar();
  const aggRnd = agg.z.toVar();
  const aggExposed = aggShape
    .mul(step(0.74, fbm01(fbm3(p.mul(3.0).add(5.0), P.mul(3.0), 0.5)).add(aggRnd.mul(0.35))))
    .toVar();
  h.addAssign(aggExposed.mul(0.022).mul(float(0.5).add(aggRnd)));
  c.assign(
    mix(
      c,
      mix(authoredColor(0.335, 0.32, 0.3), authoredColor(0.56, 0.545, 0.505), aggRnd),
      aggExposed.mul(0.7)
    )
  );
  rough.addAssign(aggExposed.mul(0.07).mul(aggRnd.sub(0.5)));
  const sand = worley(p.mul(20.0), P.mul(20.0), 1.0).toVar();
  const sandM = smoothstep(0.05, 0.44, sand.x).oneMinus().toVar();
  const sandSel = float(0.4)
    .add(float(0.6).mul(step(0.3, sand.z)))
    .toVar();
  h.addAssign(sandM.mul(sandSel).mul(0.028));
  c.mulAssign(float(1.0).add(sandM.mul(sandSel).sub(0.2).mul(0.15)));
  rough.addAssign(sand.z.sub(0.5).mul(0.11).add(sandM.mul(0.04)));
  ao.subAssign(sandM.mul(0.06));
  const sandTrough = smoothstep(0.52, 0.88, sand.x).toVar();
  c.assign(mix(c, c.mul(0.86), sandTrough.mul(0.34)));
  const pores = worley(p.mul(22.0), P.mul(22.0), 1.0).toVar();
  const pore = smoothstep(0.0, 0.26, pores.x).oneMinus().mul(step(0.84, pores.w)).toVar();
  h.subAssign(pore.mul(0.055));
  ao.subAssign(pore.mul(0.55));
  rough.addAssign(pore.mul(0.1));
  const formAmt = param.x.toVar();
  const jointAmt = param.y.toVar();
  const boards = coords.y.mul(4.0).toVar();
  const bi = floor(boards).toVar();
  const bf = fract(boards).toVar();
  const seam = float(1.0)
    .sub(smoothstep(0.0, 0.03, bf))
    .add(float(1.0).sub(smoothstep(0.0, 0.03, float(1.0).sub(bf))))
    .toVar();
  seam.assign(clamp(seam, 0.0, 1.0));
  const boardStep = hash11(bi.add(seed)).sub(0.5).mul(0.028).mul(formAmt).toVar();
  h.addAssign(boardStep);
  h.subAssign(seam.mul(0.055).mul(formAmt));
  ao.subAssign(seam.mul(0.4).mul(formAmt));
  c.mulAssign(float(1.0).sub(seam.mul(0.16).mul(formAmt)));
  const bleed = float(1.0)
    .sub(smoothstep(0.0, 0.1, abs(bf.sub(0.02))))
    .mul(0.5)
    .mul(formAmt)
    .toVar();
  c.assign(mix(c, cLight.mul(1.05), bleed.mul(0.35).mul(fbm01(fbm3(p.mul(8.0), P.mul(8.0), 0.5)))));
  const tf = fract(vec2(coords.x.mul(3.0), boards.mul(0.5)))
    .sub(0.5)
    .toVar();
  const tieRnd = hash12(floor(vec2(coords.x.mul(3.0), boards.mul(0.5))).add(seed)).toVar();
  const tie = smoothstep(0.05, 0.085, length(tf.mul(vec2(1.0, 2.0))))
    .oneMinus()
    .mul(step(0.45, tieRnd))
    .mul(formAmt)
    .toVar();
  h.subAssign(tie.mul(0.1));
  ao.subAssign(tie.mul(0.5));
  c.assign(mix(c, cDark.mul(0.85), tie.mul(0.6)));
  const jd = abs(fract(coords.add(0.5)).sub(0.5)).toVar();
  const joint = max(
    float(1.0).sub(smoothstep(0.0035, 0.01, jd.x)),
    float(1.0).sub(smoothstep(0.0035, 0.01, jd.y))
  ).toVar();
  joint.mulAssign(jointAmt);
  h.subAssign(joint.mul(0.1));
  ao.subAssign(joint.mul(0.55));
  c.assign(mix(c, cDark.mul(0.62), joint.mul(0.65)));
  const swirl = fbm01(
    fbm3(domainWarp(p.mul(1.1).add(3.0), P.mul(1.1), 1.4, 3), P.mul(1.1), 0.6)
  ).toVar();
  rough.subAssign(jointAmt.mul(smoothstep(0.35, 0.85, swirl)).mul(0.1));
  c.mulAssign(float(1.0).sub(jointAmt.mul(smoothstep(0.4, 0.9, swirl)).mul(0.07)));
  const crk = cracks(p.mul(2.6), P.mul(2.6), 0.85, 0.028, 0.5).toVar();
  const crkFine = cracks(p.mul(7.0).add(31.0), P.mul(7.0), 0.9, 0.02, 0.6).mul(0.55).toVar();
  const crack = clamp(crk.add(crkFine), 0.0, 1.0).toVar();
  h.subAssign(crack.mul(0.12));
  ao.subAssign(crack.mul(0.45));
  c.assign(mix(c, cDark.mul(0.8), crack.mul(0.42)));
  rough.addAssign(crack.mul(0.12));
  const sp = worley(p.mul(1.1).add(7.3), P.mul(1.1), 0.9).toVar();
  const spallCell = step(0.9, sp.w).toVar();
  const spall = spallCell
    .mul(smoothstep(0.16, 0.44, sp.x).oneMinus())
    .mul(smoothstep(0.42, 0.62, fbm01(fbm4(p.mul(4.0).add(2.0), P.mul(4.0), 0.5))))
    .toVar();
  h.subAssign(spall.mul(0.13));
  ao.subAssign(spall.mul(0.35));
  c.assign(mix(c, mix(cDark, cMid, aggRnd).mul(0.88), spall.mul(0.8)));
  rough.addAssign(spall.mul(0.1));
  const spallRim = spall.mul(float(1.0).sub(spall)).mul(4.0).toVar();
  c.mulAssign(float(1.0).add(spallRim.mul(0.1)));
  const ck = worley(domainWarp(p.mul(5.6).add(19.0), P.mul(5.6), 0.6, 3), P.mul(5.6), 0.95).toVar();
  const ckSel = step(0.9, ck.w).toVar();
  const ckSize = float(0.2).add(float(0.16).mul(ck.z)).toVar();
  const ckShape = smoothstep(
    ckSize,
    ckSize.mul(0.3),
    ck.x.mul(float(0.72).add(float(0.56).mul(fbm01(fbm3(p.mul(16.0), P.mul(16.0), 0.5)))))
  ).toVar();
  const chip = ckSel.mul(ckShape).toVar();
  c.assign(mix(c, mix(c.mul(0.74), mix(cDark, cMid, sand.z), 0.5), chip.mul(0.85)));
  h.subAssign(chip.mul(0.045));
  ao.subAssign(chip.mul(0.24));
  rough.addAssign(chip.mul(0.08));
  const ckLip = max(
    ckSel.mul(smoothstep(ckSize.mul(1.25), ckSize, ck.x).sub(ckShape)),
    0.0
  ).toVar();
  c.mulAssign(float(1.0).add(ckLip.mul(0.1)));
  const streak = fbm01(
    fbm5(vec2(p.x.mul(6.0), p.y.mul(2.0)), vec2(P.x.mul(6.0), P.y.mul(2.0)), 0.55)
  ).toVar();
  const runoff = smoothstep(0.58, 0.95, streak)
    .mul(float(0.35).add(float(0.65).mul(smoothstep(0.2, 0.8, macro))))
    .toVar();
  c.mulAssign(float(1.0).sub(runoff.mul(0.14)));
  rough.addAssign(runoff.mul(0.05));
  const rustBleed = smoothstep(0.72, 0.98, streak.mul(float(0.6).add(float(0.5).mul(tieRnd))))
    .mul(step(0.8, tieRnd))
    .toVar();
  c.assign(mix(c, authoredColor(0.42, 0.24, 0.12), rustBleed.mul(0.45)));
  const cavity = float(1.0)
    .sub(smoothstep(0.42, 0.66, h))
    .toVar();
  c.assign(mix(c, authoredColor(0.2, 0.19, 0.17), cavity.mul(0.35)));
  alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.85))));
  rough.assign(clamp(rough, 0.48, 0.98));
  ao.assign(clamp(ao, 0.15, 1.0));
  h.assign(clamp(h, 0.0, 1.0));
  return Surface(alb, h, rough, metal, ao);
});

// BRICK: authored channel stack migrated from surfaces-arch.js.
export const brickSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const COLS = float(6.0).toVar();
    const ROWS = float(18.0).toVar();
    const p = coords.mul(P).add(seed.mul(9.1)).toVar();
    const rowF = coords.y.mul(ROWS).toVar();
    const row = floor(rowF).toVar();
    const colF = coords.x.mul(COLS).add(mod(row, 2.0).mul(0.5)).toVar();
    const col = floor(colF).toVar();
    const id = vec2(mod(col, COLS), row).toVar();
    const f = vec2(fract(colF), fract(rowF)).toVar();
    const rnd = hash42(id.add(seed.mul(3.0))).toVar();
    const rnd2 = hash42(id.mul(1.37).add(21.0).add(seed)).toVar();
    const rnd3 = hash42(id.mul(0.73).add(7.7).add(seed.mul(1.9))).toVar();
    const jitter = rnd.xy.sub(0.5).mul(vec2(0.012, 0.03)).toVar();
    const fj = f.add(jitter).toVar();
    const JX = float(0.048).toVar();
    const JY = float(0.135).toVar();
    const dxj = min(fj.x, float(1.0).sub(fj.x)).toVar();
    const dyj = min(fj.y, float(1.0).sub(fj.y)).toVar();
    const shoulder = float(0.74).add(float(0.16).mul(rnd3.w)).toVar();
    const ex = smoothstep(JX.mul(shoulder), JX.mul(1.02), dxj).toVar();
    const ey = smoothstep(JY.mul(shoulder), JY.mul(1.02), dyj).toVar();
    const face = min(ex, ey).toVar();
    const bp = vec2(fj.x, fj.y).mul(vec2(3.0, 1.0)).add(rnd.zw.mul(17.0)).toVar();
    const BP = vec2(float(24.0)).toVar();
    const mSand = fbm01(fbm4(p.mul(20.0), P.mul(20.0), 0.5)).toVar();
    const mGrain = worley(p.mul(24.0), P.mul(24.0), 1.0).toVar();
    const mortarRough = fbm01(fbm4(p.mul(20.0), P.mul(20.0), 0.55)).toVar();
    const mortarCol = mix(
      authoredColor(0.4, 0.388, 0.362),
      authoredColor(0.278, 0.272, 0.26),
      smoothstep(0.3, 0.8, mortarRough)
    ).toVar();
    mortarCol.mulAssign(float(0.84).add(float(0.32).mul(mSand)));
    mortarCol.mulAssign(float(0.88).add(float(0.24).mul(fbm01(fbm4(p.mul(6.0), P.mul(6.0), 0.6)))));
    mortarCol.assign(
      mix(
        mortarCol,
        authoredColor(0.235, 0.228, 0.215),
        smoothstep(0.06, 0.5, mGrain.x).oneMinus().mul(0.4)
      )
    );
    mortarCol.assign(
      mix(
        mortarCol,
        authoredColor(0.52, 0.505, 0.47),
        smoothstep(0.02, 0.3, worley(p.mul(25.0).add(4.0), P.mul(25.0), 1.0).x)
          .oneMinus()
          .mul(0.35)
      )
    );
    const jointDepth = float(0.1)
      .add(float(0.05).mul(fbm01(fbm3(p.mul(1.2), P.mul(1.2), 0.5))))
      .toVar();
    const crumble = smoothstep(
      0.62,
      0.86,
      fbm01(fbm4(p.mul(9.0).add(4.0), P.mul(9.0), 0.5))
    ).toVar();
    jointDepth.addAssign(crumble.mul(0.09));
    const mortarH = mSand
      .sub(0.5)
      .negate()
      .mul(0.018)
      .sub(smoothstep(0.0, 0.5, mGrain.x).oneMinus().mul(0.012))
      .toVar();
    const faceN = fbm01(fbm5(bp.mul(2.2), BP, 0.5)).toVar();
    const faceFine = fbm01(fbm4(bp.mul(5.0), BP.mul(2.0), 0.5)).toVar();
    const facePore = worley(bp.mul(7.0), BP.mul(3.5), 1.0).toVar();
    const poreCluster = smoothstep(
      0.42,
      0.78,
      fbm01(fbm4(bp.mul(3.0).add(8.0), BP.mul(1.5), 0.55))
    ).toVar();
    const pore = smoothstep(float(0.26).add(float(0.16).mul(facePore.z)), 0.0, facePore.x)
      .mul(step(0.55, facePore.w))
      .mul(poreCluster)
      .toVar();
    const cA = authoredColor(0.43, 0.238, 0.183).toVar();
    const cB = authoredColor(0.318, 0.183, 0.15).toVar();
    const cC = authoredColor(0.196, 0.132, 0.12).toVar();
    const cD = authoredColor(0.492, 0.392, 0.3).toVar();
    const cE = authoredColor(0.372, 0.288, 0.218).toVar();
    const brick = mix(cA, cB, rnd.z).toVar();
    brick.assign(mix(brick, cC, step(0.9, rnd.w).mul(0.7)));
    brick.assign(mix(brick, cD, step(0.94, rnd2.x).mul(0.62)));
    brick.assign(mix(brick, cE, step(0.55, rnd2.y).mul(0.5)));
    brick.mulAssign(float(0.88).add(float(0.24).mul(rnd3.x)));
    brick.mulAssign(float(0.86).add(float(0.28).mul(faceN)));
    const faceGrain = fbm01(fbm4(bp.mul(8.0), BP.mul(4.0), 0.55)).toVar();
    brick.mulAssign(float(0.87).add(float(0.26).mul(faceGrain)));
    brick.assign(mix(brick, brick.mul(1.22), smoothstep(0.55, 0.9, faceFine).mul(0.5)));
    brick.assign(mix(brick, brick.mul(0.62), pore.mul(0.85)));
    brick.assign(
      mix(
        brick,
        brick.mul(0.72),
        smoothstep(0.0, 0.34, facePore.x).oneMinus().mul(step(0.86, facePore.z))
      )
    );
    brick.assign(
      mix(brick, authoredColor(0.62, 0.58, 0.5), smoothstep(0.86, 0.98, faceFine).mul(0.35))
    );
    const faceH = float(0.72)
      .add(faceN.sub(0.5).mul(0.05))
      .add(faceFine.sub(0.5).mul(0.025))
      .add(rnd2.z.sub(0.5).mul(0.05))
      .toVar();
    faceH.subAssign(pore.mul(0.075));
    const edgeD = min(dxj.div(JX), dyj.div(JY)).toVar();
    const chipNoise = fbm01(fbm4(bp.mul(6.0).add(3.0), BP.mul(3.0), 0.5)).toVar();
    const chip = smoothstep(0.3, 1.7, edgeD)
      .oneMinus()
      .mul(smoothstep(0.6, 0.8, chipNoise))
      .mul(step(0.66, rnd3.z))
      .toVar();
    faceH.subAssign(chip.mul(0.17));
    brick.assign(mix(brick, brick.mul(0.72).add(authoredColor(0.2, 0.13, 0.09)), chip.mul(0.65)));
    const m = face.toVar();
    h.assign(mix(float(0.72).sub(jointDepth).add(mortarH), faceH, m));
    const c = mix(mortarCol, brick, m).toVar();
    const brickRough = float(0.58)
      .add(float(0.32).mul(rnd2.z))
      .add(rnd3.y.sub(0.5).mul(0.2))
      .toVar();
    rough.assign(
      mix(
        float(0.88)
          .add(float(0.1).mul(mSand))
          .add(float(0.06).mul(mortarRough.sub(0.5))),
        brickRough
          .add(float(0.14).mul(faceN))
          .add(float(0.1).mul(faceGrain.sub(0.5)))
          .add(chip.mul(0.14)),
        m
      )
    );
    ao.assign(mix(0.34, 1.0, smoothstep(0.0, 0.75, face)));
    ao.subAssign(chip.mul(0.3));
    metal.assign(0.0);
    const smear = smoothstep(0.5, 1.0, float(1.0).sub(face))
      .mul(smoothstep(0.55, 0.9, fbm01(fbm4(p.mul(14.0), P.mul(14.0), 0.5))))
      .toVar();
    c.assign(mix(c, mortarCol.mul(1.05), smear.mul(0.5)));
    const soilB = fbm01(
      fbm4(domainWarp(p.mul(1.8).add(27.0), P.mul(1.8), 0.6, 3), P.mul(1.8), 0.58)
    ).toVar();
    soilB.assign(clamp(soilB.sub(0.5).mul(2.5).add(0.5), 0.0, 1.0));
    c.mulAssign(float(0.845).add(float(0.33).mul(soilB)));
    const efflo = smoothstep(
      0.62,
      0.96,
      fbm01(fbm4(domainWarp(p.mul(2.6), P.mul(2.6), 0.8, 3), P.mul(2.6), 0.5))
    ).toVar();
    efflo.mulAssign(mix(1.0, 0.35, m));
    c.assign(mix(c, authoredColor(0.66, 0.652, 0.632), efflo.mul(0.5)));
    rough.addAssign(efflo.mul(0.1));
    const streak = fbm01(
      fbm5(vec2(p.x.mul(7.0), p.y.mul(2.3)), vec2(P.x.mul(7.0), P.y.mul(2.0)), 0.55)
    ).toVar();
    const runoff = smoothstep(0.5, 0.92, streak).toVar();
    c.mulAssign(float(1.0).sub(runoff.mul(0.16)));
    const crack = cracks(p.mul(2.2), P.mul(2.2), 0.85, 0.038, 0.58).toVar();
    h.subAssign(crack.mul(0.1));
    ao.subAssign(crack.mul(0.45));
    c.assign(mix(c, c.mul(0.35), crack.mul(0.7)));
    const cavity = float(1.0)
      .sub(smoothstep(0.5, 0.74, h))
      .toVar();
    c.assign(mix(c, authoredColor(0.16, 0.15, 0.14), cavity.mul(0.32)));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.85))));
    rough.assign(clamp(rough, 0.35, 0.99));
    ao.assign(clamp(ao, 0.12, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);

// PLASTER: authored channel stack migrated from surfaces-arch.js.
export const plasterSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const p = coords.mul(P).add(seed.mul(5.3)).toVar();
    const sw = shear(p.mul(1.5), 1.0, 3.0).toVar();
    const trowel = fbm01(fbm5(sw, shearPeriod(P.mul(1.5), 3.0), 0.55)).toVar();
    const skim = fbm01(fbm5(p.mul(12.0), P.mul(12.0), 0.5)).toVar();
    const micro = fbm01(fbm3(p.mul(24.0), P.mul(24.0), 0.5)).toVar();
    const macro = fbm01(fbm3(p.mul(0.6), P.mul(0.6), 0.6)).toVar();
    const cBase = authoredColor(0.598, 0.578, 0.538).toVar();
    const cWarm = authoredColor(0.512, 0.462, 0.395).toVar();
    const cGrey = authoredColor(0.382, 0.378, 0.372).toVar();
    const c = mix(cBase, cWarm, smoothstep(0.3, 0.8, macro)).toVar();
    c.mulAssign(float(0.94).add(float(0.12).mul(skim)));
    c.assign(mix(c, cGrey, smoothstep(0.45, 0.95, trowel).mul(0.42)));
    c.assign(mix(c, cBase.mul(1.1), smoothstep(0.15, 0.55, trowel).oneMinus().mul(0.3)));
    h.assign(
      float(0.7)
        .add(trowel.sub(0.5).mul(0.1))
        .add(skim.sub(0.5).mul(0.03))
        .add(micro.sub(0.5).mul(0.012))
    );
    rough.assign(
      float(0.8)
        .add(skim.sub(0.5).mul(0.12))
        .sub(smoothstep(0.5, 0.9, trowel).mul(0.1))
    );
    ao.assign(1.0);
    metal.assign(0.0);
    const lapUv = shear(p.mul(0.7), 1.0, 1.0).toVar();
    const lapF = lapUv.y.add(fbm01(fbm3(p.mul(1.1), P.mul(1.1), 0.6)).mul(1.4)).toVar();
    const lapI = floor(lapF).toVar();
    const lapT = fract(lapF).toVar();
    const lapR = hash11(lapI.mul(1.71).add(seed.mul(2.3))).toVar();
    c.mulAssign(float(0.885).add(float(0.24).mul(lapR)));
    rough.addAssign(lapR.sub(0.5).mul(0.1));
    const dampB = fbm01(
      fbm4(domainWarp(p.mul(1.6).add(3.7), P.mul(1.6), 0.7, 3), P.mul(1.6), 0.58)
    ).toVar();
    dampB.assign(clamp(dampB.sub(0.5).mul(2.6).add(0.5), 0.0, 1.0));
    c.mulAssign(float(0.8).add(float(0.42).mul(dampB)));
    rough.addAssign(dampB.sub(0.5).mul(0.12));
    const soil2 = fbm01(
      fbm4(domainWarp(p.mul(3.4).add(21.0), P.mul(3.4), 0.55, 3), P.mul(3.4), 0.55)
    ).toVar();
    soil2.assign(clamp(soil2.sub(0.5).mul(2.4).add(0.5), 0.0, 1.0));
    c.mulAssign(float(0.875).add(float(0.26).mul(soil2)));
    const wash = fbm01(fbm4(p.mul(8.0).add(6.0), P.mul(8.0), 0.5)).toVar();
    wash.assign(clamp(wash.sub(0.5).mul(2.2).add(0.5), 0.0, 1.0));
    c.mulAssign(float(0.925).add(float(0.155).mul(wash)));
    const lapEdge = float(1.0)
      .sub(smoothstep(0.0, 0.05, lapT))
      .mul(float(0.35).add(float(0.65).mul(lapR)))
      .toVar();
    h.addAssign(lapEdge.mul(0.022).sub(lapR.sub(0.5).mul(0.014)));
    c.mulAssign(float(1.0).add(lapEdge.mul(0.07)));
    const tooth = worley(p.mul(20.0), P.mul(20.0), 1.0).toVar();
    const grain = smoothstep(0.06, 0.46, tooth.x).oneMinus().toVar();
    const grainSel = float(0.4)
      .add(float(0.6).mul(step(0.32, tooth.z)))
      .toVar();
    h.addAssign(grain.mul(grainSel).mul(0.03));
    ao.subAssign(grain.mul(0.07));
    c.mulAssign(float(1.0).add(grain.mul(grainSel).sub(0.2).mul(0.16)));
    rough.addAssign(tooth.z.sub(0.5).mul(0.11).add(grain.mul(0.05)));
    const trough = smoothstep(0.52, 0.86, tooth.x).toVar();
    c.assign(mix(c, c.mul(0.84), trough.mul(0.4)));
    const ph = worley(p.mul(22.0), P.mul(22.0), 1.0).toVar();
    const hole = smoothstep(0.0, 0.24, ph.x).oneMinus().mul(step(0.8, ph.w)).toVar();
    h.subAssign(hole.mul(0.06));
    ao.subAssign(hole.mul(0.4));
    const hair = cracks(p.mul(9.0), P.mul(9.0), 0.9, 0.016, 0.52).toVar();
    hair.addAssign(cracks(p.mul(16.0).add(6.0), P.mul(16.0), 0.95, 0.015, 0.62).mul(0.5));
    hair.assign(clamp(hair, 0.0, 1.0));
    h.subAssign(hair.mul(0.03));
    ao.subAssign(hair.mul(0.18));
    c.assign(mix(c, c.mul(0.8), hair.mul(0.45)));
    const crack = cracks(p.mul(4.5).add(17.0), P.mul(4.5), 0.8, 0.018, 0.62).toVar();
    h.subAssign(crack.mul(0.16));
    ao.subAssign(crack.mul(0.6));
    c.assign(mix(c, authoredColor(0.3, 0.278, 0.25), crack.mul(0.8)));
    const blowMask = fbm01(
      fbm4(domainWarp(p.mul(1.05).add(9.0), P.mul(1.05), 1.1, 3), P.mul(1.05), 0.55)
    ).toVar();
    const blow = smoothstep(0.775, 0.845, blowMask).toVar();
    const blowEdge = smoothstep(0.745, 0.79, blowMask).sub(blow).toVar();
    const substrate = mix(
      authoredColor(0.36, 0.245, 0.195),
      authoredColor(0.43, 0.4, 0.36),
      fbm01(fbm4(p.mul(9.0), P.mul(9.0), 0.5))
    ).toVar();
    substrate.mulAssign(
      float(0.85).add(float(0.3).mul(fbm01(fbm3(p.mul(20.0), P.mul(20.0), 0.5))))
    );
    c.assign(mix(c, substrate, blow.mul(0.85)));
    h.subAssign(blow.mul(0.13));
    ao.subAssign(blow.mul(0.26));
    rough.addAssign(blow.mul(0.1));
    c.addAssign(blowEdge.mul(0.06));
    h.addAssign(blowEdge.mul(0.02));
    const ck = worley(
      domainWarp(p.mul(4.2).add(13.0), P.mul(4.2), 0.6, 3),
      P.mul(4.2),
      0.95
    ).toVar();
    const ckSel = step(0.93, ck.w).toVar();
    const ckSize = float(0.22).add(float(0.2).mul(ck.z)).toVar();
    const ckShape = smoothstep(
      ckSize,
      ckSize.mul(0.3),
      ck.x.mul(float(0.7).add(float(0.6).mul(fbm01(fbm3(p.mul(16.0), P.mul(16.0), 0.5)))))
    ).toVar();
    const chip = ckSel.mul(ckShape).toVar();
    const coat = mix(c, authoredColor(0.392, 0.336, 0.284), 0.52).toVar();
    coat.mulAssign(float(0.9).add(float(0.2).mul(fbm01(fbm3(p.mul(18.0), P.mul(18.0), 0.5)))));
    c.assign(mix(c, coat, chip.mul(0.58)));
    h.subAssign(chip.mul(0.05));
    ao.subAssign(chip.mul(0.26));
    rough.addAssign(chip.mul(0.09));
    const ckLip = max(
      ckSel.mul(smoothstep(ckSize.mul(1.25), ckSize, ck.x).sub(ckShape)),
      0.0
    ).toVar();
    c.mulAssign(float(1.0).add(ckLip.mul(0.1)));
    h.addAssign(ckLip.mul(0.01));
    const stain = fbm01(
      fbm5(vec2(p.x.mul(1.6), p.y.mul(3.2)), vec2(P.x.mul(1.6), P.y.mul(3.0)), 0.6)
    ).toVar();
    const tide = smoothstep(0.6, 0.78, stain)
      .mul(float(1.0).sub(smoothstep(0.78, 0.94, stain)))
      .toVar();
    c.assign(mix(c, authoredColor(0.4, 0.33, 0.245), tide.mul(0.45)));
    c.mulAssign(float(1.0).sub(smoothstep(0.5, 0.95, stain).mul(0.34)));
    rough.addAssign(tide.mul(0.05));
    const mould = smoothstep(0.72, 0.95, fbm01(fbm5(p.mul(4.0).add(25.0), P.mul(4.0), 0.6)))
      .mul(smoothstep(0.45, 0.8, stain))
      .toVar();
    c.assign(mix(c, authoredColor(0.085, 0.09, 0.08), mould.mul(0.7)));
    rough.addAssign(mould.mul(0.08));
    const cavity = float(1.0)
      .sub(smoothstep(0.48, 0.72, h))
      .toVar();
    c.assign(mix(c, authoredColor(0.22, 0.21, 0.19), cavity.mul(0.3)));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.88))));
    rough.assign(clamp(rough, 0.35, 0.99));
    ao.assign(clamp(ao, 0.15, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);

// TILE: authored channel stack migrated from surfaces-arch.js.
export const tileSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const N = float(6.0).toVar();
    const p = coords.mul(P).add(seed.mul(4.4)).toVar();
    const tp = coords.mul(N).toVar();
    const id = floor(tp).toVar();
    const f = fract(tp).toVar();
    const rnd = hash42(id.add(seed)).toVar();
    const J = float(0.045).toVar();
    const dxj = min(f.x, float(1.0).sub(f.x)).toVar();
    const dyj = min(f.y, float(1.0).sub(f.y)).toVar();
    const ex = smoothstep(J.mul(0.7), J.mul(1.02), dxj).toVar();
    const ey = smoothstep(J.mul(0.7), J.mul(1.02), dyj).toVar();
    const face = min(ex, ey).toVar();
    const glaze = fbm01(fbm4(f.mul(6.0).add(rnd.xy.mul(21.0)), vec2(float(48.0)), 0.5)).toVar();
    const cTile = mix(
      authoredColor(0.7, 0.69, 0.66),
      authoredColor(0.47, 0.5, 0.505),
      rnd.z.mul(0.7)
    ).toVar();
    cTile.mulAssign(float(0.93).add(float(0.13).mul(glaze)));
    cTile.mulAssign(float(0.92).add(float(0.16).mul(rnd.y)));
    const grout = fbm01(fbm4(p.mul(20.0), P.mul(20.0), 0.5)).toVar();
    const cGrout = authoredColor(0.4, 0.385, 0.36)
      .mul(float(0.85).add(float(0.3).mul(grout)))
      .toVar();
    cGrout.assign(mix(cGrout, authoredColor(0.13, 0.13, 0.12), 0.45));
    const m = face.toVar();
    h.assign(
      mix(float(0.76).sub(grout.sub(0.5).mul(0.02)), float(0.82).add(rnd.w.sub(0.5).mul(0.04)), m)
    );
    const c = mix(cGrout, cTile, m).toVar();
    rough.assign(
      mix(0.92, float(0.2).add(float(0.22).mul(glaze)).add(rnd.z.sub(0.5).mul(0.14)), m)
    );
    ao.assign(mix(0.4, 1.0, smoothstep(0.0, 0.8, face)));
    metal.assign(0.0);
    const broken = step(0.9, rnd.x).toVar();
    const crack = cracks(f.mul(3.0).add(rnd.yz.mul(9.0)), vec2(float(24.0)), 0.85, 0.04, 0.45)
      .mul(m)
      .toVar();
    c.assign(mix(c, c.mul(0.3), crack.mul(0.8)));
    h.subAssign(crack.mul(0.08));
    ao.subAssign(crack.mul(0.5));
    const sub = authoredColor(0.33, 0.3, 0.27).toVar();
    c.assign(mix(c, sub, broken.mul(m).mul(0.9)));
    h.subAssign(broken.mul(m).mul(0.14));
    rough.assign(mix(rough, 0.95, broken.mul(m)));
    const wear = smoothstep(0.45, 0.95, fbm01(fbm4(p.mul(2.0), P.mul(2.0), 0.55))).toVar();
    rough.addAssign(wear.mul(0.2).mul(m));
    c.mulAssign(float(1.0).sub(wear.mul(0.12)));
    const cavity = float(1.0)
      .sub(smoothstep(0.68, 0.8, h))
      .toVar();
    c.assign(mix(c, authoredColor(0.14, 0.13, 0.12), cavity.mul(0.35)));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.85))));
    rough.assign(clamp(rough, 0.12, 0.95));
    ao.assign(clamp(ao, 0.15, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);
