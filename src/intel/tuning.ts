/** Al-Maktaba: metres, seconds and shop credits. */
export const INTEL = Object.freeze({
  budgetMin: 3,
  budgetMax: 5,
  aliveMax: 2,
  /** Spawn spacing in the horizontal plane; halve, then waive when sites run short. */
  spawnPlayerDistance: 18,
  spawnCacheDistance: 24,
  recentSites: 5,
  beaconPeriod: 1.2,
  beaconDim: 0.3,
  beaconBright: 5,
  lidOpenTime: 0.55,
  lidCloseTime: 0.28,
  lidAngle: 1.65,
  sparkEvery: 0.16,
  sparkOpen: 0.55,
  radius: 1.7,
  targetHeight: 0.35,
  aimCos: 0.9,
  hold: 4,
  pryLoudness: 75,
  noiseEvery: 0.5,
  lureGain: 0.75,
  announceDelay: 2.4,
  lureRadius: 18,
  lureNear: 4,
  lureHzFar: 0.8,
  lureHzNear: 3,
  pulseRadius: 12,
  moveCancel: 0.35,
  driftCancel: 0.12,
  credits: 500,
});

/** A single detector speeds up as the nearest cache gets closer. */
export function lureInterval(dist: number): number {
  const t = Math.min(1, Math.max(0, (dist - INTEL.lureNear) / (INTEL.lureRadius - INTEL.lureNear)));
  return 1 / (INTEL.lureHzNear + (INTEL.lureHzFar - INTEL.lureHzNear) * t);
}
