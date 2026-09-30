import { INTEL } from './tuning.js';

/** Inclusive roll of the run's cache budget. */
export function rollBudget(rng) {
  const span = INTEL.budgetMax - INTEL.budgetMin + 1;
  return INTEL.budgetMin + (rng.u32() % span);
}

/** True when this wave clear places a cache. */
export function rollSpawn(rng) {
  return rng.float() < INTEL.spawnChance;
}

/** Uniform unused marker, or null. A used id stays spent for the run. */
export function randomMarker(markers, used, rng) {
  let free = 0;
  for (let i = 0; i < markers.length; i++) {
    if (!used.has(markers[i].id)) free++;
  }
  if (!free) return null;
  let pick = rng.u32() % free;
  for (let i = 0; i < markers.length; i++) {
    if (used.has(markers[i].id)) continue;
    if (pick-- === 0) return markers[i];
  }
  return null;
}
