import {
  Fn, If, abs, clamp, cos, dot, exp, float, max, mix, normalize, pow, sin,
  smoothstep, vec2, vec3, vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { fbm2, ridge2, skVal2 } from './noise.js';
import { skHG, skRaySphere, SK_GROUND_R, SK_PI } from './atmosphere-tsl.js';

/**
 * Two procedural cloud decks on the sky shell — TSL port.
 *
 * The shape, the lighting and every constant are the authored GLSL; only the
 * spelling changed. The octave counts are compile-time factory parameters so a
 * single pass can ask for the screen-quality decks and the environment bake for
 * the cheaper ones, exactly as the `quality` flag used to do inside the shader.
 *
 * Radiance convention: sunLow/sunHigh arrive as *irradiance* in scene light
 * units, so every direct term is divided by pi to become framebuffer radiance.
 */

const SK_CUMULUS_KM = 1.5;
const SK_CIRRUS_KM = 7.8;

/** Weather-scale coverage, in kilometres. Mirrored exactly on the CPU. */
const skCloudMacro = Fn<[Node<'vec2'>], Node<'float'>>(([p]) => {
  const a = sin(p.x.mul(0.412).add(0.7)).mul(cos(p.y.mul(0.331).sub(0.4)));
  const b = sin(p.x.mul(0.173).sub(p.y.mul(0.209)).add(1.9));
  const c = cos(p.x.mul(0.0871).add(p.y.mul(0.1123)).sub(0.6));
  return clamp(float(0.5).add(float(0.5).mul(
    a.mul(0.42).add(b.mul(0.36)).add(c.mul(0.30))
  )), 0, 1);
});

/**
 * Ridged noise with a *parabolic* crest instead of an absolute-value one. The
 * crease of `1 - |2v-1|` is the cauliflower edge on the cumulus, but on an
 * anisotropic field stretched across the sky it is a pen stroke; `1 - (2v-1)^2`
 * has the same crest lines and a soft shoulder.
 */
const smoothRidge2 = (octaves: number) => Fn<[Node<'vec2'>], Node<'float'>>(([p]) => {
  const a = float(0.62).toVar();
  const s = float(0).toVar();
  const n = float(0).toVar();
  const q = p.toVar();
  for (let i = 0; i < octaves; i++) {
    const v = skVal2(q).mul(2).sub(1);
    s.addAssign(a.mul(float(1).sub(v.mul(v))));
    n.addAssign(a);
    q.assign(vec2(q.x.mul(0.8).sub(q.y.mul(0.6)), q.x.mul(0.6).add(q.y.mul(0.8)))
      .mul(2.17).add(3.71));
    a.mulAssign(0.45);
  }
  return s.div(max(n, 1e-4));
});

/**
 * One family of cirrus, p in kilometres on the deck.
 *
 * The silhouette is an isotropic warped fbm that is thresholded, so it cannot
 * streak or whorl; the anisotropic field only *modulates* the density inside
 * the patch. Two families (seeded differently, 75 degrees apart) guarantee the
 * frame never contains a single vanishing point.
 */
const skCirrusBand = ({ octC }: { octC: number }) => Fn<[Node<'vec2'>, Node<'float'>, Node<'float'>, Node<'float'>, Node<'float'>, Node<'float'>, Node<'float'>], Node<'float'>>(([p, cov, seed, base, rotKmInv, lenKM, aniso]) => {
  const d = float(0).toVar();
  const w = vec2(
    skVal2(p.mul(0.30).add(seed)),
    skVal2(p.mul(0.30).add(seed).add(11.7))
  ).sub(0.5);
  const n = fbm2(octC + 1)(p.mul(0.78).add(w.mul(1.3)));
  d.assign(smoothstep(float(1).sub(cov.mul(1.65)), float(1).sub(cov.mul(0.60)), n));

  If(d.greaterThan(0.001), () => {
    d.mulAssign(smoothstep(0.36, 0.66, skVal2(p.mul(0.12).add(seed.mul(0.5)))));
    If(d.greaterThan(0.001), () => {
      const ang = base.add(skVal2(p.mul(rotKmInv).add(seed)).sub(0.5).mul(1.1));
      const ca = cos(ang);
      const sa = sin(ang);
      const pr = vec2(p.x.mul(ca).sub(p.y.mul(sa)), p.x.mul(sa).add(p.y.mul(ca)));
      const fa = float(1).div(max(0.4, lenKM));
      const q = vec2(pr.x.mul(fa), pr.y.mul(fa).mul(aniso));
      d.mulAssign(float(0.35).add(float(1.05).mul(smoothRidge2(octC)(q.add(vec2(seed, seed))))));
    });
  });
  return d;
});

/** Cumulus optical thickness at a point on the deck, p in kilometres. */
interface CloudShaderUniforms { uViewPos: Node<'vec3'>; uCloudParams: Node<'vec4'>; uCloudParams2: Node<'vec4'> }
type CloudDensityFn = (point: Node<'vec2'>) => Node<'float'>;

const skCumulusDensity = ({ uCloudParams, detail }: { uCloudParams: Node<'vec4'>; detail: boolean }) => Fn<[Node<'vec2'>], Node<'float'>>(([p]) => {
  const macro = skCloudMacro(p.mul(0.22));
  const cov = clamp(uCloudParams.x.mul(float(0.34).add(macro.mul(1.30))), 0, 1);
  const w = vec2(
    skVal2(p.mul(0.42)),
    skVal2(p.mul(0.42).add(19.7))
  ).sub(0.5);
  const n = fbm2(detail ? 6 : 3)(p.mul(1.25).add(w.mul(1.6)));
  const d = smoothstep(float(1).sub(cov), float(1).sub(cov.mul(0.34)).add(0.05), n).toVar();

  if (detail) {
    If(d.greaterThan(0).and(d.lessThan(0.94)), () => {
      const e = ridge2(3)(p.mul(5.3).add(w.mul(2.0)));
      d.assign(clamp(d.sub(float(1).sub(d).mul(float(0.50).sub(e.mul(0.50)))), 0, 1));
    });
  }
  return d;
});

/**
 * Fraction of sunlight reaching a point on the cumulus deck. Marched along the
 * sun's horizontal projection; the low-sun path through the slab is longer,
 * which is why sunset clouds go dark grey underneath and blaze at the top.
 */
const skCumulusLight = ({ uCloudParams, density }: { uCloudParams: Node<'vec4'>; density: CloudDensityFn }) => Fn<[Node<'vec2'>, Node<'vec3'>], Node<'float'>>(([p, lightDir]) => {
  const step2 = normalize(lightDir.xz.add(vec2(1e-4)))
    .mul(float(0.20).div(max(0.12, abs(lightDir.y))));
  let tau = density(p.add(step2.mul(1.0))).mul(1.0);
  tau = tau.add(density(p.add(step2.mul(2.4))).mul(0.7));
  tau = tau.add(density(p.add(step2.mul(4.6))).mul(0.4));
  return exp(tau.negate().mul(uCloudParams.y).mul(2.1));
});

/**
 * Build the cloud composite for a view ray.
 * Returns rgb = radiance, a = coverage (0 lets the sky through untouched).
 */
export function createCloudNodes(shared: CloudShaderUniforms, { detail = true, octC = 2 }: { detail?: boolean; octC?: number } = {}) {
  const { uViewPos, uCloudParams, uCloudParams2 } = shared;
  const density = skCumulusDensity({ uCloudParams, detail });
  const light = skCumulusLight({ uCloudParams, density });
  const cirrusBand = skCirrusBand({ octC });

  const skClouds = Fn<[Node<'vec3'>, Node<'vec3'>, Node<'vec3'>, Node<'vec3'>, Node<'vec3'>, Node<'vec3'>, Node<'vec3'>, Node<'vec3'>], Node<'vec4'>>(([rayDir, sunDir, sunLow, sunHigh, moonDir, moonLow, moonHigh, ambient]) => {
    const out = vec4(0).toVar();
    If(rayDir.y.greaterThanEqual(-0.008), () => {
      const t = uCloudParams.w;
      const wind = vec2(uCloudParams2.z, uCloudParams2.w).mul(t);
      const cosSun = dot(rayDir, sunDir);
      const cosMoon = dot(rayDir, moonDir);

      // ---- cirrus, 7.8 km --------------------------------------------------
      const cirrus = vec4(0).toVar();
      const tc = skRaySphere(uViewPos, rayDir, SK_GROUND_R.add(float(SK_CIRRUS_KM * 0.001)));
      If(tc.greaterThan(0), () => {
        const distKM = tc.mul(1000);
        let fade = float(1).sub(smoothstep(22.0, 90.0, distKM));
        fade = fade.mul(float(1).sub(smoothstep(0.55, 0.85, rayDir.y).mul(0.66)));
        If(fade.greaterThan(0.004), () => {
          const p = vec3(uViewPos).add(rayDir.mul(tc)).xz.mul(1000).add(wind.mul(2.4));
          const cov = clamp(uCloudParams2.x, 0, 1);
          const d1 = cirrusBand(p, cov, 0.0, 0.24, 0.135, 1.5, 4.0);
          const d2 = cirrusBand(p.add(137.4), cov.mul(0.92), 4.7, 1.56, 0.098, 2.0, 3.4);
          const d = float(1).sub(float(1).sub(d1).mul(float(1).sub(d2.mul(0.85))));
          const a = clamp(d.mul(uCloudParams2.y).mul(fade), 0, 0.70);
          const fwd = skHG(cosSun, float(0.74)).mul(3.2).add(0.60);
          const col = sunHigh.mul(fwd)
            .add(moonHigh.mul(skHG(cosMoon, float(0.68)).mul(2.8).add(0.55)))
            .div(SK_PI).add(ambient.mul(0.85));
          cirrus.assign(vec4(col, a));
        });
      });

      // ---- cumulus, 1.5 km -------------------------------------------------
      const cumulus = vec4(0).toVar();
      const tk = skRaySphere(uViewPos, rayDir, SK_GROUND_R.add(float(SK_CUMULUS_KM * 0.001)));
      If(tk.greaterThan(0), () => {
        const distKM = tk.mul(1000);
        const fade = float(1).sub(smoothstep(14.0, 130.0, distKM));
        If(fade.greaterThan(0.004), () => {
          const p0 = vec3(uViewPos).add(rayDir.mul(tk)).xz.mul(1000).add(wind);
          const dBase = density(p0);
          const shear = rayDir.xz.mul(dBase.mul(0.85).div(max(0.10, rayDir.y)));
          const d = max(density(p0.add(shear)), dBase.mul(0.55));
          If(d.greaterThan(0.003), () => {
            const p = p0.add(shear);
            const lit = light(p, sunDir);
            const litM = light(p, moonDir);
            const graze = clamp(float(0.09).div(abs(rayDir.y).add(0.09)), 0, 1);
            const thick = d.mul(uCloudParams.y).mul(mix(float(1), float(1.7), graze));
            const a = clamp(float(1).sub(exp(thick.mul(3.4).negate())), 0, 1).mul(fade);
            const powder = float(1).sub(exp(thick.mul(5.5).negate()));
            const rim = pow(clamp(float(1).sub(d), 0, 1), 2);
            const fwdS = skHG(cosSun, float(0.62)).mul(4.0).add(0.62);
            const fwdM = skHG(cosMoon, float(0.60)).mul(3.4).add(0.55);
            const direct = sunLow.mul(
              lit.mul(float(0.55).add(powder.mul(0.45))).mul(fwdS).add(rim.mul(lit).mul(0.9))
            ).add(moonLow.mul(
              litM.mul(float(0.55).add(powder.mul(0.45))).mul(fwdM).add(rim.mul(litM).mul(0.9))
            ));
            const fill = ambient.mul(mix(0.50, 1.5, clamp(d.mul(1.6), 0, 1)))
              .mul(float(0.32).add(lit.mul(0.68)));
            cumulus.assign(vec4(direct.div(SK_PI).add(fill), a));
          });
        });
      });

      const outA = cirrus.a.add(cumulus.a.mul(float(1).sub(cirrus.a)));
      const outC = cirrus.rgb.mul(cirrus.a)
        .add(cumulus.rgb.mul(cumulus.a).mul(float(1).sub(cirrus.a)));
      out.assign(vec4(outC.div(max(outA, 1e-5)), outA));
    });
    return out;
  });

  /**
   * Sunlight reaching the ground through the cumulus deck, for a world XZ point.
   * The volumetric fog uses this so shafts carry the cloud pattern.
   */
  const skCloudShadow = Fn<[Node<'vec2'>, Node<'vec3'>], Node<'float'>>(([worldXZ, sunDir]) => {
    const p = worldXZ.mul(0.001).add(sunDir.xz.mul(
      float(SK_CUMULUS_KM).div(max(0.10, sunDir.y))
    )).add(vec2(uCloudParams2.z, uCloudParams2.w).mul(uCloudParams.w));
    const d = density(p);
    return exp(d.negate().mul(uCloudParams.y).mul(2.4));
  });

  return { skClouds, skCloudShadow };
}
