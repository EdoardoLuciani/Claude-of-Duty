import { INTEL } from './tuning.js';

/** Inclusive roll of the run's cache budget. */
export function rollBudget(rng) {
  return INTEL.budgetMin + (rng.u32() % (INTEL.budgetMax - INTEL.budgetMin + 1));
}

/** Seeded uniform pick among unused, separated sites. No candidate-array allocation.
 * Horizontal distance keeps a cache directly upstairs from counting as exploration.
 * Prefer sites absent from recent runs within each spacing tier. Try full spacing,
 * then half, then any unused site: history/spacing never cancel a drop.
 */
export function randomMarker(markers, used, feet, alive, rng, recent = null) {
  for (let scale = 1; scale >= 0; scale -= 0.5) {
    const playerDistance2 = (INTEL.spawnPlayerDistance * scale) ** 2;
    const cacheDistance2 = (INTEL.spawnCacheDistance * scale) ** 2;
    for (let allowRecent = 0; allowRecent <= 1; allowRecent++) {
      let pick = null;
      let count = 0;
      for (const marker of markers) {
        if (used.has(marker.id) || (!allowRecent && recent?.includes(marker.id)) ||
            horizontalDistance2(marker, feet) < playerDistance2) continue;
        let separated = true;
        for (const cache of alive) {
          if (horizontalDistance2(marker, cache) < cacheDistance2) {
            separated = false;
            break;
          }
        }
        if (!separated) continue;
        // Reservoir sampling gives every qualifying site equal probability.
        if (rng.float() < 1 / ++count) pick = marker;
      }
      if (pick) return pick;
    }
  }
  return null;
}

function horizontalDistance2(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
