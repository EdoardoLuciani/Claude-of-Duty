/**
 * Central tuning + quality configuration.
 * Subsystems read from here rather than hardcoding magic numbers, so the
 * quality scaler and the capture harness can drive everything from one place.
 *
 * `dprCap` caps the device-pixel-ratio multiplier on the internal render
 * target. Every preset is 1, so a high-DPR display never renders above CSS
 * resolution; `renderScale` is the remaining resolution lever.
 */

export const PHYSICS_HZ = 120;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this many physics steps in one frame (spiral-of-death guard). */
export const MAX_SUBSTEPS = 8;

/** Real-world units are metres, seconds, kilograms. */
export const UNITS = {
  gravity: -9.81 * 2.1, // Games use exaggerated gravity; CoD-like feel.
  playerHeight: 1.78,
  playerCrouchHeight: 1.12,
  playerRadius: 0.32,
  eyeOffset: 0.12, // below top of capsule
};

export const QUALITY_PRESETS = {
  low: {
    renderScale: 0.72,
    dprCap: 1.0,
    shadowMapSize: 1024,
    cascades: 3,
    shadowDistance: 60,
    taa: false,
    gtao: false,
    volumetrics: false,
    bloom: true,
    anisotropy: 4,
    particleBudget: 1500,
    decalBudget: 48,
  },
  medium: {
    renderScale: 0.8,
    dprCap: 1.0,
    shadowMapSize: 2048,
    cascades: 3,
    shadowDistance: 80,
    taa: true,
    gtao: true,
    volumetrics: true,
    bloom: true,
    anisotropy: 8,
    particleBudget: 4500,
    decalBudget: 96,
  },
  high: {
    renderScale: 1.0,
    dprCap: 1.0,
    shadowMapSize: 2048,
    cascades: 3,
    shadowDistance: 130,
    taa: true,
    gtao: true,
    volumetrics: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 9000,
    decalBudget: 192,
  },
  ultra: {
    renderScale: 1.0,
    dprCap: 1.0,
    shadowMapSize: 2048,
    cascades: 4,
    shadowDistance: 160,
    taa: true,
    gtao: true,
    volumetrics: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 16000,
    decalBudget: 320,
  },
};

export const DEFAULTS = {
  // 'high' balances GPU cost; 'ultra' retains an extra shadow cascade and
  // larger particle/decal budgets, one click away.
  quality: 'high' as const,
  fov: 80, // horizontal-ish vertical FOV, CoD default feel
  // ADS magnification: hip 80 deg -> 49.6 deg while aiming = 1.61x, in line
  // with what a modern CoD shows behind the sight (its ADS lands near 48 deg).
  adsFovScale: 0.62,
  sensitivity: 0.0022,
  // Scaled to match the ADS zoom: 1 / 1.61 = 0.62, so a target under the dot
  // tracks the mouse 1:1 in screen space.
  adsSensScale: 0.62,
  invertY: false,
  /** 0..1 scale on per-shot cosmetic camera vibration. 0 is off, 1 is authored. */
  firingShake: 1,
  exposure: 1.0,
  /** Capture mode fixes the seed and disables ambient automation; live worker AI remains asynchronous. */
  deterministic: false,
};

export type QualityName = keyof typeof QUALITY_PRESETS;
export type QualityPreset = (typeof QUALITY_PRESETS)[QualityName];
export interface RuntimeConfig extends Omit<typeof DEFAULTS, 'quality'> {
  quality: QualityName;
  q: QualityPreset;
}

export function createConfig(overrides: Partial<Omit<RuntimeConfig, 'q'>> = {}): RuntimeConfig {
  const quality = overrides.quality ?? DEFAULTS.quality;
  return { ...DEFAULTS, ...overrides, quality, q: { ...QUALITY_PRESETS[quality] } };
}
