import {
  Fn, If, abs, acos, cameraProjectionMatrixInverse, cameraWorldMatrix, clamp, cos,
  dot, exp, float, fwidth, max, min, mix, normalize, positionGeometry, pow,
  sin, smoothstep, sqrt, texture, vec2, vec3, vec4,
} from 'three/tsl';
import {
  BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial,
  NoBlending, Sphere, Vector3,
} from 'three/webgpu';
import { ATMO } from './atmosphere.ts';
import { SK_PI, SK_GROUND_R, skMiePhase } from './atmosphere-tsl.js';
import { fbm3 } from './noise.js';

/**
 * The visible sky — TSL port of the authored GLSL dome.
 *
 * One `skSample(rayDir)` function holds the whole identity, in the same layer
 * order as before:
 *   sky-view LUT  -> Rayleigh + Mie + ozone + multiple scattering
 *   aureoles      -> the Mie forward peak the LUT resolution destroys
 *   sun disc      -> limb darkened, extinguished by the view-path transmittance
 *   moon disc     -> procedural albedo, real terminator from the sun direction
 *   night sky     -> Milky Way, star layers, airglow, occluded by the decks
 *   clouds        -> cirrus then cumulus, lit by the same irradiances
 *   ground        -> first-bounce albedo below the horizon (matters for IBL)
 *
 * The screen variant keeps the star points and the solar disc; the environment
 * variant drops both (quality 0 in the old shader) so the PMREM integrates the
 * sky the camera actually sees without a four-decade disc in the input.
 */

const owSkLum = Fn(([c]) => dot(c, vec3(0.2126, 0.7152, 0.0722)));

/**
 * Build the sky sample. `shared` is the live uniform record; `deps` carries the
 * bound LUT lookups and the cloud/night sub-shaders.
 */
export function createSkySample(shared, deps, { points, moonOct }) {
  const {
    uViewPos, uMieScale, uSunDir, uMoonDir, uSunIrradiance, uMoonIrradiance,
    uSunDiscRadiance, uMoonDiscRadiance, uDisc, uGroundAlbedo, uHorizonMurk,
    uSkyRolloff, ambientTex,
  } = shared;
  const { skTransmittance, skSkyView, skClouds, skNightSky } = deps;

  const skAmbientSky = Fn(() => texture(ambientTex, vec2(0.25, 0.5)).rgb);
  const skAmbientHorizon = Fn(() => texture(ambientTex, vec2(0.75, 0.5)).rgb);

  /**
   * Radiance of the solar disc, limb darkened. The exponents are the per-channel
   * Hosek-Wilkie limb coefficients: blue falls off fastest, which is why the rim
   * of a low sun is orange while the centre stays white.
   */
  const skSunDisc = Fn(([theta]) => {
    const result = vec3(0).toVar();
    const R = uDisc.x.mul(uDisc.z);
    const aa = max(1e-6, fwidth(theta));
    const cover = smoothstep(R.add(aa), R.sub(aa), theta);
    If(cover.greaterThan(0), () => {
      const r = clamp(theta.div(R), 0, 1);
      const mu = sqrt(max(0, float(1).sub(r.mul(r))));
      const limb = vec3(mu).pow(vec3(0.32, 0.44, 0.58));
      // Enlarging the disc for readability must not add energy, so divide by the
      // area factor; bloom then behaves the same as it would at true angular size.
      result.assign(uSunDiscRadiance.mul(limb).mul(cover)
        .mul(skTransmittance(uViewPos, uSunDir)).div(uDisc.z.mul(uDisc.z)));
    });
    return result;
  });

  /**
   * Circumsolar aureole — the bright white halo that surrounds a real sun out to
   * ten or fifteen degrees, restoring the Mie forward peak the LUT destroys.
   */
  const skAureole = Fn(([rayDir, irradiance, cosTheta]) => {
    const result = vec3(0).toVar();
    const CUT = 0.9135; // cos(24 degrees)
    If(cosTheta.greaterThan(CUT), () => {
      const mieOd = float(ATMO.mieScattering).mul(uMieScale).mul(0.0012)
        .div(max(0.055, rayDir.y.add(0.055)));
      const excess = max(0, skMiePhase(cosTheta).sub(skMiePhase(float(CUT))));
      result.assign(irradiance.mul(skTransmittance(uViewPos, rayDir))
        .mul(excess.mul(mieOd).mul(4.2)));
    });
    return result;
  });

  /**
   * Highlight roll-off for the sky, and only for the sky. A POWER compressor on
   * luminance with the chromaticity carried through unchanged, so a sunset
   * horizon keeps its peach-to-crimson ramp instead of clipping to a plateau.
   */
  const skRolloff = Fn(([col]) => {
    const out = col.toVar();
    If(uSkyRolloff.x.greaterThan(0), () => {
      const l = max(owSkLum(col), 1e-6);
      If(l.greaterThan(uSkyRolloff.x), () => {
        out.assign(col.mul(pow(l.div(uSkyRolloff.x), uSkyRolloff.y)
          .mul(uSkyRolloff.x).div(l)));
      });
    });
    return out;
  });

  const skMoonDisc = Fn(([rayDir, theta]) => {
    const result = vec3(0).toVar();
    const R = uDisc.y.mul(uDisc.w);
    If(theta.lessThanEqual(R.mul(1.6)), () => {
      const ref = abs(uMoonDir.y).greaterThan(0.97).select(vec3(0, 0, 1), vec3(0, 1, 0));
      const mr = normalize(ref.cross(uMoonDir));
      const mu3 = uMoonDir.cross(mr);
      // Gnomonic projection is exact enough over a quarter of a degree.
      const p = vec2(dot(rayDir, mr), dot(rayDir, mu3)).div(R);
      const r2 = dot(p, p);
      const aa = max(1e-4, fwidth(r2).mul(1.9));
      const cover = smoothstep(float(1).add(aa), float(1).sub(aa), r2);
      If(cover.greaterThan(0), () => {
        const n = normalize(mr.mul(p.x).add(mu3.mul(p.y))
          .sub(uMoonDir.mul(sqrt(max(0, float(1).sub(min(r2, 1)))))));

        // Maria are basalt floods over anorthositic highlands: 0.06 vs 0.14.
        const highlands = fbm3(moonOct)(n.mul(6.5));
        const maria = smoothstep(0.44, 0.63, fbm3(Math.max(2, moonOct - 1))(n.mul(2.1).add(5.0)));
        const albedo = mix(0.105, 0.155, highlands).mul(mix(1.0, 0.52, maria));

        const NdL = max(0, dot(n, uSunDir));
        // Lunar regolith backscatters hard: nearly flat up to the terminator.
        const shade = pow(NdL, 0.42);
        const earthshine = 0.014;
        result.assign(uMoonDiscRadiance.mul(albedo.div(0.13))
          .mul(shade.add(earthshine)).mul(cover));
      });
    });
    return result;
  });

  return Fn(([rayDirIn]) => {
    const rayDir = normalize(rayDirIn);
    const ambSky = skAmbientSky();
    const ambHor = skAmbientHorizon();
    const col = skSkyView(rayDir, uSunDir).toVar();

    const cosS = dot(rayDir, uSunDir);
    const cosM = dot(rayDir, uMoonDir);
    const thetaS = acos(clamp(cosS, -1, 1));
    const thetaM = acos(clamp(cosM, -1, 1));

    // Aureoles go in before the discs so the discs sit *inside* their own glow.
    col.addAssign(skAureole(rayDir, uSunIrradiance, cosS));
    col.addAssign(skAureole(rayDir, uMoonIrradiance, cosM));

    // ---- clouds -------------------------------------------------------------
    // Each deck samples the transmittance LUT at its own altitude, which is what
    // makes a sunset read as pink cirrus over orange-grey cumulus.
    const pLow = vec3(0, SK_GROUND_R.add(float(0.0015)), 0);
    const pHigh = vec3(0, SK_GROUND_R.add(float(0.0078)), 0);
    const sunLow = uSunIrradiance.mul(skTransmittance(pLow, uSunDir));
    const sunHigh = uSunIrradiance.mul(skTransmittance(pHigh, uSunDir));
    const moonLow = uMoonIrradiance.mul(skTransmittance(pLow, uMoonDir));
    const moonHigh = uMoonIrradiance.mul(skTransmittance(pHigh, uMoonDir));
    const cl = skClouds(rayDir, uSunDir, sunLow, sunHigh, uMoonDir, moonLow, moonHigh, ambSky);

    // ---- night sky, BEHIND the decks ---------------------------------------
    const night = skNightSky(rayDir);
    col.addAssign(night.mul(float(1).sub(clamp(cl.a.mul(1.9), 0, 1))));

    If(cl.a.greaterThan(1e-4), () => {
      // Aerial perspective on the decks themselves, keyed off view elevation.
      const bleed = float(1).sub(smoothstep(0, 0.22, rayDir.y));
      col.assign(mix(col, mix(cl.rgb, col, bleed.mul(0.82)), cl.a));
    });

    // ---- ground / below the horizon ----------------------------------------
    If(rayDir.y.lessThan(0), () => {
      // First bounce off the street: what fills the lower hemisphere of the IBL.
      const ground = uGroundAlbedo.mul(
        ambHor
          .add(uSunIrradiance.mul(max(0, uSunDir.y)).div(SK_PI))
          .add(uMoonIrradiance.mul(max(0, uMoonDir.y)).div(SK_PI))
      );
      col.assign(mix(col, ground, smoothstep(0, -0.22, rayDir.y)));
    });

    // A real city horizon is never clean: dust and exhaust pile up at eye level.
    const murk = uHorizonMurk.mul(exp(abs(rayDir.y).mul(-26)));
    col.assign(mix(col, ambHor.mul(1.15), clamp(murk, 0, 0.85)));

    col.assign(skRolloff(col));

    // The discs go in AFTER the roll-off: they are supposed to clip and bloom.
    if (points) col.addAssign(skSunDisc(thetaS));
    col.addAssign(skMoonDisc(rayDir, thetaM));

    return max(col, vec3(0));
  });
}

/** Equirectangular direction, matching three's `equirectUv` exactly. */
export const dirFromEquirectUv = Fn(([uv]) => {
  const az = uv.x.sub(0.5).mul(2 * SK_PI);
  const lat = uv.y.sub(0.5).mul(SK_PI);
  const cl = cos(lat);
  return vec3(cl.mul(cos(az)), sin(lat), cl.mul(sin(az)));
});

const _domeGeometry = new BufferGeometry();
_domeGeometry.setAttribute('position', new BufferAttribute(
  new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
_domeGeometry.boundingSphere = new Sphere(new Vector3(), 1e8);

/**
 * The screen coordinate of the full-screen triangle, as 0..1 uv (y up).
 * Carrying it as a varying is what makes the ray reconstruction independent of
 * the renderer's screen-space conventions.
 */
const SKY_UV = positionGeometry.xy.mul(0.5).add(0.5).toVarying('vSkyUv');

/**
 * The visible sky as a full-screen triangle drawn in the world scene — the TSL
 * equivalent of the GLSL dome. The ray is rebuilt from the camera matrices, so
 * it picks up the renderer's jitter/velocity exactly as the rest of the frame
 * does, and nothing about the triangle's transform can rotate it.
 *
 * It opts out of the prepass and native shadow casting, so
 * the world owner keeps it out of the depth/normal prepass and the cascades.
 */
export function createSkyDome(skyScreen) {
  const material = new MeshBasicNodeMaterial({
    name: 'sky-dome',
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    toneMapped: false,
    side: DoubleSide,
  });
  // The triangle is already in clip space: position.xy is the NDC. z = 1 puts
  // it on the far plane, but the material has depth test/write off anyway.
  material.vertexNode = vec4(positionGeometry.xy, float(1), float(1));
  material.colorNode = skyScreen(dirFromCamera(SKY_UV));

  const mesh = new Mesh(_domeGeometry, material);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10000;
  mesh.matrixAutoUpdate = false;
  mesh.userData.owNoPrepass = true;
  mesh.castShadow = false;
  return mesh;
}

/** World ray through a screen UV, using the live camera matrices. */
export const dirFromCamera = Fn(([uv]) => {
  const ndc = uv.mul(2).sub(1);
  const h = cameraProjectionMatrixInverse.mul(vec4(ndc, 1, 1));
  const vd = h.xyz.div(h.w);
  const vn = vd.div(max(1e-6, vd.z.negate()));
  return normalize(cameraWorldMatrix.mul(vec4(vn, 0)).xyz);
});
