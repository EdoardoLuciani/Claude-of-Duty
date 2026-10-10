import * as THREE from 'three';
import { init, importNavMesh, NavMeshQuery, Detour, Raw } from '@recast-navigation/core';
import { INFANTRY, vaultPoint } from './capabilities.ts';
import { TACTICS } from './tuning.ts';
import { unpackNav, NAV_PROFILE } from './nav-format.js';
export { unpackNav } from './nav-format.js';
const EXTENTS = Object.freeze({ x: 1.2, y: INFANTRY.stepHeight, z: 1.2 });
// Cross-map upper-floor routes exhaust 12k nodes; retain a finite cap and
// the shared two-solves/frame scheduler rather than accepting partial paths.
const MAX_NODES = 24000, MAX_PATH = 2048;
const WALK_STEP = 1.5 / 60;

/** One offline-baked surface authority. No grid, online bake or fallback solver. */
export class SurfaceNav {
  static async load(buffer, physics, expected) {
    const start = performance.now();
    const bake = await unpackNav(buffer, expected), validated = performance.now();
    await init();
    const ready = performance.now(), { navMesh } = importNavMesh(bake.nav);
    try {
      for (const ref of bake.components.keys()) if (!navMesh.isValidPolyRef(ref)) throw new Error('[nav] unknown baked surface');
      const nav = new SurfaceNav(physics, navMesh, bake.components, bake.meta);
      nav.coverPoints = bake.points;
      Object.assign(nav.stats, { validateMs: validated - start, initMs: ready - validated,
        importMs: performance.now() - ready, wasmBytes: Raw.Module.HEAPU8.byteLength, payloadBytes: bake.nav.byteLength });
      return nav;
    } catch (error) { navMesh.destroy(); throw error; }
  }

  constructor(physics, mesh, components, meta = {}) {
    this.physics = physics; this.mesh = mesh; this.components = components; this.meta = meta;
    this.query = new NavMeshQuery(mesh, { maxNodes: MAX_NODES });
    this.coverPoints = [];
    this.lastOutcome = null; this.lastReason = null;
    this.startSurface = 0; this.goalSurface = 0; this.resolvedFloor = NaN;
    this.stats = { polygons: components.size, queries: 0, queryMs: 0, endpointChecks: 0, cacheHits: 0 };
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._sample = new THREE.Vector3();
    this._arc = new THREE.Vector3();
    this._p0 = new THREE.Vector3(); this._p1 = new THREE.Vector3(); this._source = new THREE.Vector3();
    // Reuse one real controller for short attachment checks, never a per-request
    // character allocation or a simulation of the entire route. Not a game actor.
    this._probe = physics.createCharacter({ radius: NAV_PROFILE.radius, height: NAV_PROFILE.height,
      stepHeight: INFANTRY.stepHeight, slopeLimit: INFANTRY.slopeRadians, id: 'nav-attachment' });
    physics.removeCharacter(this._probe);
  }

  // Read-only diagnostics: nearest baked surface, not a physical attachment.
  inspect(p) { return this.query.findNearestPoly(p, { halfExtents: EXTENTS }); }

  canStand(p, radius = NAV_PROFILE.radius, height = NAV_PROFILE.height) {
    this._p0.set(p.x, p.y + .02 + radius, p.z);
    this._p1.set(p.x, p.y + .02 + height - radius, p.z);
    return this.physics.checkCapsule(this._p0, this._p1, radius - .005, this.physics.MASK.CHARACTER);
  }

  canAttach(from, to, radius = NAV_PROFILE.radius, height = NAV_PROFILE.height, maxSteps = 80) {
    const fromFits = this.canStand(from, radius, height), toFits = this.canStand(to, radius, height);
    // Let the real controller settle small contact/quantization errors. A deep
    // overlap must not become an accepted attachment via a large depenetration.
    if (fromFits && toFits && Math.hypot(to.x - from.x, to.z - from.z) < .001 && Math.abs(to.y - from.y) <= INFANTRY.arrivalHeight) return true;
    this.stats.endpointChecks++;
    const c = this._probe;
    c.radius = radius; c.height = height; c.setPosition(from.x, from.y, from.z);
    c.velocity.x = c.velocity.y = c.velocity.z = 0; c.probeGround();
    let vy = 0;
    // Match the controller gate's 60 Hz / 1.5 m/s execution. Attachments stay
    // bounded to 80 steps; lineOfWalk budgets the full continuation distance.
    for (let i = 0; i < maxSteps; i++) {
      const x = c.position.x, z = c.position.z;
      const dx = to.x - x, dz = to.z - z, d = Math.hypot(dx, dz);
      if ((i > 0 || (fromFits && toFits)) && d < .12 && Math.abs(to.y - c.position.y) <= INFANTRY.arrivalHeight) return true;
      const step = Math.min(d, WALK_STEP);
      vy += this.physics.gravity / 60;
      c.move(d > 1e-6 ? dx / d * step : 0, vy / 60, d > 1e-6 ? dz / d * step : 0);
      if (Math.hypot(c.position.x - x, c.position.z - z) > step + radius) return false;
      if (c.grounded) vy = 0;
      if (Math.abs(c.position.y - from.y) > INFANTRY.stepHeight + .1) return false;
    }
    return false;
  }

  /** Contain opportunistic hops, not planned off-mesh routes. Both ends must
   * retain standing navigation, and the entire arc must execute through collision. */
  canVault(from, to, continuation) {
    const start = this.project(from, this._a), end = this.project(to, this._b, null, true);
    if (!start || !end || this.components.get(start) !== this.components.get(end)
      || !this.canStand(from) || !this.canStand(to)
      || Math.hypot(to.x - from.x, to.z - from.z) > INFANTRY.vaultDistance + .01) return false;
    const c = this._probe;
    c.radius = NAV_PROFILE.radius; c.height = NAV_PROFILE.height;
    c.setPosition(from.x, from.y, from.z); c.probeGround();
    const steps = Math.ceil(INFANTRY.vaultDuration * 60);
    for (let i = 1; i <= steps; i++) {
      vaultPoint(from, to, i / steps, this._arc);
      c.move(this._arc.x - c.position.x, this._arc.y - c.position.y, this._arc.z - c.position.z);
      if (this._arc.distanceToSquared(c.position) > .05 ** 2) return false;
    }
    return !!continuation && this.lineOfWalk(to, continuation);
  }

  /** Attach actual feet to a nearby surface, including the physical short link.
   * Cache ownership, pose and collision revision are all checked. A moved actor
   * tries its last polygon first; unchanged goals (including failures) skip probes. */
  project(p, out, cache = null, goal = false) {
    if (this.physics.staticWorld.dirty || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return 0;
    if (p === out) { this._source.copy(p); p = this._source; }
    const bounds = this.meta.bounds;
    if (bounds && (p.x < bounds.min[0] - EXTENTS.x || p.x > bounds.max[0] + EXTENTS.x
      || p.z < bounds.min[2] - EXTENTS.z || p.z > bounds.max[2] + EXTENTS.z
      || p.y < bounds.min[1] - EXTENTS.y || p.y > bounds.max[1] + EXTENTS.y)) return 0;
    const version = this.physics.staticWorld.version;
    if (cache?.nav === this && cache.version === version && cache.position.distanceToSquared(p) < 1e-10) {
      this.stats.cacheHits++; out.copy(cache.point); return cache.ref;
    }
    const radius = cache?.radius ?? NAV_PROFILE.radius, height = cache?.height ?? NAV_PROFILE.height;
    let ref = 0, point = null;
    if (cache?.nav === this && cache.ref) {
      const n = this.query.closestPointOnPoly(cache.ref, p);
      if (n.success && n.isPointOverPoly && Math.abs(n.closestPoint.y - p.y) <= EXTENTS.y) { ref = cache.ref; point = n.closestPoint; }
    }
    if (!ref) {
      const n = this.query.findNearestPoly(p, { halfExtents: EXTENTS });
      if (n.success && n.nearestRef) { ref = n.nearestRef; point = n.nearestPoint; }
    }
    if (ref && this.components.has(ref) && Math.abs(point.y - p.y) <= EXTENTS.y
      && Math.hypot(point.x - p.x, point.z - p.z) <= EXTENTS.x) {
      out.copy(point);
      if (!(goal ? this.canAttach(out, p, radius, height) : this.canAttach(p, out, radius, height))) ref = 0;
    } else ref = 0;
    if (cache) {
      cache.nav = this; cache.version = this.physics.staticWorld.version; cache.position.copy(p); cache.point.copy(out); cache.ref = ref;
    }
    return ref;
  }

  /** Convert a sampled/evidence height to feet, then use the same attachment rule. */
  sampleGround(x, z, y, out) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
    const floor = this.physics.groundHeight(x, z, y + INFANTRY.stepHeight);
    if (!Number.isFinite(floor) || floor > y + INFANTRY.stepHeight || floor < y - NAV_PROFILE.height) return 0;
    this._sample.set(x, floor + .008, z);
    return this.project(this._sample, out);
  }

  findPath(from, to, out, actor = null) {
    const started = performance.now();
    this.stats.queries++;
    this.lastOutcome = 'invalid'; this.lastReason = 'start-attachment'; this.resolvedFloor = NaN;
    if (this.physics.staticWorld.dirty) {
      this.startSurface = this.goalSurface = 0; this.lastReason = 'collision-pending';
      this.stats.queryMs = performance.now() - started; return 0;
    }
    this.startSurface = this.project(from, this._a, actor?.navStart);
    this.goalSurface = this.project(to, this._b, actor?.navGoal, true);
    let n = 0;
    if (this.startSurface && this.goalSurface) {
      this.resolvedFloor = this._b.y;
      this.lastOutcome = 'unreachable'; this.lastReason = 'disconnected';
      if (this.components.get(this.startSurface) === this.components.get(this.goalSurface)) {
        const path = this.query.findPath(this.startSurface, this.goalSurface, this._a, this._b, { maxPathPolys: MAX_PATH });
        try {
          if (path.status & Detour.DT_OUT_OF_NODES) this.lastReason = 'search-limit';
          else if (path.status & Detour.DT_BUFFER_TOO_SMALL) this.lastReason = 'path-limit';
          else if (!path.success || (path.status & Detour.DT_PARTIAL_RESULT) || !path.polys.size
            || path.polys.get(path.polys.size - 1) !== this.goalSurface) this.lastReason = 'partial-path';
          else {
            const straight = this.query.findStraightPath(this._a, this._b, path.polys, { maxStraightPathPoints: MAX_PATH });
            try {
              if (straight.status & Detour.DT_OUT_OF_NODES) this.lastReason = 'search-limit';
              else if (straight.status & Detour.DT_BUFFER_TOO_SMALL) this.lastReason = 'path-limit';
              else if (!straight.success || (straight.status & Detour.DT_PARTIAL_RESULT) || !straight.straightPathCount
                || !(straight.straightPathFlags.get(straight.straightPathCount - 1) & Detour.DT_STRAIGHTPATH_END)) this.lastReason = 'partial-path';
              else {
                for (let i = 0; i < straight.straightPathCount; i++) {
                  (out[n] ??= new THREE.Vector3()).set(straight.straightPath.get(i * 3), straight.straightPath.get(i * 3 + 1), straight.straightPath.get(i * 3 + 2)); n++;
                }
                // The physical link to the actual requested feet was checked.
                (out[n] ??= new THREE.Vector3()).copy(to); n++;
                this.lastOutcome = 'success'; this.lastReason = 'complete';
              }
            } finally {
              straight.straightPath.destroy(); straight.straightPathFlags.destroy(); straight.straightPathRefs.destroy();
            }
          }
        } finally { path.polys.destroy(); }
      }
    } else if (this.startSurface) this.lastReason = 'goal-attachment';
    this.stats.queryMs = performance.now() - started;
    return n;
  }

  /** Check a straight cover peek or vault continuation, not a second path solve. */
  lineOfWalk(from, to) {
    const a = this.project(from, this._a), b = this.project(to, this._b, null, true);
    if (!a || !b || this.components.get(a) !== this.components.get(b)) return false;
    const hit = this.query.raycast(a, this._a, this._b);
    const steps = Math.max(80, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / WALK_STEP) + 1);
    // The pinned wrapper omits the visited-polygons buffer (maxPath=0).
    // Detour still traces the full ray; only that unused output is truncated.
    return hit.success && !(hit.status & (Detour.DT_PARTIAL_RESULT | Detour.DT_OUT_OF_NODES))
      && (!(hit.status & Detour.DT_BUFFER_TOO_SMALL) || hit.maxPath === 0)
      && hit.t >= 1 && this.canAttach(from, to, NAV_PROFILE.radius, NAV_PROFILE.height, steps);
  }

  dispose() {
    Raw.destroy(this.query.defaultFilter.raw); this.query.destroy(); this.mesh.destroy();
    this.components.clear(); this.coverPoints.length = 0; this._probe = null;
  }
}

/** Live scoring/claims are retained; every baked point owns a surface/component. */
export class CoverMap {
  constructor(nav, physics) {
    this.grid = nav; this.physics = physics; this.points = nav?.coverPoints ?? [];
    this.byComponent = new Map();
    for (const p of this.points) {
      let list = this.byComponent.get(p.component);
      if (!list) this.byComponent.set(p.component, list = []);
      list.push(p);
    }
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._candidates = new Array(TACTICS.coverCandidates).fill(null);
    this._scores = new Float64Array(TACTICS.coverCandidates);
    this.lastReject = null;
  }
  pick(pos, threat, opts = {}) {
    const wantMin = opts.minRange ?? 6, wantMax = opts.maxRange ?? 26;
    const claimId = opts.id ?? -1, squad = opts.squad ?? null, maxTravel = opts.maxTravel ?? 22;
    const yRef = opts.elevated ? null : opts.yRef ?? pos.y, yTol = opts.yTol ?? 1.6;
    const ref = this.grid.project(pos, this._v3), component = this.grid.components.get(ref);
    const points = this.byComponent.get(component);
    if (!ref || !points) return null;
    this._candidates.fill(null); this._scores.fill(-Infinity);
    this.lastReject = 'no-candidate';
    for (const p of points) {
      if (p.claimed >= 0 && p.claimed !== claimId) continue;
      if (opts.elevated && p.y < TACTICS.elevatedMinHeight) continue;
      let failed = false;
      if (opts.failed) for (const f of opts.failed) {
        if (f.until > opts.now && Math.abs(f.y - p.y) < .5
          && Math.hypot(f.x - p.x, f.z - p.z) < TACTICS.failedCoverRadius
          && f.threat.distanceToSquared(threat) < TACTICS.failedThreatMove ** 2) { failed = true; break; }
      }
      if (failed) continue;
      const toThreatX = threat.x - p.x, toThreatZ = threat.z - p.z, dT = Math.hypot(toThreatX, toThreatZ);
      if (dT < 2.5 || dT > 40) continue;
      const travel = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (travel > maxTravel || (yRef !== null && Math.abs(p.y - yRef) > yTol)) continue;
      const prot = toThreatX / dT * p.dx + toThreatZ / dT * p.dz;
      if (prot < .25) continue;
      // Standing exposure costs less time than rounding a high wall. Both
      // still have to pass protection and the same executable-peek checks.
      let score = prot * 5 + (p.high ? 1 : 2.2);
      if (dT < wantMin) score -= (wantMin - dT) * .55;
      else if (dT > wantMax) score -= (dT - wantMax) * .28;
      score -= travel * .16;
      if (opts.avoid) {
        const ad = Math.hypot(p.x - opts.avoid.x, p.z - opts.avoid.z), ar = opts.avoid.r ?? 4;
        if (ad < ar) score -= (ar - ad) * 2.4 + 6;
      }
      if (squad) for (const other of squad) {
        if (!other || other.id === claimId || !other.alive || Math.abs(other.position.y - p.y) > 1.6) continue;
        const distance = Math.hypot(other.position.x - p.x, other.position.z - p.z);
        if (distance < 3.2) score -= (3.2 - distance) * 1.4;
      }
      // Keep a spatially diverse, fixed-size shortlist. Expensive physical
      // exposure checks must not run for thousands of points in one decision.
      let slot = 0;
      for (let i = 0; i < this._candidates.length; i++) {
        const c = this._candidates[i];
        if (c && Math.abs(c.y - p.y) < .5 && Math.hypot(c.x - p.x, c.z - p.z) < TACTICS.coverSpacing) {
          slot = i; break;
        }
        if (this._scores[i] < this._scores[slot]) slot = i;
      }
      if (score > this._scores[slot]) { this._candidates[slot] = p; this._scores[slot] = score; }
    }
    for (let tries = 0; tries < this._candidates.length; tries++) {
      let slot = 0;
      for (let i = 1; i < this._candidates.length; i++) if (this._scores[i] > this._scores[slot]) slot = i;
      const p = this._candidates[slot];
      if (!p || this._scores[slot] === -Infinity) break;
      this._scores[slot] = -Infinity;
      if (!this.protects(p, threat, p.high ? NAV_PROFILE.height : INFANTRY.crouchHeight * INFANTRY.maxScale)) {
        this.lastReject = 'exposed'; continue;
      }
      const goal = this.grid.project(p, this._v3, null, true);
      if (!goal || this.grid.components.get(goal) !== component) { this.lastReject = 'attachment'; continue; }
      if (this.peekOffset(p, threat, opts.eyeHeight ?? 1.5, this._v3) === null) { this.lastReject = 'no-firing-peek'; continue; }
      if (claimId >= 0) { this.release(claimId); p.claimed = claimId; }
      this.lastReject = null;
      return p;
    }
    return null;
  }
  // Baked normals are only a shortlist. Check actual torso/head protection from
  // the known threat's firing height, including elevated shooters.
  protects(pos, threat, height = NAV_PROFILE.height) {
    this._v2.copy(threat); this._v2.y += .65;
    for (let i = 0; i < 2; i++) {
      this._v.set(pos.x, pos.y + height * (i ? .9 : .6), pos.z);
      if (this.physics.lineOfSight(this._v2, this._v, this.physics.MASK.SIGHT)) return false;
    }
    return true;
  }
  release(id) { for (const p of this.points) if (p.claimed === id) p.claimed = -1; }
  releaseAll() { for (const p of this.points) p.claimed = -1; }
  peekOffset(cover, threat, eyeH, out) {
    // Low cover may expose by standing; high cover must be physically rounded.
    // Zero is a valid standing peek, null means there is no executable shot.
    for (let i = cover.high === false ? 0 : 1; i <= 4; i++) {
      const side = i === 0 ? 0 : i % 2 ? 1 : -1;
      const distance = i <= 2 ? .95 : 1.9;
      this._v2.set(cover.x - cover.dz * distance * side, cover.y, cover.z + cover.dx * distance * side);
      // Test the approach edge of the arrival tolerance and a shouldered rifle,
      // not just a perfect eye ray at the mathematical destination. Do cheap
      // rays before costly physical attachments (most wall samples are blind).
      this._v.set(this._v2.x + cover.dz * TACTICS.peekMargin * side,
        this._v2.y + (eyeH ?? 1.5), this._v2.z - cover.dx * TACTICS.peekMargin * side);
      if (!this.physics.lineOfSight(this._v, threat, this.physics.MASK.SIGHT)) continue;
      const dx = threat.x - this._v.x, dz = threat.z - this._v.z, length = Math.hypot(dx, dz) || 1;
      this._v.x += (dx * TACTICS.muzzleForward - dz * TACTICS.muzzleSide) / length;
      this._v.z += (dz * TACTICS.muzzleForward + dx * TACTICS.muzzleSide) / length;
      this._v.y -= TACTICS.muzzleDrop;
      if (!this.physics.lineOfSight(this._v, threat, this.physics.MASK.SIGHT)) continue;
      if (!this.grid.project(this._v2, out, null, true)) continue;
      if (side && !this.grid.lineOfWalk(cover, out)) continue;
      return side;
    }
    out.set(cover.x, cover.y, cover.z);
    return null;
  }
}
