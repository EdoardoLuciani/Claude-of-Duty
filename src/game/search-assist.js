/**
 * Last-enemy search assist. When a wave is down to a couple of quiet
 * survivors the player gets a coarse compass sector — not an exact marker,
 * not a free kill, and not a leak of the player's pose into AI evidence.
 *
 * Windows match player-facing HUD contact (src/ai/contact.js LOS_GRACE /
 * FIRE_TTL) so a live minimap sighting or muzzle flash resets the timer.
 * Pause/shop freeze `ctx.time.elapsed` (scale = 0); callers must tick with
 * that clock, never wall time.
 */

export const SEARCH_ASSIST = Object.freeze({
  remainingMax: 2,
  quietSeconds: 30,
  repeatSeconds: 15,
  sectorDeg: 45,
  /** Match LOS_GRACE in src/ai/contact.js. */
  seenWindow: 2,
  /** Match FIRE_TTL in src/ai/contact.js. */
  firedWindow: 3,
});

export const SEARCH_SECTORS = Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

const _hint = { remaining: 0, contact: false, dx: 0, dz: 0 };

export function createSearchState() {
  return { quietSince: -1, lastCueAt: -1 };
}

export function resetSearchState(state) {
  state.quietSince = -1;
  state.lastCueAt = -1;
  return state;
}

/** 0 = north (−Z), clockwise, snapped to 45°. */
export function sectorBearing(dx, dz) {
  if (dx * dx + dz * dz < 1e-8) return 0;
  const deg = Math.atan2(dx, -dz) * (180 / Math.PI);
  const wrapped = ((deg % 360) + 360) % 360;
  const step = SEARCH_ASSIST.sectorDeg;
  return (Math.round(wrapped / step) % (360 / step)) * step;
}

export function sectorLabel(bearing) {
  const step = SEARCH_ASSIST.sectorDeg;
  const i = Math.round((((bearing % 360) + 360) % 360) / step) % SEARCH_SECTORS.length;
  return SEARCH_SECTORS[i];
}

/**
 * Count living wave enemies and whether the player currently has contact.
 * `out` is mutated; pass a retained object from init().
 */
export function collectSearchHint(now, agents, origin, out = _hint) {
  let remaining = 0;
  let contact = false;
  let bestDx = 0;
  let bestDz = 0;
  let best = Infinity;
  const ox = origin?.x ?? 0;
  const oz = origin?.z ?? 0;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.alive || a.staged || a.silentDeath || a.team === 0) continue;
    remaining++;
    if (
      now - a.lastSeen < SEARCH_ASSIST.seenWindow
      || now - a.lastFired < SEARCH_ASSIST.firedWindow
    ) {
      contact = true;
    }
    const pos = a.position;
    const dx = (pos?.x ?? 0) - ox;
    const dz = (pos?.z ?? 0) - oz;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      bestDx = dx;
      bestDz = dz;
    }
  }
  out.remaining = remaining;
  out.contact = contact;
  out.dx = bestDx;
  out.dz = bestDz;
  return out;
}

/**
 * Advance the quiet timer. Returns a cue payload or null.
 * `now` must be gameplay elapsed time (paused clock does not move).
 */
export function tickSearchAssist(state, hint, now) {
  if (
    hint.remaining <= 0
    || hint.remaining > SEARCH_ASSIST.remainingMax
    || hint.contact
  ) {
    resetSearchState(state);
    return null;
  }
  if (state.quietSince < 0) state.quietSince = now;
  if (now - state.quietSince < SEARCH_ASSIST.quietSeconds) return null;
  if (state.lastCueAt >= 0 && now - state.lastCueAt < SEARCH_ASSIST.repeatSeconds) {
    return null;
  }
  state.lastCueAt = now;
  const bearing = sectorBearing(hint.dx, hint.dz);
  return {
    bearing,
    sector: sectorLabel(bearing),
    remaining: hint.remaining,
  };
}
