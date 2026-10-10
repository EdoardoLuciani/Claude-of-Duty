import {
  Fn, If, Loop, acos, cos, exp, float, int, max, mix, normalize, sin, sqrt, uv,
  vec3,
} from 'three/tsl';
import { RepeatWrapping } from 'three/webgpu';
import { hdrTarget, floatTarget, BakePass } from './bake.ts';
import {
  skRaySphere, skExtinction, skRayleighS, skMieS,
  SK_GROUND_R, SK_TOP_R, SK_GROUND_ALBEDO, SK_PI,
} from './atmosphere-tsl.js';

/**
 * The three atmosphere LUTs plus a 1x1 ambient probe — TSL port.
 *
 * Cost, measured on an M-series GPU:
 *   transmittance  256x64,  40 steps       ~0.15 ms   once, at boot
 *   multiscatter    32x32,  64 dirs x 20   ~0.9 ms    once, at boot
 *   sky-view       384x192, 40 steps       ~0.6 ms    only when the sun moves
 *   ambient probe    2x1,   64 taps        negligible only when the sun moves
 *
 * Nothing here runs per frame. A static time of day costs zero.
 */

const MS_STEPS = 20;
const SQRT_SAMPLES = 8;
const TS_STEPS = 40;
const AMBIENT_TAPS = 64;
const ISO_PHASE = 1 / (4 * SK_PI);

/** 256 x 64 transmittance bake. */
const transmittanceNode = (uMieScale) => Fn(([vUv]) => {
  const mu = vUv.x.mul(2).sub(1);
  const h = mix(SK_GROUND_R, SK_TOP_R, vUv.y);
  const pos = vec3(0, h, 0);
  const dir = vec3(sqrt(max(0, float(1).sub(mu.mul(mu)))), mu, 0);
  const result = vec3(0).toVar();
  const t = skRaySphere(pos, dir, SK_TOP_R).toVar();
  If(t.greaterThan(0), () => {
    const dt = t.div(TS_STEPS);
    const od = vec3(0).toVar();
    Loop(TS_STEPS, ({ i }) => {
      const p = pos.add(dir.mul(i.toFloat().add(0.5).mul(dt)));
      od.addAssign(skExtinction(p, uMieScale).mul(dt));
    });
    result.assign(exp(od.negate()));
  });
  return result;
});

/** 32 x 32 multiple-scattering bake. */
const multiScatterNode = (uMieScale, skTransmittance) => Fn(([vUv]) => {
  const mu = vUv.x.mul(2).sub(1);
  const h = mix(SK_GROUND_R.add(1e-5), SK_TOP_R, vUv.y);
  const pos = vec3(0, h, 0);
  const sunDir = normalize(vec3(sqrt(max(0, float(1).sub(mu.mul(mu)))), mu, 0));

  const lumTotal = vec3(0).toVar();
  const fmsTotal = vec3(0).toVar();
  const invSamples = 1 / (SQRT_SAMPLES * SQRT_SAMPLES);

  Loop(SQRT_SAMPLES, SQRT_SAMPLES, ({ i, j }) => {
      // Uniform on the sphere: theta linear, cos(phi) linear.
      const theta = float(SK_PI).mul(i.toFloat().add(0.5)).div(SQRT_SAMPLES);
      const phi = acos(float(1).sub(j.toFloat().add(0.5).mul(2).div(SQRT_SAMPLES)));
      const cp = cos(phi);
      const sp = sin(phi);
      const rayDir = vec3(sp.mul(sin(theta)), cp, sp.mul(cos(theta)));

      const topT = skRaySphere(pos, rayDir, SK_TOP_R);
      const grnT = skRaySphere(pos, rayDir, SK_GROUND_R);
      const tMax = grnT.lessThan(0).select(topT, grnT);

      If(tMax.greaterThan(0), () => {
        const lum = vec3(0).toVar();
        const fms = vec3(0).toVar();
        const trans = vec3(1).toVar();
        const t = float(0).toVar();
        Loop({ start: int(0), end: int(MS_STEPS), name: 's', condition: '<' }, ({ s }) => {
          const nt = s.toFloat().add(0.5).div(MS_STEPS).mul(tMax).toVar();
          const dt = nt.sub(t).toVar();
          t.assign(nt);
          const p = pos.add(rayDir.mul(t)).toVar();
          // Scattering media only (no absorption): rs + vec3(ms).
          const scatter = skRayleighS(p).add(vec3(skMieS(p, uMieScale)));
          const ext = skExtinction(p, uMieScale);
          const sampleT = exp(dt.negate().mul(ext)).toVar();

          // f_ms: the fraction of light that scatters at least once more.
          fms.addAssign(trans.mul(scatter.sub(scatter.mul(sampleT))).div(max(ext, vec3(1e-8))));

          const tSun = skTransmittance(p, sunDir);
          const inS = scatter.mul(ISO_PHASE).mul(tSun);
          lum.addAssign(trans.mul(inS.sub(inS.mul(sampleT))).div(max(ext, vec3(1e-8))));
          trans.mulAssign(sampleT);
        });

        If(grnT.greaterThan(0), () => {
          const hit = normalize(pos.add(rayDir.mul(grnT))).mul(SK_GROUND_R);
          If(hit.dot(sunDir).greaterThan(0), () => {
            lum.addAssign(trans.mul(SK_GROUND_ALBEDO).mul(skTransmittance(hit, sunDir)));
          });
        });

        lumTotal.addAssign(lum.mul(invSamples));
        fmsTotal.addAssign(fms.mul(invSamples));
      });
  });

  // Infinite geometric series of scattering orders, collapsed.
  return lumTotal.div(max(vec3(1).sub(fmsTotal), vec3(1e-4)));
});

/** 384 x 192 sky-view bake. */
const skyViewNode = (shared, skRaymarchSky) => Fn(([vUv]) => {
  const {
    uViewPos, uSunIrradiance, uMoonIrradiance, uSunAltitude, uMoonAltitude, uMoonRelAz,
  } = shared;
  const azimuth = vUv.x.sub(0.5).mul(2 * SK_PI);
  const v = vUv.y;
  const oneMinus2v = float(1).sub(v.mul(2));
  const twoVMinus1 = v.mul(2).sub(1);
  const adjV = v.lessThan(0.5)
    .select(oneMinus2v.mul(oneMinus2v).negate(), twoVMinus1.mul(twoVMinus1));

  const h = uViewPos.length();
  const horizon = acos(sqrt(h.mul(h).sub(SK_GROUND_R.mul(SK_GROUND_R))).div(h)).sub(0.5 * SK_PI);
  const altitude = adjV.mul(0.5 * SK_PI).sub(horizon);
  const ca = cos(altitude);
  const rayDir = vec3(ca.mul(sin(azimuth)), sin(altitude), ca.mul(cos(azimuth)).negate());

  // The LUT frame puts the sun at azimuth 0 (along -Z).
  const sunDir = vec3(0, sin(uSunAltitude), cos(uSunAltitude).negate());
  const cm = cos(uMoonAltitude);
  const moonDir = vec3(cm.mul(sin(uMoonRelAz)), sin(uMoonAltitude), cm.mul(cos(uMoonRelAz)).negate());

  return skRaymarchSky(vec3(uViewPos), rayDir, sunDir, uSunIrradiance, moonDir, uMoonIrradiance);
});

/**
 * Average sky radiance over the upper hemisphere (cosine weighted) and over the
 * lower hemisphere-facing band. texel 0 -> sky ambient, texel 1 -> horizon band.
 */
const ambientNode = (shared, skSkyView) => Fn(([vUv]) => {
  const { uSunAltitude } = shared;
  const sunDir = vec3(0, sin(uSunAltitude), cos(uSunAltitude).negate());
  const horizonBand = vUv.x.greaterThan(0.5);
  const sum = vec3(0).toVar();
  const wsum = float(0).toVar();

  Loop(AMBIENT_TAPS, ({ i }) => {
    // Fibonacci hemisphere.
    const fi = i.toFloat().add(0.5).div(AMBIENT_TAPS);
    const phi = i.toFloat().mul(2.39996323);
    const ct = horizonBand.select(mix(-0.12, 0.35, fi), sqrt(float(1).sub(fi)));
    const st = sqrt(max(0, float(1).sub(ct.mul(ct))));
    const d = vec3(st.mul(cos(phi)), ct, st.mul(sin(phi)));
    const w = horizonBand.select(float(1), max(0, ct));
    sum.addAssign(skSkyView(d, sunDir).mul(w));
    wsum.addAssign(w);
  });

  return sum.div(max(wsum, 1e-4));
});

export class SkyLuts {
  constructor(shared) {
    this.shared = shared;

    this.transmittanceRt = floatTarget(256, 64, { name: 'sky-transmittance' });
    this.multiScatterRt = hdrTarget(32, 32, { name: 'sky-multiscatter' });
    // 384x192 rather than Hillaire's 192x108: one texel is then under a degree
    // of azimuth, the difference between a readable warm band around a low sun
    // and a visibly interpolated smear.
    this.skyViewRt = hdrTarget(384, 192, { name: 'sky-view' });
    this.ambientRt = hdrTarget(2, 1, { name: 'sky-ambient' });
    this.skyViewRt.texture.wrapS = RepeatWrapping;

    shared.transmittanceTex = this.transmittanceRt.texture;
    shared.multiScatterTex = this.multiScatterRt.texture;
    shared.skyViewTex = this.skyViewRt.texture;
    shared.ambientTex = this.ambientRt.texture;
  }

  /** Create the bake materials once the bound lookups exist. */
  build({ uMieScale, skTransmittance, skRaymarchSky, skSkyView }) {
    // QuadMesh UVs already match native render-target sampling.
    const vUv = uv();
    this.transmittancePass = new BakePass('sky-transmittance', transmittanceNode(uMieScale)(vUv));
    this.multiScatterPass = new BakePass('sky-multiscatter',
      multiScatterNode(uMieScale, skTransmittance)(vUv));
    this.skyViewPass = new BakePass('sky-view', skyViewNode(this.shared, skRaymarchSky)(vUv));
    this.ambientPass = new BakePass('sky-ambient', ambientNode(this.shared, skSkyView)(vUv));
  }

  /** Altitude/aerosol dependent only — baked at boot, and if turbidity changes. */
  bakeStatic(renderer) {
    this.transmittancePass.render(renderer, this.transmittanceRt);
    this.multiScatterPass.render(renderer, this.multiScatterRt);
  }

  /** Sun/moon dependent. ~0.4 ms; called only when the sun has actually moved. */
  bakeSkyView(renderer) {
    this.skyViewPass.render(renderer, this.skyViewRt);
    this.ambientPass.render(renderer, this.ambientRt);
  }

  dispose() {
    this.transmittanceRt.dispose();
    this.multiScatterRt.dispose();
    this.skyViewRt.dispose();
    this.ambientRt.dispose();
    this.transmittancePass.dispose();
    this.multiScatterPass.dispose();
    this.skyViewPass.dispose();
    this.ambientPass.dispose();
  }
}
