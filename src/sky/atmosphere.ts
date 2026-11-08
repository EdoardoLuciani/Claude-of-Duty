/** CPU constants/photometry for Hillaire-style transmittance, multiscatter and sky-view LUTs.
 * Lengths use megametres and medium coefficients Mm^-1; retain Rayleigh/Mie/ozone profiles.
 * 1 light unit = SCENE_LUX lux and 1 radiance unit = SCENE_LUX cd/m².
 * Three's Lambert BRDF already includes 1/pi: write integrated sky radiance as-is,
 * never multiply it by pi. Cloud irradiance and ground bounce divide by pi.
 */

export const SCENE_LUX = 25000;

/** Extraterrestrial solar illuminance, in scene light units. */
export const SUN_ILLUMINANCE_TOP = 128000 / SCENE_LUX; // 5.12

/** Moonlight in scene light units. The reviewed 0.03 baseline exaggerates physical
 * moonlight for display readability while keeping lamp pools distinct. Disc, sky
 * and ground share the level so their relative photometry stays consistent.
 */
export const MOON_ILLUMINANCE_NIGHT = 0.03;

export type RGB = [number, number, number];

export const ATMO = {
  groundRadiusMM: 6.36,
  atmosphereRadiusMM: 6.46,
  /** Viewer altitude. 200 m puts us above the thickest aerosol, like a city. */
  viewAltitudeMM: 0.0002,
  rayleigh: [5.802, 13.558, 33.1],
  rayleighScaleHeightKM: 8.0,
  mieScattering: 3.996,
  mieAbsorption: 4.4,
  mieScaleHeightKM: 1.2,
  ozone: [0.65, 1.881, 0.085],
  ozoneCentreKM: 25.0,
  ozoneWidthKM: 15.0,
  groundAlbedo: 0.24,
} satisfies Record<string, number | RGB>; // per-channel coefficients infer as RGB tuples

function mediumJs(altKM: number, mieScale: number, out: RGB): RGB {
  const rDen = Math.exp(-altKM / ATMO.rayleighScaleHeightKM);
  const mDen = Math.exp(-altKM / ATMO.mieScaleHeightKM);
  const mie = (ATMO.mieScattering + ATMO.mieAbsorption) * mieScale * mDen;
  const oz = Math.max(0, 1 - Math.abs(altKM - ATMO.ozoneCentreKM) / ATMO.ozoneWidthKM);
  out[0] = ATMO.rayleigh[0] * rDen + mie + ATMO.ozone[0] * oz;
  out[1] = ATMO.rayleigh[1] * rDen + mie + ATMO.ozone[1] * oz;
  out[2] = ATMO.rayleigh[2] * rDen + mie + ATMO.ozone[2] * oz;
  return out;
}

const _ext: RGB = [0, 0, 0];

/**
 * Per-channel transmittance from the viewer to space along a direction whose
 * cosine with the local zenith is `mu`. Same integral as the GPU LUT bake, so
 * the sun's DirectionalLight colour and the sky it hangs in cannot disagree.
 * Runs ~48 steps; called only when the sun actually moves.
 */
export function transmittanceToSpace(mu: number, mieScale = 1, out: RGB = [0, 0, 0]): RGB {
  const R = ATMO.groundRadiusMM + ATMO.viewAltitudeMM;
  const top = ATMO.atmosphereRadiusMM;
  // Ray from (0,R,0) with vertical component mu. Path length to the top shell.
  const disc = R * R * mu * mu - R * R + top * top;
  if (disc <= 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const tTop = -R * mu + Math.sqrt(disc);
  // Below the horizon the ground blocks us entirely.
  const gDisc = R * R * mu * mu - R * R + ATMO.groundRadiusMM * ATMO.groundRadiusMM;
  if (mu < 0 && gDisc > 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const N = 48;
  const dt = tTop / N;
  let od0 = 0;
  let od1 = 0;
  let od2 = 0;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * dt;
    // |(0,R,0) + t*dir| with dir.y = mu
    const h = Math.sqrt(R * R + t * t + 2 * R * t * mu);
    const altKM = (h - ATMO.groundRadiusMM) * 1000;
    mediumJs(Math.max(0, altKM), mieScale, _ext);
    od0 += _ext[0] * dt;
    od1 += _ext[1] * dt;
    od2 += _ext[2] * dt;
  }
  out[0] = Math.exp(-od0);
  out[1] = Math.exp(-od1);
  out[2] = Math.exp(-od2);
  return out;
}
