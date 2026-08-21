/**
 * Player-facing contact rules for the minimap.
 *
 * You see who you see and who just shot. Sound never draws a dot.
 *
 *   LOS    exact while the player has line of sight, then a 2 s fade
 *   Fired  3 s if the shot was within 45 m, 1.5 m jitter, fade last 0.8 s
 *   Rim    off-map pip only if last seen < 2.5 s ago
 */

export const LOS_GRACE = 2;
export const FIRE_TTL = 3;
export const FIRE_RANGE = 45;
export const FIRE_JITTER = 1.5;
export const FIRE_FADE = 0.8;
export const RIM_SEEN = 2.5;
export const HEAR_RANGE = 24;
export const HEAR_SPEED = 4;
export const HEAR_CADENCE = 0.45;

/** Stable 1.5 m offset so a fire contact does not crawl every frame. */
export function fireJitter(id, t, radius = FIRE_JITTER) {
  let h = (Math.imul(id | 0, 374761393) + Math.imul(Math.floor(t * 1000), 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const ang = ((h >>> 0) / 4294967296) * Math.PI * 2;
  return { x: Math.cos(ang) * radius, z: Math.sin(ang) * radius };
}

/**
 * @param {number} now
 * @param {{ lastSeen?: number, lastFired?: number, lastSeenX?: number, lastSeenZ?: number, fireX?: number, fireZ?: number }} a
 * @returns {{ x: number, z: number, fade: number, kind: 'los'|'fired', lastSeen: number, lastFired: number, seenAge: number } | null}
 */
export function hudContact(now, a, out) {
  const lastSeen = a.lastSeen ?? -Infinity;
  const lastFired = a.lastFired ?? -Infinity;
  const seenAge = now - lastSeen;
  const firedAge = now - lastFired;
  const los = seenAge <= LOS_GRACE;
  const fired = firedAge <= FIRE_TTL;
  if (!los && !fired) return null;

  let fade = 0;
  if (los) fade = seenAge <= 0 ? 1 : 1 - seenAge / LOS_GRACE;
  if (fired) {
    const hold = FIRE_TTL - FIRE_FADE;
    const fireFade = firedAge <= hold ? 1 : 1 - (firedAge - hold) / FIRE_FADE;
    if (fireFade > fade) fade = fireFade;
  }
  if (fade < 1e-4) return null;

  const rec = out ?? {};
  rec.x = los ? a.lastSeenX : a.fireX;
  rec.z = los ? a.lastSeenZ : a.fireZ;
  rec.fade = fade;
  rec.kind = los ? 'los' : 'fired';
  rec.lastSeen = lastSeen;
  rec.lastFired = lastFired;
  rec.seenAge = seenAge;
  return rec;
}

const _hud = {
  x: 0, z: 0, fade: 0, kind: 'los', lastSeen: 0, lastFired: 0, seenAge: 0,
};

/** Filter live enemies down to current contacts. Mutates each hit with hud*. */
export function collectHudActors(agents, now, out) {
  out.length = 0;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.alive || a.staged || a.silentDeath || a.team === 0) continue;
    const c = hudContact(now, a, _hud);
    if (!c) continue;
    a.hudX = c.x;
    a.hudZ = c.z;
    a.hudFade = c.fade;
    a.hudKind = c.kind;
    a.hudSeenAge = c.seenAge;
    out.push(a);
  }
  return out;
}
