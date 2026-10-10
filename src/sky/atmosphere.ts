/**
 * Physical atmosphere model — constants and the CPU half.
 *
 * This is Bruneton's scattering integral evaluated the way Hillaire 2020
 * ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique")
 * does it: three small LUTs instead of a per-pixel double raymarch.
 *
 *   transmittance   256 x 64   T(altitude, cos zenith)      baked once
 *   multiscatter     32 x 32   psi_ms(altitude, cos zenith) baked once
 *   sky-view        384 x 192  L(azimuth, altitude)         rebaked when the sun moves
 *
 * The GPU half — the media sampling, the phase functions and the raymarch —
 * lives in `atmosphere-tsl.js`. This file stays plain JS so the CPU photometry
 * (sun/moon light colours and the LUT parameterisation) can be shared and
 * unit-tested without a GPU.
 *
 * Media, in Hillaire's units (lengths in megametres, coefficients in Mm^-1):
 *   Rayleigh   exponential, scale height 8 km,   sigma_s = (5.802, 13.558, 33.1)
 *   Mie        exponential, scale height 1.2 km, sigma_s = 3.996, sigma_a = 4.40
 *   Ozone      tent centred at 25 km,            sigma_a = (0.650, 1.881, 0.085)
 *
 * The ozone layer is not a nicety: it is what removes the green from the deep
 * zenith blue and what turns the twilight band violet instead of brown.
 *
 * ---------------------------------------------------------------------------
 * PHOTOMETRIC SCALE — read this before changing a number anywhere in src/sky/
 * ---------------------------------------------------------------------------
 * The renderer's fallback sun is intensity 4.3 and its fallback sky env peaks
 * around 0.34, so the engine's working unit is roughly "25 klx". We adopt that
 * exactly, because every other subsystem has been tuned against it:
 *
 *     1 light intensity unit      =  SCENE_LUX (25000) lux
 *     1 framebuffer radiance unit =  SCENE_LUX cd/m^2
 *
 * Derive the second from the first and do not guess at it, because a factor of
 * pi here is 1.65 stops of sky. three's Lambert BRDF carries the 1/pi: a white
 * surface facing a light of intensity I writes b = I/pi into the buffer, while
 * its physical radiance is L = (I * SCENE_LUX) / pi cd/m^2. Therefore
 * L = b * SCENE_LUX, and a scattering integral that already evaluates a
 * *radiance* — which sigma_s * P(theta) * E is, once E is expressed in scene
 * light units — is written to the buffer as-is. It must NOT be multiplied by pi
 * on the way out.
 *
 * That multiplication used to be here, and it is exactly why every daylight
 * shot read as milk: the sky came out 1.65 stops hotter than the surfaces it was
 * lighting, so a sunlit stucco wall was *darker* than the sky behind it, the
 * cumulus deck was darker than the gap between the clouds, and the AgX shoulder
 * dumped what was left of the hue. The cloud decks and the ground bounce divide
 * their irradiance by pi to reach the same convention.
 *
 * Consequences, all of which fall out of the model rather than being dialled in:
 *   extraterrestrial solar illuminance 128 klx -> 5.12 units
 *   noon sun after atmospheric extinction      -> ~3.9 units   (matches 4.3)
 *   clear zenith sky ~1500 cd/m^2              -> ~0.06 radiance units
 *   sunlit stucco (albedo 0.4, 45 deg)         -> ~0.32 radiance units
 *   whole-sky diffuse illuminance              -> ~15% of the sun
 */

export const SCENE_LUX = 25000;

/** Extraterrestrial solar illuminance, in scene light units. */
export const SUN_ILLUMINANCE_TOP = 128000 / SCENE_LUX; // 5.12

/**
 * Moonlight, in scene light units. A real full moon is 0.27 lux — 1e-5 units —
 * which is four stops below anything a display can show alongside a muzzle
 * flash. Every shipped game renders "day for night" instead; this is that
 * decision, made once, in one place, rather than smeared across the shaders.
 * 0.03 is the reviewed night baseline: one tenth of the former 0.30.
 * The same level drives the ground, atmosphere and clouds, leaving lamp pools
 * distinct without turning the sky into blue daytime.
 * Ratios *within* the night (moon disc : moonlit sky : moonlit ground) stay
 * physical, so the frame still behaves like a photograph of a moonlit street.
 */
export const MOON_ILLUMINANCE_NIGHT = 0.03;

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
};

type RGB = [number, number, number];
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

/** Rec.709 luminance — used to split transmittance into colour + intensity. */
export function luminance(rgb: readonly number[]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
