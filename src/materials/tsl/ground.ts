import { Fn, abs, clamp, float, fract, max, mix, smoothstep, step, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { StructNode } from 'three/webgpu';

import { authoredColor } from '../color-tsl.ts';
import {
  billow5,
  cracks,
  fbm01,
  fbm3,
  fbm4,
  fbm5,
  shear,
  shearPeriod,
  warp as domainWarp,
  worley,
} from '../noise-tsl.ts';
import { Surface } from './surface.ts';

// ASPHALT: authored channel stack migrated from surfaces-ground.js.
export const asphaltSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const p = coords.mul(P).add(seed.mul(6.9)).toVar();
    const macro = fbm01(fbm4(p.mul(0.55), P.mul(0.5), 0.6)).toVar();
    const mid = fbm01(fbm5(p.mul(3.0), P.mul(3.0), 0.5)).toVar();
    const fine = fbm01(fbm4(p.mul(16.0), P.mul(16.0), 0.5)).toVar();
    const cFresh = authoredColor(0.115, 0.115, 0.122).toVar();
    const cWorn = authoredColor(0.3, 0.298, 0.295).toVar();
    const c = mix(cFresh, cWorn, smoothstep(0.25, 0.85, macro).mul(0.85)).toVar();
    c.mulAssign(float(0.94).add(float(0.12).mul(fine)));
    h.assign(float(0.6).add(mid.sub(0.5).mul(0.06)));
    rough.assign(float(0.78).add(mid.sub(0.5).mul(0.1)).add(fine.sub(0.5).mul(0.14)));
    metal.assign(0.0);
    ao.assign(1.0);
    const ap = domainWarp(p, P, 0.1, 3).toVar();
    const big = worley(ap.mul(12.0), P.mul(12.0), 1.0).toVar();
    const bigM = smoothstep(0.16, 0.4, big.x).oneMinus().toVar();
    const bigExposed = bigM
      .mul(
        smoothstep(0.3, 0.62, fbm01(fbm4(p.mul(2.2).add(3.0), P.mul(2.0), 0.5)).add(big.w.mul(0.5)))
      )
      .toVar();
    const small = worley(ap.mul(22.0).add(7.0), P.mul(22.0), 1.0).toVar();
    const smallM = smoothstep(0.1, 0.36, small.x).oneMinus().toVar();
    const smallExposed = smallM.mul(step(0.3, small.w)).toVar();
    const grit = worley(ap.mul(28.0).add(3.0), P.mul(28.0), 1.0).toVar();
    const gritM = smoothstep(0.06, 0.32, grit.x).oneMinus().mul(step(0.45, grit.z)).toVar();
    const stoneA = authoredColor(0.4, 0.392, 0.378).toVar();
    const stoneB = authoredColor(0.21, 0.2, 0.192).toVar();
    const stoneC = authoredColor(0.56, 0.52, 0.47).toVar();
    const stone = mix(stoneA, stoneB, big.z).toVar();
    stone.assign(mix(stone, stoneC, step(0.9, big.w)));
    c.assign(mix(c, stone, bigExposed.mul(0.52)));
    c.assign(mix(c, mix(stoneA, stoneC, small.z), smallExposed.mul(0.22)));
    c.assign(mix(c, mix(stoneB, stoneA, grit.z), gritM.mul(0.14)));
    h.addAssign(
      bigExposed
        .mul(0.15)
        .mul(float(0.6).add(float(0.6).mul(big.z)))
        .add(smallExposed.mul(0.065))
        .add(gritM.mul(0.022))
    );
    rough.addAssign(
      bigExposed
        .mul(float(0.1).sub(float(0.22).mul(big.z)))
        .add(smallExposed.mul(float(0.06).sub(float(0.14).mul(small.z))))
    );
    const voidM = smoothstep(0.5, 0.85, big.x)
      .mul(smoothstep(0.28, 0.6, small.x))
      .toVar();
    h.subAssign(voidM.mul(0.1));
    ao.subAssign(voidM.mul(0.14));
    const lane = abs(fract(coords.x.mul(1.0).add(0.25)).sub(0.5))
      .mul(2.0)
      .toVar();
    const polish = float(1.0)
      .sub(smoothstep(0.1, 0.62, lane))
      .mul(
        smoothstep(
          0.25,
          0.65,
          fbm01(fbm4(vec2(p.x.mul(0.7), p.y.mul(5.0)), vec2(P.x, P.y.mul(5.0)), 0.5))
        )
      )
      .toVar();
    rough.subAssign(polish.mul(0.16));
    h.subAssign(polish.mul(0.012));
    c.assign(mix(c, c.mul(0.78).add(authoredColor(0.045, 0.045, 0.048)), polish.mul(0.45)));
    const rep = worley(
      domainWarp(p.mul(0.5).add(13.0), P.mul(0.5), 1.6, 3),
      P.mul(0.5),
      0.9
    ).toVar();
    const inPatch = step(0.72, rep.w).toVar();
    const patchEdge = float(1.0)
      .sub(smoothstep(0.0, 0.06, rep.y.sub(rep.x)))
      .mul(inPatch)
      .toVar();
    c.assign(mix(c, cFresh.mul(float(0.85).add(float(0.35).mul(fine))), inPatch.mul(0.2)));
    rough.assign(mix(rough, 0.84, inPatch.mul(0.22)));
    h.subAssign(patchEdge.mul(0.07));
    ao.subAssign(patchEdge.mul(0.2));
    c.assign(mix(c, cFresh.mul(0.5), patchEdge.mul(0.35)));
    const tar = patchEdge
      .mul(smoothstep(0.4, 0.7, fbm01(fbm3(p.mul(6.0), P.mul(6.0), 0.5))))
      .toVar();
    rough.subAssign(tar.mul(0.35));
    c.assign(mix(c, authoredColor(0.055, 0.055, 0.058), tar.mul(0.7)));
    const gator = cracks(p.mul(3.4), P.mul(3.4), 0.9, 0.032, 0.56).toVar();
    const thermal = cracks(p.mul(0.9).add(41.0), P.mul(0.9), 0.75, 0.05, 0.7).toVar();
    const crack = clamp(gator.add(thermal), 0.0, 1.0).toVar();
    h.subAssign(crack.mul(0.16));
    ao.subAssign(crack.mul(0.3));
    c.assign(mix(c, authoredColor(0.045, 0.043, 0.042), crack.mul(0.85)));
    rough.addAssign(crack.mul(0.12));
    const oil = smoothstep(
      0.68,
      0.9,
      fbm01(fbm4(domainWarp(p.mul(1.8).add(31.0), P.mul(1.8), 0.9, 3), P.mul(1.8), 0.55))
    ).toVar();
    c.assign(mix(c, authoredColor(0.045, 0.043, 0.046), oil.mul(0.6)));
    rough.subAssign(oil.mul(0.16));
    const dust = smoothstep(0.3, 0.55, h)
      .oneMinus()
      .mul(smoothstep(0.35, 0.75, macro))
      .toVar();
    c.assign(mix(c, authoredColor(0.42, 0.39, 0.34), dust.mul(0.35)));
    rough.addAssign(dust.mul(0.1));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.75))));
    rough.assign(clamp(rough, 0.44, 0.99));
    ao.assign(clamp(ao, 0.68, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);

// DIRT: authored channel stack migrated from surfaces-ground.js.
export const dirtSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const p = coords.mul(P).add(seed.mul(3.4)).toVar();
    const macro = fbm01(fbm4(p.mul(0.6), P.mul(0.6), 0.62)).toVar();
    const clump = billow5(domainWarp(p.mul(3.0), P.mul(3.0), 0.6, 3), P.mul(3.0), 0.55).toVar();
    const fine = fbm01(fbm4(p.mul(14.0), P.mul(14.0), 0.5)).toVar();
    const micro = fbm01(fbm3(p.mul(22.0), P.mul(22.0), 0.5)).toVar();
    const cDry = authoredColor(0.43, 0.35, 0.255).toVar();
    const cWet = authoredColor(0.185, 0.14, 0.1).toVar();
    const cPale = authoredColor(0.56, 0.49, 0.385).toVar();
    const c = mix(cDry, cPale, smoothstep(0.45, 0.9, macro)).toVar();
    c.assign(mix(c, cWet, smoothstep(0.15, 0.55, macro).oneMinus().mul(0.8)));
    c.mulAssign(float(0.94).add(float(0.11).mul(fine)));
    c.mulAssign(float(0.975).add(float(0.05).mul(micro)));
    h.assign(
      float(0.55)
        .add(macro.sub(0.5).mul(0.14))
        .add(clump.sub(0.5).mul(0.16))
        .add(fine.sub(0.5).mul(0.075))
    );
    rough.assign(float(0.88).add(fine.sub(0.5).mul(0.14)).add(micro.sub(0.5).mul(0.1)));
    metal.assign(0.0);
    ao.assign(1.0);
    const pan = smoothstep(0.35, 0.65, macro).toVar();
    const mud = cracks(p.mul(2.4), P.mul(2.4), 0.85, 0.045, 0.35).mul(pan).toVar();
    h.subAssign(mud.mul(0.16));
    ao.subAssign(mud.mul(0.32));
    c.assign(mix(c, cWet.mul(0.7), mud.mul(0.75)));
    const plateLift = smoothstep(0.0, 0.1, mud).oneMinus().mul(pan).toVar();
    h.addAssign(plateLift.mul(0.01));
    const st = worley(p.mul(11.0), P.mul(11.0), 1.0).toVar();
    const stone = smoothstep(0.11, 0.3, st.x).oneMinus().mul(step(0.62, st.w)).toVar();
    const scol = mix(
      authoredColor(0.33, 0.315, 0.295),
      authoredColor(0.6, 0.575, 0.54),
      st.z
    ).toVar();
    c.assign(mix(c, scol, stone.mul(0.6)));
    h.addAssign(stone.mul(0.085));
    rough.assign(mix(rough, float(0.52).add(float(0.28).mul(st.z)), stone.mul(0.8)));
    ao.subAssign(smoothstep(0.28, 0.36, st.x).oneMinus().mul(step(0.62, st.w)).mul(0.1));
    const grit = worley(p.mul(22.0), P.mul(22.0), 1.0).toVar();
    const gritM = smoothstep(0.08, 0.26, grit.x).oneMinus().mul(step(0.55, grit.w)).toVar();
    c.assign(mix(c, mix(scol, cPale, grit.z), gritM.mul(0.4)));
    h.addAssign(gritM.mul(0.015));
    const litter = smoothstep(
      0.7,
      0.86,
      fbm01(fbm4(shear(p.mul(8.0), 1.0, 5.0), shearPeriod(P.mul(8.0), 5.0), 0.5))
    ).toVar();
    litter.mulAssign(smoothstep(0.4, 0.8, macro));
    c.assign(mix(c, authoredColor(0.33, 0.29, 0.16), litter.mul(0.5)));
    h.addAssign(litter.mul(0.012));
    rough.addAssign(litter.mul(0.05));
    const moss = smoothstep(0.74, 0.92, fbm01(fbm5(p.mul(4.5).add(19.0), P.mul(4.5), 0.6)))
      .mul(smoothstep(0.1, 0.5, macro).oneMinus())
      .toVar();
    c.assign(mix(c, authoredColor(0.15, 0.185, 0.105), moss.mul(0.65)));
    const cavity = float(1.0)
      .sub(smoothstep(0.4, 0.7, h))
      .toVar();
    ao.subAssign(cavity.mul(0.14));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.72))));
    rough.assign(clamp(rough, 0.45, 0.99));
    ao.assign(clamp(ao, 0.72, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);

// GRAVEL: authored channel stack migrated from surfaces-ground.js.
export const gravelSurface = Fn<[Node<'vec2'>, Node<'float'>], ReturnType<typeof Surface>>(
  ([coords, seed]): StructNode => {
    const alb = vec3(0.5).toVar(),
      h = float(0.5).toVar();
    const rough = float(0.5).toVar(),
      metal = float(0).toVar(),
      ao = float(1).toVar();
    const P = vec2(float(8.0)).toVar();
    const p = coords.mul(P).add(seed.mul(2.7)).toVar();
    const bed = fbm01(fbm4(p.mul(1.3), P.mul(1.3), 0.55)).toVar();
    const a = worley(p.mul(5.5), P.mul(5.5), 1.0).toVar();
    const b = worley(p.mul(10.0).add(5.0), P.mul(10.0), 1.0).toVar();
    const cSm = worley(p.mul(21.0).add(11.0), P.mul(21.0), 1.0).toVar();
    const sA = smoothstep(0.1, 0.36, a.x).oneMinus().mul(step(0.44, a.w)).toVar();
    const sB = smoothstep(0.08, 0.3, b.x).oneMinus().mul(step(0.62, b.w)).toVar();
    const sC = smoothstep(0.06, 0.24, cSm.x).oneMinus().mul(step(0.74, cSm.w)).toVar();
    const ha = sA.mul(0.15).mul(float(0.5).add(a.z)).toVar();
    const hb = sB.mul(0.09).mul(float(0.5).add(b.z)).toVar();
    const hc = sC.mul(0.025).toVar();
    h.assign(
      float(0.54)
        .add(bed.sub(0.5).mul(0.11))
        .add(max(max(ha, hb), hc))
        .add(float(0.22).mul(ha.add(hb)))
    );
    const s1 = authoredColor(0.372, 0.356, 0.332).toVar();
    const s2 = authoredColor(0.232, 0.22, 0.208).toVar();
    const s3 = authoredColor(0.462, 0.438, 0.4).toVar();
    const s4 = authoredColor(0.352, 0.276, 0.22).toVar();
    const top = mix(s1, s2, a.z).toVar();
    top.assign(mix(top, s3, step(0.78, a.w)));
    top.assign(mix(top, s4, step(0.9, b.w).mul(0.7)));
    const cBed = authoredColor(0.362, 0.336, 0.294).toVar();
    const c = mix(
      cBed,
      top,
      clamp(sA.mul(0.7).add(sB.mul(0.42)).add(sC.mul(0.16)), 0.0, 1.0)
    ).toVar();
    const grain = fbm01(fbm4(p.mul(13.0), P.mul(13.0), 0.5)).toVar();
    c.mulAssign(float(0.965).add(float(0.07).mul(grain)));
    rough.assign(
      float(0.82)
        .add(float(0.05).mul(grain))
        .add(
          float(1.0)
            .sub(clamp(sA.add(sB), 0.0, 1.0))
            .mul(0.06)
        )
        .sub(sA.mul(float(0.06).add(float(0.07).mul(a.z))))
        .sub(sB.mul(0.05).mul(b.z))
    );
    metal.assign(0.0);
    ao.assign(mix(0.87, 1.0, smoothstep(0.42, 0.66, h)));
    const dust = float(1.0)
      .sub(smoothstep(0.44, 0.62, h))
      .toVar();
    c.assign(mix(c, cBed.mul(1.04), dust.mul(0.5)));
    rough.addAssign(dust.mul(0.08));
    ao.assign(mix(ao, 1.0, dust.mul(0.3)));
    const drift = fbm01(
      fbm4(domainWarp(p.mul(0.9).add(17.0), P.mul(0.9), 0.8, 3), P.mul(0.9), 0.6)
    ).toVar();
    h.addAssign(drift.sub(0.5).mul(0.1));
    c.mulAssign(float(0.86).add(float(0.28).mul(drift)));
    rough.addAssign(drift.sub(0.5).mul(0.1));
    c.assign(
      mix(
        c,
        cBed.mul(float(0.92).add(float(0.22).mul(drift))),
        smoothstep(0.55, 0.88, drift).mul(0.72)
      )
    );
    const scuff = fbm01(
      fbm4(shear(p.mul(2.2), 0.0, 6.0), shearPeriod(P.mul(2.2), 6.0), 0.5)
    ).toVar();
    c.mulAssign(float(1.0).sub(smoothstep(0.55, 0.92, scuff).mul(0.1)));
    rough.subAssign(smoothstep(0.6, 0.95, scuff).mul(0.08));
    alb.assign(clamp(c, vec3(float(0.02)), vec3(float(0.78))));
    rough.assign(clamp(rough, 0.62, 0.99));
    ao.assign(clamp(ao, 0.72, 1.0));
    h.assign(clamp(h, 0.0, 1.0));
    return Surface(alb, h, rough, metal, ao);
  }
);
