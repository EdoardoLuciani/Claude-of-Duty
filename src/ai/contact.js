/**
 * Player-facing contact rules. You see who you see (nearby, in a fight)
 * and who just shot. Sound never draws a dot. Off-map never draws a rim.
 */
export const LOS_GRACE = 2;
export const LOS_RANGE = 30;
export const FIRE_TTL = 3;
export const FIRE_RANGE = 45;
export const FIRE_JITTER = 1.5;
export const FIRE_FADE = 0.8;
export const HEAR_RANGE = 24;
export const HEAR_SPEED = 4;
export const HEAR_CADENCE = 0.45;

/** Combat-like states may paint. Idle / patrol / alert never do. */
export function losEligible(a) {
  const s = a.state;
  return s === 'combat' || s === 'suppressed' || s === 'flank' || s === 'retreat';
}

const _tmp = { x: 0, z: 0, fade: 0 };

/** Stable 1.5 m offset for one agent's fire contacts. */
export function fireJitter(id, out) {
  let h = Math.imul(id | 0, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const ang = ((h >>> 0) / 4294967296) * Math.PI * 2;
  out.x = Math.cos(ang) * FIRE_JITTER;
  out.z = Math.sin(ang) * FIRE_JITTER;
  return out;
}

/** Display pose for one agent, or null if they are not a contact. */
export function hudContact(now, a, out = _tmp) {
  const seenAge = now - a.lastSeen;
  const firedAge = now - a.lastFired;
  const seen = seenAge < LOS_GRACE;
  const fired = firedAge < FIRE_TTL;
  if (!seen && !fired) return null;

  // The newest signal owns the position. Equal timestamps mean the agent fired
  // while visible, so the exact sighting wins over the jitter.
  const useFire = fired && (!seen || firedAge < seenAge);
  const seenFade = seen ? 1 - seenAge / LOS_GRACE : 0;
  let fireFade = 0;
  if (fired) {
    const hold = FIRE_TTL - FIRE_FADE;
    fireFade = firedAge <= hold ? 1 : 1 - (firedAge - hold) / FIRE_FADE;
  }
  out.x = useFire ? a.fireX : a.lastSeenX;
  out.z = useFire ? a.fireZ : a.lastSeenZ;
  out.fade = Math.max(seenFade, fireFade);
  return out;
}
