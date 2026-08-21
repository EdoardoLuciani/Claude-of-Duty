/**
 * Squad intent — pure policy, no I/O. Agent.js still peeks and shoots; this
 * picks the job (pin / wrap / flush) from contact and deaths only.
 */

export const INTENT = Object.freeze({
  PIN: 'pin',
  WRAP: 'wrap',
  FLUSH: 'flush',
});

export const PLANT_HOLD = 3;
export const PLANT_RADIUS = 8;
export const PLANT_WRAP_AGE = 5;
export const FLUSH_KNOWN = 1.5;
export const PEEK_DEATHS_NEEDED = 2;
export const CLUSTER_RADIUS = 6;
export const CLUSTER_MAX_AGE = 16;
export const GRENADE_FUSE = 2.35;
export const GRENADE_CLOSE_SPEED = 4.4;
export const FRIENDLY_HOLD = 0.7;
export const LONG_RANGE = 40;

export function clusterPeekDeaths(deaths, now, maxAge = CLUSTER_MAX_AGE, radius = CLUSTER_RADIUS) {
  if (!deaths || deaths.length < PEEK_DEATHS_NEEDED) return null;
  const live = [];
  for (let i = 0; i < deaths.length; i++) {
    if (now - deaths[i].t <= maxAge) live.push(deaths[i]);
  }
  if (live.length < PEEK_DEATHS_NEEDED) return null;
  let best = null;
  for (let i = 0; i < live.length; i++) {
    let n = 0, sx = 0, sz = 0;
    for (let j = 0; j < live.length; j++) {
      if (Math.hypot(live[j].x - live[i].x, live[j].z - live[i].z) <= radius) {
        n++;
        sx += live[j].x;
        sz += live[j].z;
      }
    }
    if (n >= PEEK_DEATHS_NEEDED && (!best || n > best.count)) {
      best = { x: sx / n, z: sz / n, r: radius, count: n };
    }
  }
  return best;
}

export function isBannedCover(cover, banned) {
  if (!cover || !banned) return false;
  return Math.hypot(cover.x - banned.x, cover.z - banned.z) <= (banned.r ?? CLUSTER_RADIUS);
}

export function decideIntent(s) {
  const deaths = (s.peekDeathCount ?? 0) >= PEEK_DEATHS_NEEDED;
  const known = s.lastKnownAge < FLUSH_KNOWN;
  const canFlush = !!s.hasGrenade && known;
  if ((s.cluster && s.cluster.count >= PEEK_DEATHS_NEEDED) || (s.planted && deaths)) {
    return { intent: INTENT.WRAP, why: 'peek-deaths', banned: s.cluster, wantFlush: canFlush };
  }
  if (!s.anyVisual && deaths) {
    return { intent: INTENT.WRAP, why: 'unseen-deaths', banned: s.cluster, wantFlush: false };
  }
  if (s.planted && canFlush) {
    return { intent: INTENT.FLUSH, why: 'planted', banned: null, wantFlush: true };
  }
  if (s.planted && s.plantAge >= PLANT_WRAP_AGE) {
    return { intent: INTENT.WRAP, why: 'planted', banned: null, wantFlush: canFlush };
  }
  return { intent: INTENT.PIN, why: 'default', banned: null, wantFlush: false };
}

/** Farthest spawn first, then the rest by angular spread so one optic doesn't eat the wave. */
export function pickSquadAnchors(ranked, player, n) {
  if (!ranked.length || n <= 0) return [];
  const px = player.x, pz = player.z;
  const bearing = (e) => Math.atan2(e.s.position.x - px, e.s.position.z - pz);
  const ang = (a, b) => {
    let d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  };
  const picked = [ranked[0]];
  const used = new Set([0]);
  while (picked.length < n && picked.length < ranked.length) {
    let bestI = -1, best = -1;
    for (let i = 0; i < ranked.length; i++) {
      if (used.has(i)) continue;
      const b = bearing(ranked[i]);
      let minA = Infinity;
      for (let k = 0; k < picked.length; k++) {
        const a = ang(b, bearing(picked[k]));
        if (a < minA) minA = a;
      }
      if (minA > best) {
        best = minA;
        bestI = i;
      }
    }
    if (bestI < 0) break;
    used.add(bestI);
    picked.push(ranked[bestI]);
  }
  return picked;
}
