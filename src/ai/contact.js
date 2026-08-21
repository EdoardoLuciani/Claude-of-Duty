/**
 * Player-facing contact rules. You see who you see and who just shot.
 * Sound never draws a dot.
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

const _tmp = { x: 0, z: 0, fade: 0, kind: 'los', seenAge: 0 };

/** Stable 1.5 m offset so a fire contact does not crawl every frame. */
export function fireJitter(id, t) {
  let h = (Math.imul(id | 0, 374761393) + Math.imul(Math.floor(t * 1000), 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const ang = ((h >>> 0) / 4294967296) * Math.PI * 2;
  return { x: Math.cos(ang) * FIRE_JITTER, z: Math.sin(ang) * FIRE_JITTER };
}

/** Display pose for one agent, or null if they are not a contact. */
export function hudContact(now, a, out = _tmp) {
  const seenAge = now - (a.lastSeen ?? -Infinity);
  const firedAge = now - (a.lastFired ?? -Infinity);
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

  out.x = los ? a.lastSeenX : a.fireX;
  out.z = los ? a.lastSeenZ : a.fireZ;
  out.fade = fade;
  out.kind = los ? 'los' : 'fired';
  out.seenAge = seenAge;
  return out;
}
