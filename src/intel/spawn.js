import { INTEL } from './tuning.js';

/** Inclusive roll of the run's cache budget. */
export function rollBudget(rng) {
  return INTEL.budgetMin + (rng.u32() % (INTEL.budgetMax - INTEL.budgetMin + 1));
}

/** Farthest unused site from the player's feet. Authored order breaks ties. */
export function farthestMarker(markers, used, feet) {
  let best = null;
  let bestDistance = -1;
  for (const marker of markers) {
    if (used.has(marker.id)) continue;
    const dx = marker.x - feet.x;
    const dy = marker.y - feet.y;
    const dz = marker.z - feet.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance > bestDistance) {
      bestDistance = distance;
      best = marker;
    }
  }
  return best;
}
