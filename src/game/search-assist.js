/**
 * Last-enemy search assist: a 45° compass sector after a quiet stretch.
 * Contact windows match src/ai/contact.js (LOS_GRACE / FIRE_TTL). Tick with
 * gameplay elapsed time so pause/shop (scale = 0) cannot advance the timer.
 */

export const SEARCH_ASSIST = Object.freeze({
  remainingMax: 2,
  quietSeconds: 30,
  repeatSeconds: 15,
  seenWindow: 2,
  firedWindow: 3,
});

const SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function resetSearchState(state) {
  state.quietSince = -1;
  state.lastCueAt = -1;
}

/** 0 = north (−Z), clockwise, snapped to 45°. */
export function sectorBearing(dx, dz) {
  if (dx * dx + dz * dz < 1e-8) return 0;
  const wrapped = ((Math.atan2(dx, -dz) * (180 / Math.PI)) % 360 + 360) % 360;
  return (Math.round(wrapped / 45) % 8) * 45;
}

export function sectorLabel(bearing) {
  return SECTORS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

/** Scan wave enemies and maybe emit a cue. `now` is ctx.time.elapsed. */
export function tickSearchAssist(state, now, agents, origin) {
  let remaining = 0;
  let contact = false;
  let bestDx = 0;
  let bestDz = 0;
  let best = Infinity;
  const ox = origin.x;
  const oz = origin.z;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.alive || a.staged || a.silentDeath || a.team === 0) continue;
    remaining++;
    if (now - a.lastSeen < SEARCH_ASSIST.seenWindow || now - a.lastFired < SEARCH_ASSIST.firedWindow) {
      contact = true;
    }
    const dx = a.position.x - ox;
    const dz = a.position.z - oz;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      bestDx = dx;
      bestDz = dz;
    }
  }
  if (remaining <= 0 || remaining > SEARCH_ASSIST.remainingMax || contact) {
    resetSearchState(state);
    return null;
  }
  if (state.quietSince < 0) state.quietSince = now;
  if (now - state.quietSince < SEARCH_ASSIST.quietSeconds) return null;
  if (state.lastCueAt >= 0 && now - state.lastCueAt < SEARCH_ASSIST.repeatSeconds) return null;
  state.lastCueAt = now;
  const bearing = sectorBearing(bestDx, bestDz);
  return { bearing, sector: sectorLabel(bearing), remaining };
}
