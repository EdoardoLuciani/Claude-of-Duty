/**
 * Central tuning + quality configuration.
 * Subsystems read from here rather than hardcoding magic numbers, so the
 * quality scaler and the capture harness can drive everything from one place.
 *
 * `dprCap` caps the device-pixel-ratio multiplier on the internal render
 * target — the single biggest resolution lever on Retina-class displays.
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
    ssr: false,
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
    ssr: false,
    volumetrics: true,
    bloom: true,
    anisotropy: 8,
    particleBudget: 4500,
    decalBudget: 96,
  },
  high: {
    renderScale: 1.0,
    dprCap: 1.25,
    shadowMapSize: 2048,
    cascades: 4,
    shadowDistance: 130,
    taa: true,
    gtao: true,
    ssr: false,
    volumetrics: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 9000,
    decalBudget: 192,
  },
  ultra: {
    renderScale: 1.0,
    dprCap: 1.5,
    shadowMapSize: 2048,
    cascades: 4,
    shadowDistance: 160,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 16000,
    decalBudget: 320,
  },
};

export const DEFAULTS = {
  // 'ultra' was the default; it is a lot of GPU for a web shooter (4k shadows,
  // SSR, 24k particles). 'high' keeps the full effect stack but runs at sane
  // resolutions; ultra stays one click away.
  quality: 'high',
  fov: 80, // horizontal-ish vertical FOV, CoD default feel
  // ADS magnification: hip 80 deg -> 49.6 deg while aiming = 1.61x, in line
  // with what a modern CoD shows behind the sight (its ADS lands near 48 deg).
  adsFovScale: 0.62,
  sensitivity: 0.0022,
  // Scaled to match the ADS zoom: 1 / 1.61 = 0.62, so a target under the dot
  // tracks the mouse 1:1 in screen space.
  adsSensScale: 0.62,
  invertY: false,
  exposure: 1.0,
  /** Capture mode disables anything nondeterministic so screenshots are stable. */
  deterministic: false,
};

export function createConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  cfg.q = { ...QUALITY_PRESETS[cfg.quality] };
  cfg.setQuality = (name) => {
    if (!QUALITY_PRESETS[name]) throw new Error(`unknown quality preset "${name}"`);
    cfg.quality = name;
    Object.assign(cfg.q, QUALITY_PRESETS[name]);
  };
  return cfg;
}
