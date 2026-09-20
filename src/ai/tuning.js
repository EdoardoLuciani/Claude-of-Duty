/**
 * Combat accuracy, reaction and burst numbers.
 *
 * Unsuppressed, exposed, clear-LOS shooting is tuned here. Do not chase
 * miss rates by inflating hitboxes or damage, and do not grant knowledge
 * through walls. BASELINE windows are locked by tools/smoke-ai-accuracy.mjs.
 */

export const COMBAT = {
  viewRange: 80,
  viewConeDeg: 100,
  closeAcquire: 4.5,

  acquireMin: 0.12,
  acquireBase: 0.16,
  acquirePerM: 0.0075,
  acquireCold: 0.28,
  acquireDecay: 0.35,

  aimTrack: 6,
  aimIdleTrack: 3,
  aimChest: 0.05,
  aimWobble: 0.012,
  aimWobbleSuppress: 0.05,
  aimWobbleLat: 0.12,
  aimWobbleVert: 0.08,

  fireRate: 10.5,
  fireRateIrregular: 8.2,
  magSize: 30,
  damage: 17,
  /** 1-sigma radians: ~0.32 m at 10 m, ~0.80 m at 25 m, ~1.6 m at 50 m. */
  spread: 0.032,
  spreadY: 0.8,
  suppressSpread: 1.5,

  burstMin: 3,
  burstMax: 7,
  burstGapMin: 0.45,
  burstGapMax: 1.35,
  burstGapSuppress: 0.5,
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

/** In-place bore error. `dir` is unit-length on entry. */
export function applySpread(dir, rng, spread, yScale = COMBAT.spreadY) {
  dir.x += rng.gauss() * spread;
  dir.y += rng.gauss() * spread * yScale;
  dir.z += rng.gauss() * spread;
  const m = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= m;
  dir.y /= m;
  dir.z /= m;
}

/**
 * Unsuppressed, exposed, head-on, clear-LOS windows (hits/shots).
 * 50 m open combat relocates above LONG_RANGE — dispersion + acquire only.
 */
export const BASELINE = {
  acquire: { 10: [0.20, 0.32], 25: [0.30, 0.42], 50: [0.48, 0.64] },
  ttfs: { 10: [0.22, 0.36], 25: [0.32, 0.48] },
  spread: {
    stand: { 10: [0.56, 0.78], 25: [0.16, 0.32], 50: [0.04, 0.14] },
    crouch: { 10: [0.48, 0.70] },
    prone: { 10: [0.34, 0.56] },
  },
  aimed: {
    standStill: { 10: [0.52, 0.78], 25: [0.10, 0.30] },
    crouchStill: { 10: [0.38, 0.66] },
    proneStill: { 10: [0.28, 0.56] },
    standMove: { 10: [0.22, 0.52] },
  },
};
