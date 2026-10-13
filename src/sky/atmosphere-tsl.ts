import {
  Fn, If, Loop, abs, acos, clamp, cross, dot, exp, float, length, max,
  normalize, pow, sign, sqrt, texture, vec2, vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Texture } from 'three';
import { ATMO } from './atmosphere.ts';

const PI = Math.PI;
export const SK_PI = PI;
const ISO_PHASE = 1 / (4 * PI);

// GLSL literal formatting is gone with GLSL; TSL carries the numbers as nodes.
const SK_GROUND_R = float(ATMO.groundRadiusMM);
const SK_TOP_R = float(ATMO.atmosphereRadiusMM);
const SK_RAYLEIGH = vec3(ATMO.rayleigh[0], ATMO.rayleigh[1], ATMO.rayleigh[2]);
const SK_OZONE = vec3(ATMO.ozone[0], ATMO.ozone[1], ATMO.ozone[2]);
const SK_GROUND_ALBEDO = float(ATMO.groundAlbedo);

const safeAcos = (x: Node<'float'>) => acos(clamp(x, -1, 1));

/** Nearest positive hit of a ray against a sphere centred on the origin. */
export const skRaySphere = Fn<[Node<'vec3'>, Node<'vec3'>, Node<'float'>], Node<'float'>>(([ro, rd, rad]) => {
  const b = dot(ro, rd);
  const c = dot(ro, ro).sub(rad.mul(rad));
  const d = b.mul(b).sub(c);
  const sq = sqrt(max(d, 0));
  const near = b.negate().sub(sq);
  const far = b.negate().add(sq);
  // Straight-line port of the GLSL early returns.
  const inside = c.lessThanEqual(0).or(b.lessThanEqual(0));
  const t = d.greaterThan(b.mul(b)).select(far, near);
  return d.greaterThanEqual(0).and(inside).select(t, float(-1));
});

/** Rayleigh scattering coefficient at a point, in Mm^-1. */
export const skRayleighS = Fn<[Node<'vec3'>], Node<'vec3'>>(([pos]) => {
  const altKM = length(pos).sub(SK_GROUND_R).mul(1000);
  return SK_RAYLEIGH.mul(exp(altKM.negate().div(ATMO.rayleighScaleHeightKM)));
});

/** Mie scattering coefficient (aerosol multiplier included) at a point. */
export const skMieS = Fn<[Node<'vec3'>, Node<'float'>], Node<'float'>>(([pos, mieScale]) => {
  const altKM = length(pos).sub(SK_GROUND_R).mul(1000);
  return float(ATMO.mieScattering).mul(mieScale)
    .mul(exp(altKM.negate().div(ATMO.mieScaleHeightKM)));
});

/** Total extinction — Rayleigh + Mie (scatter+absorb) + ozone tent. */
export const skExtinction = Fn<[Node<'vec3'>, Node<'float'>], Node<'vec3'>>(([pos, mieScale]) => {
  const altKM = length(pos).sub(SK_GROUND_R).mul(1000);
  const rDen = exp(altKM.negate().div(ATMO.rayleighScaleHeightKM));
  const mDen = exp(altKM.negate().div(ATMO.mieScaleHeightKM));
  const rayon = SK_RAYLEIGH.mul(rDen);
  const mie = float(ATMO.mieScattering + ATMO.mieAbsorption).mul(mieScale).mul(mDen);
  const oz = SK_OZONE.mul(max(0, float(1).sub(
    abs(altKM.sub(ATMO.ozoneCentreKM)).div(ATMO.ozoneWidthKM)
  )));
  return rayon.add(vec3(mie)).add(oz);
});

/** Cornette-Shanks, the well-behaved cousin of Henyey-Greenstein. */
export const skMiePhase = Fn<[Node<'float'>], Node<'float'>>(([cosTheta]) => {
  const g = 0.8;
  const k = (3 / (8 * PI)) * (1 - g * g) / (2 + g * g);
  return float(k).mul(float(1).add(cosTheta.mul(cosTheta)))
    .div(pow(float(1 + g * g).sub(cosTheta.mul(2 * g)), 1.5));
});

export const skRayleighPhase = Fn<[Node<'float'>], Node<'float'>>(([cosTheta]) =>
  float(3 / (16 * PI)).mul(float(1).add(cosTheta.mul(cosTheta)))
);

/** Henyey-Greenstein — used by the ground fog, exposed here so both agree. */
export const skHG = Fn<[Node<'float'>, Node<'float'>], Node<'float'>>(([cosTheta, g]) => {
  const g2 = g.mul(g);
  const d = max(1e-4, float(1).add(g2).sub(cosTheta.mul(g).mul(2)));
  return float(1).sub(g2).div(float(4 * PI).mul(d).mul(sqrt(d)));
});

/**
 * Build the TSL atmosphere lookups bound to the shared uniform/texture records.
 *
 * `shared` carries the live uniform nodes (`uViewPos`, `uMieScale`) and the LUT
 * textures created by `luts.js`. The functions close over those records, so one
 * write to a shared uniform updates the bakes, the dome, the fog and the
 * environment material at once — the same trick the GLSL uniforms used.
 */
interface AtmosphereNodesContext { transmittanceTex: Texture; multiScatterTex: Texture; uViewPos: Node<'vec3'>; uMieScale: Node<'float'> }
interface AtmosphereLookup { skTransmittance: (pos: Node<'vec3'>, dir: Node<'vec3'>) => Node<'vec3'>; skMultiScatter: (pos: Node<'vec3'>, dir: Node<'vec3'>) => Node<'vec3'> }

export function createAtmosphereNodes(shared: AtmosphereNodesContext) {
  const { transmittanceTex, multiScatterTex } = shared;

  const skLutUv = Fn<[Node<'vec3'>, Node<'vec3'>], Node<'vec2'>>(([pos, dir]) => {
    const h = length(pos);
    const mu = dot(dir, pos.div(h));
    return vec2(
      clamp(mu.mul(0.5).add(0.5), 0, 1),
      clamp(h.sub(SK_GROUND_R).div(SK_TOP_R.sub(SK_GROUND_R)), 0, 1)
    );
  });

  /** Transmittance from pos along dir out to the top of the atmosphere. */
  const skTransmittance = Fn<[Node<'vec3'>, Node<'vec3'>], Node<'vec3'>>(([pos, dir]) =>
    texture(transmittanceTex, skLutUv(pos, dir)).rgb
  );

  const skMultiScatter = Fn<[Node<'vec3'>, Node<'vec3'>], Node<'vec3'>>(([pos, dir]) =>
    texture(multiScatterTex, skLutUv(pos, dir)).rgb
  );

  return { skLutUv, skTransmittance, skMultiScatter };
}

/**
 * Single + multiple scattering along a view ray, for two light sources at once
 * (sun and moon). Sharing the loop means the moon costs two LUT taps per step
 * rather than a second raymarch, which is what makes a physically lit night sky
 * affordable at all.
 */
export function createRaymarchSky({ skTransmittance, skMultiScatter, uMieScale }: AtmosphereLookup & { uMieScale: Node<'float'> }, steps: number) {
  return Fn<[Node<'vec3'>, Node<'vec3'>, Node<'vec3'>, Node<'vec3'>, Node<'vec3'>, Node<'vec3'>], Node<'vec3'>>(([pos, rayDir, sunDir, sunIrr, moonDir, moonIrr]) => {
    const topT = skRaySphere(pos, rayDir, SK_TOP_R);
    const groundT = skRaySphere(pos, rayDir, SK_GROUND_R);
    const tMax = groundT.lessThan(0).select(topT, groundT);
    const lum = vec3(0).toVar();
    const trans = vec3(1).toVar();
    const t = float(0).toVar();

    If(tMax.greaterThan(0), () => {
      const cS = dot(rayDir, sunDir);
      const cM = dot(rayDir, moonDir);
      const mieS = skMiePhase(cS);
      const rayS = skRayleighPhase(cS);
      const mieM = skMiePhase(cM);
      const rayM = skRayleighPhase(cM);

      Loop(steps, ({ i }) => {
        // 0.3 rather than 0.5 biases samples toward the dense lower atmosphere,
        // which is where all the interesting colour is.
        const nt = i.toFloat().add(0.3).div(steps).mul(tMax).toVar();
        const dt = nt.sub(t).toVar();
        t.assign(nt);
        const p = pos.add(rayDir.mul(t)).toVar();

        const rs = skRayleighS(p);
        const ms = skMieS(p, uMieScale);
        const ext = skExtinction(p, uMieScale);
        const sampleT = exp(dt.negate().mul(ext)).toVar();

        const tSun = skTransmittance(p, sunDir);
        const psiSun = skMultiScatter(p, sunDir);
        const inScatter = rs.mul(rayS.mul(tSun).add(psiSun))
          .add(vec3(ms).mul(mieS.mul(tSun).add(psiSun))).mul(sunIrr).toVar();

        const tMoon = skTransmittance(p, moonDir);
        const psiMoon = skMultiScatter(p, moonDir);
        inScatter.addAssign(
          rs.mul(rayM.mul(tMoon).add(psiMoon))
            .add(vec3(ms).mul(mieM.mul(tMoon).add(psiMoon)))
            .mul(moonIrr)
        );

        // Analytic integration of the segment (Hillaire eq. 8): exact for
        // constant media over dt, and it never overshoots a large optical depth.
        lum.addAssign(trans.mul(inScatter.sub(inScatter.mul(sampleT)))
          .div(max(ext, vec3(1e-8))));
        trans.mulAssign(sampleT);
      });
    });

    // No pi here. The integral above is sigma_s * P(theta) * E with E in scene
    // light units, which *is* a radiance in the buffer's own convention.
    return lum;
  });
}

/** Shared sky-view LUT lookup. Azimuth is relative to the sun. */
export function createSkyViewLookup({ uViewPos, skyViewTex }: { uViewPos: Node<'vec3'>; skyViewTex: Texture }) {
  return Fn<[Node<'vec3'>, Node<'vec3'>], Node<'vec3'>>(([rayDir, sunDir]) => {
    const h = length(uViewPos);
    const up = uViewPos.div(h);
    const horizon = safeAcos(sqrt(h.mul(h).sub(SK_GROUND_R.mul(SK_GROUND_R))).div(h));
    const altitude = horizon.sub(safeAcos(dot(rayDir, up)));
    const azimuth = float(0).toVar();

    If(abs(altitude).lessThan(0.5 * PI - 1e-4), () => {
      const right = cross(sunDir, up).toVar();
      const fwd = cross(up, right).toVar();
      const proj = normalize(rayDir.sub(up.mul(dot(rayDir, up)))).toVar();
      azimuth.assign(atan2Node(dot(proj, right), dot(proj, fwd)).add(PI));
    });

    const v = float(0.5).add(sign(altitude)
      .mul(sqrt(abs(altitude).mul(2).div(PI))).mul(0.5));
    return texture(skyViewTex, vec2(azimuth.div(2 * PI), v)).rgb;
  });
}

// TSL exposes a one-argument atan; GLSL's two-argument form is composed from
// the quadrant test so the LUT azimuth wraps exactly as the bake wrote it.
function atan2Node(y: Node<'float'>, x: Node<'float'>) {
  return Fn<[Node<'float'>, Node<'float'>], Node<'float'>>(([yy, xx]) => {
    const base = yy.div(xx).atan();
    return xx.lessThan(0)
      .select(yy.greaterThanEqual(0).select(base.add(PI), base.sub(PI)), base);
  })(y, x);
}

export { ISO_PHASE, SK_GROUND_R, SK_TOP_R, SK_RAYLEIGH, SK_OZONE, SK_GROUND_ALBEDO, PI };
