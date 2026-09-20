/**
 * Combat accuracy, reaction and burst numbers in one place.
 *
 * Issue 276: unsuppressed, exposed, clear-LOS shooting is tuned here.
 * Cover, suppression, peripheral acquisition and world occlusion stay
 * imperfect on purpose — do not "fix" miss rates by inflating hitboxes
 * or damage, and do not grant knowledge through walls.
 *
 * BASELINE windows are the agreed outcome ranges for those exposed cases,
 * measured by tools/smoke-ai-accuracy.mjs across deterministic seeds.
 */

export const COMBAT = {
  viewRange: 80,
  viewConeDeg: 100,
  /** Inside this range the view cone is ignored. */
  closeAcquire: 4.5,

  /**
   * Seconds to acknowledge a continuously visible target:
   *   max(acquireMin, acquireBase + dist * acquirePerM + (1 - alertness) * acquireCold)
   */
  acquireMin: 0.12,
  acquireBase: 0.16,
  acquirePerM: 0.0075,
  /** Extra delay on the first visible frame while alertness is still 0. */
  acquireCold: 0.28,
  acquireDecay: 0.35,

  /** Aim point lerp rates (higher = snappier). Idle is the no-target look-ahead. */
  aimTrack: 6,
  aimIdleTrack: 3,
  /** Metres added to lastKnown.y so the bore sits on the chest, not the feet. */
  aimChest: 0.05,
  aimWobble: 0.012,
  aimWobbleSuppress: 0.05,
  aimWobbleLat: 0.12,
  aimWobbleVert: 0.08,

  fireRate: 10.5,
  fireRateIrregular: 8.2,
  magSize: 30,
  /** Per-round damage. Do not raise this to chase hit-rate targets. */
  damage: 17,
  /**
   * 1-sigma angular error, radians, before suppression.
   * 0.032 rad → ~0.32 m at 10 m, ~0.80 m at 25 m, ~1.6 m at 50 m.
   */
  spread: 0.032,
  spreadY: 0.8,
  suppressSpread: 1.5,

  burstMin: 3,
  burstMax: 7,
  burstGapMin: 0.45,
  burstGapMax: 1.35,
  burstGapSuppress: 0.5,
  /** Spawn stagger so a wave does not open fire on the same frame. */
  firstBurstMin: 0.4,
  firstBurstMax: 1.4,

  suppressDecay: 0.55,
  suppressMax: 1.6,
};

/** Seconds of continuous visibility before awareness reaches 1. */
export function acquireSeconds(dist, alertness) {
  return Math.max(
    COMBAT.acquireMin,
    COMBAT.acquireBase + dist * COMBAT.acquirePerM + (1 - alertness) * COMBAT.acquireCold,
  );
}

/** In-place bore error. `dir` must be unit-length on entry. */
export function applySpread(dir, rng, spread, yScale = COMBAT.spreadY) {
  dir.x += rng.gauss() * spread;
  dir.y += rng.gauss() * spread * yScale;
  dir.z += rng.gauss() * spread;
  const m = Math.hypot(dir.x, dir.y, dir.z);
  if (m > 1e-8) {
    dir.x /= m;
    dir.y /= m;
    dir.z /= m;
  }
  return dir;
}

/**
 * Outcome windows for unsuppressed, exposed, head-on, clear-LOS encounters.
 * Hit rates are hits/shots, not kills. Stance uses the real player capsule.
 *
 * Full-loop TTFS is measured with burstCooldown already expired (the typical
 * case after spawn-far / patrol). 50 m open combat relocates above LONG_RANGE
 * rather than standing to shoot — 50 m is dispersion + acquisition only.
 */
export const BASELINE = {
  /** Continuous stare. Alertness snaps to 1 on first sight, so a cold start is one frame slower. */
  acquire: {
    10: { alert: [0.20, 0.32], cold: [0.20, 0.34] },
    25: { alert: [0.30, 0.42], cold: [0.30, 0.44] },
    50: { alert: [0.48, 0.64], cold: [0.48, 0.66] },
  },
  ttfs: {
    10: [0.22, 0.36],
    25: [0.32, 0.48],
  },
  /** Spread-only, perfect muzzle, 0 suppression. */
  spread: {
    stand: { 10: [0.56, 0.78], 25: [0.16, 0.32], 50: [0.04, 0.14] },
    crouch: { 10: [0.48, 0.70] },
    prone: { 10: [0.34, 0.56] },
  },
  /** Aim lerp + wobble + spread, muzzle follows aimTarget. */
  aimed: {
    standStill: { 10: [0.52, 0.78], 25: [0.10, 0.30] },
    crouchStill: { 10: [0.38, 0.66] },
    proneStill: { 10: [0.28, 0.56] },
    standMove: { 10: [0.22, 0.52] },
  },
};
