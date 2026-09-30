/** Al-Maktaba. Numbers live here so the hold, the lure and the payout stay in one place. */

export const INTEL = {
  budgetMin: 3,
  budgetMax: 5,
  aliveMax: 2,
  /** Chance a wave clear places a cache, when a slot and a site are free. */
  spawnChance: 0.6,
  /** Metres. Close enough to work the latch. */
  radius: 1.7,
  hold: 2.5,
  /** AI hearing radius of the pry. Same reach as a rifle shot. */
  pryLoudness: 90,
  /** Seconds between pry alerts while F is held. */
  noiseEvery: 0.5,
  /** Player lure. Does not alert AI. */
  lureRadius: 18,
  lureNear: 4,
  lureHzFar: 1,
  lureHzNear: 4,
  /** Minimap disc around a live cache. */
  pulseRadius: 12,
  /** Horizontal speed that counts as locomotion and wipes the hold. */
  moveCancel: 0.35,
  credits: 150,
};

/** Geiger interval: 1 Hz at the lure edge, several Hz inside `lureNear`. */
export function lureInterval(dist) {
  const span = INTEL.lureRadius - INTEL.lureNear;
  const t = span > 0 ? Math.min(1, Math.max(0, (dist - INTEL.lureNear) / span)) : 0;
  const hz = INTEL.lureHzNear + (INTEL.lureHzFar - INTEL.lureHzNear) * t;
  return 1 / hz;
}
