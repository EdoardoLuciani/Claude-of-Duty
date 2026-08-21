/**
 * Squad intent — pure policy, no I/O.
 *
 * The state machine in agent.js still peeks, paths and shoots. This module
 * decides the *job*: pin the last-known, wrap off the lane, or flush a plant.
 * Kept side-effect free so the decision can be unit-tested without booting
 * the renderer.
 */

export const INTENT = Object.freeze({
  PIN: 'pin',
  WRAP: 'wrap',
  FLUSH: 'flush',
});

/** Seconds the last-known must sit still inside PLANT_RADIUS before "planted". */
export const PLANT_HOLD = 3;
/** Metres the contact can drift and still count as the same nest. */
export const PLANT_RADIUS = 8;
/** Seconds after planted before we wrap even without peek-deaths. */
export const PLANT_WRAP_AGE = 5;
/** Last-known younger than this (seconds) is fresh enough to nade. */
export const FLUSH_KNOWN = 1.5;
export const PEEK_DEATHS_NEEDED = 2;
export const CLUSTER_RADIUS = 6;
export const CLUSTER_MAX_AGE = 16;
/** Metres from a predicted nade landing that would maim/kill a teammate. */
export const FRIENDLY_BLAST_R = 6;
/** Fuse used by AI nades — teammates can sprint this long toward the landing. */
export const GRENADE_FUSE = 2.35;
export const GRENADE_CLOSE_SPEED = 4.4;
/** Hold fire this long for a buddy in the sightline before giving up the peek. */
export const FRIENDLY_HOLD = 0.7;
/** Beyond this, a gunshot with no visual is "get off the X", not a jog down the barrel. */
export const LONG_RANGE = 40;

/**
 * Cluster peek-deaths that share a rock. `deaths` is `{ x, z, t }[]` with `t`
 * in the same clock as `now`. Returns the centroid or null.
 */
export function clusterPeekDeaths(deaths, now, maxAge = CLUSTER_MAX_AGE, radius = CLUSTER_RADIUS) {
  if (!deaths || deaths.length < PEEK_DEATHS_NEEDED) return null;
  const live = [];
  for (let i = 0; i < deaths.length; i++) {
    const d = deaths[i];
    if (now - d.t <= maxAge) live.push(d);
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

/**
 * Pick the squad job from a snapshot of what they could know.
 *
 * @param {{
 *   planted: boolean,
 *   plantAge: number,
 *   lastKnownAge: number,
 *   cluster: { x:number, z:number, r:number, count:number } | null,
 *   peekDeathCount: number,
 *   hasGrenade: boolean,
 *   anyVisual: boolean,
 * }} s
 */
export function decideIntent(s) {
  const known = s.lastKnownAge < FLUSH_KNOWN;
  const canFlush = !!s.hasGrenade && known;
  if (s.cluster && s.cluster.count >= PEEK_DEATHS_NEEDED) {
    return { intent: INTENT.WRAP, why: 'peek-deaths', banned: s.cluster, wantFlush: canFlush };
  }
  // Planted + two deaths anywhere: the lane is a farm, even if they died on
  // different rocks. Ban the cluster when we have one; wrap either way.
  if (s.planted && (s.peekDeathCount ?? 0) >= PEEK_DEATHS_NEEDED) {
    return { intent: INTENT.WRAP, why: 'peek-deaths', banned: s.cluster, wantFlush: canFlush };
  }
  // Two deaths and nobody has eyes on the shooter: that bearing is a killzone.
  // They heard the shots / saw the bodies — they do not know the nest.
  if (!s.anyVisual && (s.peekDeathCount ?? 0) >= PEEK_DEATHS_NEEDED) {
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

export function angDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/**
 * Pick `n` spawn anchors: the farthest first, then the rest by angular
 * spread so the wave does not all land in one optic.
 * `ranked` is farthest-first, already filtered to d > 18.
 */
export function pickSquadAnchors(ranked, player, n) {
  if (!ranked.length || n <= 0) return [];
  const px = player.x ?? player.position?.x ?? 0;
  const pz = player.z ?? player.position?.z ?? 0;
  const bearing = (e) => {
    const p = e.s?.position ?? e.position ?? e;
    return Math.atan2(p.x - px, p.z - pz);
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
        const a = angDiff(b, bearing(picked[k]));
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
