import * as THREE from 'three';
import { init, importNavMesh, NavMeshQuery, Detour, Raw } from '@recast-navigation/core';
import { INFANTRY, vaultPoint } from './capabilities.ts';
import { TACTICS } from './tuning.ts';
import { unpackNav, NAV_PROFILE, type BakedCoverPoint } from './nav-format.ts';
export { unpackNav } from './nav-format.ts';
import { NAV_PENDING, NAV_CANCELLED, AttachmentQueries } from './attachment-queries.js';
export { NAV_PENDING, NAV_CANCELLED } from './attachment-queries.js';
const EXTENTS = Object.freeze({ x: 1.2, y: INFANTRY.stepHeight, z: 1.2 });
// Cross-map upper-floor routes exhaust 12k nodes; retain a finite cap and
// the shared two-solves/frame scheduler rather than accepting partial paths.
const MAX_NODES = 24000, MAX_PATH = 2048;
import { canStand, checkAttachment, WALK_STEP } from './attachment.js';
interface NavController { radius: number; height: number; position: THREE.Vector3; velocity: THREE.Vector3; grounded: boolean; setPosition(x: number, y: number, z: number): void; probeGround(): void; move(x: number, y: number, z: number): void }
interface NavPhysics {
  staticWorld: { dirty: boolean; version: number }; MASK: { CHARACTER: number; SIGHT: number }; gravity: number;
  createCharacter(options: Record<string, unknown>): NavController; removeCharacter(controller: NavController): void;
  checkCapsule(a: THREE.Vector3, b: THREE.Vector3, radius: number, mask: number): boolean; groundHeight(x: number, z: number, y: number): number;
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3, mask: number): boolean;
}
type NavCoverPoint = BakedCoverPoint
interface NavMeta { bounds?: { min: number[]; max: number[] } }
interface NavStats { polygons: number; queries: number; queryMs: number; endpointChecks: number; cacheHits: number; validateMs?: number; initMs?: number; importMs?: number; wasmBytes?: number; payloadBytes?: number }
interface NavCache { nav: SurfaceNav; version: number; position: THREE.Vector3; point: THREE.Vector3; ref: number; radius?: number; height?: number; generation?: number; proofRadius?: number; proofHeight?: number; goal?: boolean }
interface NavCoordinate { x: number; y: number; z: number }
interface CoverFailedPoint { x: number; y: number; z: number; until: number; threat: THREE.Vector3 }
interface CoverPickOptions {
  minRange?: number; maxRange?: number; id?: number; squad?: { id: number; alive: boolean; position: THREE.Vector3 }[];
  maxTravel?: number; elevated?: boolean; yRef?: number; yTol?: number; failed?: CoverFailedPoint[]; now?: number;
  avoid?: { x: number; z: number; r?: number }; eyeHeight?: number;
}
interface NavActor { navStart?: NavCache | null; navGoal?: NavCache | null }

/** One offline-baked surface authority. No grid, online bake or fallback solver. */
export class SurfaceNav {
  physics!: NavPhysics; mesh!: ReturnType<typeof importNavMesh>['navMesh']; components!: Map<number, number>; meta!: NavMeta;
  query!: NavMeshQuery; coverPoints!: NavCoverPoint[]; lastOutcome!: string | null; lastReason!: string | null;
  startSurface!: number; goalSurface!: number; resolvedFloor!: number; stats!: NavStats; _a!: THREE.Vector3; _b!: THREE.Vector3; _sample!: THREE.Vector3; _arc!: THREE.Vector3;
  _p0!: THREE.Vector3; _p1!: THREE.Vector3; _source!: THREE.Vector3; _probe!: NavController | null;
  worker: AttachmentQueries | null = null;
  plan<T>(actor: number, kind: string, fn: () => T, origin?: THREE.Vector3): T | typeof NAV_PENDING | typeof NAV_CANCELLED {
    return this.worker ? this.worker.run(actor, kind, fn, origin) : fn();
  }
  static async load(buffer: ArrayBuffer | ArrayBufferView, physics: NavPhysics, expected: Record<string, string> = {}): Promise<SurfaceNav> {
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

  constructor(physics: NavPhysics, mesh: ReturnType<typeof importNavMesh>['navMesh'], components: Map<number, number>, meta: NavMeta = {}) {
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
  inspect(p: THREE.Vector3) { return this.query.findNearestPoly(p, { halfExtents: EXTENTS }); }

  canStand(p: THREE.Vector3, radius: number = NAV_PROFILE.radius, height: number = NAV_PROFILE.height): boolean {
    return canStand.call(this, p, radius, height);
  }

  canAttach(from: THREE.Vector3, to: THREE.Vector3, radius: number = NAV_PROFILE.radius, height: number = NAV_PROFILE.height, maxSteps = 80): boolean {
    if (this.worker?.active) {
      // Both native zero-move success cases. probeGround() does not move the
      // controller: the first loop test accepts fitting feet within .12m too.
      // No motor iterations or acceptance budgets are shortened.
      const distance = Math.hypot(to.x - from.x, to.z - from.z);
      if ((distance < .001 || (maxSteps > 0 && distance < .12)) && Math.abs(to.y - from.y) <= INFANTRY.arrivalHeight
        && this.canStand(from, radius, height) && this.canStand(to, radius, height)) return true;
      // Tiny live-origin settling cannot wait for a moving pose to recur.
      // One native move may prove it now; an incomplete prefix goes to the
      // worker unchanged. Static candidates and long walks never use this.
      const immediate = from === this.worker.current?.origin && distance < .12
        ? () => checkAttachment.call(this, from, to, radius, height, maxSteps, 1) : null;
      return this.worker.request(from, to, radius, height, maxSteps, immediate);
    }
    return this._checkAttachment(from, to, radius, height, maxSteps);
  }

  _checkAttachment(from: THREE.Vector3, to: THREE.Vector3, radius: number, height: number, maxSteps: number): boolean {
    const result = checkAttachment.call(this, from, to, radius, height, maxSteps);
    if (result === null) throw new Error('[nav] complete attachment unexpectedly yielded');
    return result;
  }

  /** Contain opportunistic hops, not planned off-mesh routes. Both ends must
   * retain standing navigation, and the entire arc must execute through collision. */
  canVault(from: THREE.Vector3, to: THREE.Vector3, continuation: THREE.Vector3 | null): boolean {
    const start = this.project(from, this._a), end = this.project(to, this._b, null, true);
    if (!start || !end || this.components.get(start) !== this.components.get(end)
      || !this.canStand(from) || !this.canStand(to)
      || Math.hypot(to.x - from.x, to.z - from.z) > INFANTRY.vaultDistance + .01) return false;
    const c = this._probe;
    if (!c) return false;
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
  project(p: THREE.Vector3, out: THREE.Vector3, cache: NavCache | null = null, goal = false): number {
    if (this.physics.staticWorld.dirty || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return 0;
    if (p === out) { this._source.copy(p); p = this._source; }
    const bounds = this.meta.bounds;
    if (bounds && (p.x < bounds.min[0] - EXTENTS.x || p.x > bounds.max[0] + EXTENTS.x
      || p.z < bounds.min[2] - EXTENTS.z || p.z > bounds.max[2] + EXTENTS.z
      || p.y < bounds.min[1] - EXTENTS.y || p.y > bounds.max[1] + EXTENTS.y)) return 0;
    const version = this.physics.staticWorld.version;
    const radius = cache?.radius ?? NAV_PROFILE.radius, height = cache?.height ?? NAV_PROFILE.height;
    // Endpoint caches contain physical proofs too. Invalid service state must
    // miss even before update() starts the replacement generation.
    const generation = cache && this.worker ? (this.worker.valid ? this.worker.generation : -1) : 0;
    if (cache?.nav === this && cache.version === version && generation >= 0 && cache.generation === generation
      && cache.proofRadius === radius && cache.proofHeight === height && cache.goal === goal
      && cache.position.distanceToSquared(p) < 1e-10) {
      this.stats.cacheHits++; out.set(cache.point.x, cache.point.y, cache.point.z); return cache.ref;
    }
    let ref = 0, point: NavCoordinate | null = null;
    if (cache?.nav === this && cache.ref) {
      const n = this.query.closestPointOnPoly(cache.ref, p);
      if (n.success && n.isPointOverPoly && Math.abs(n.closestPoint.y - p.y) <= EXTENTS.y) { ref = cache.ref; point = n.closestPoint; }
    }
    if (!ref) {
      const n = this.query.findNearestPoly(p, { halfExtents: EXTENTS });
      if (n.success && n.nearestRef) { ref = n.nearestRef; point = n.nearestPoint; }
    }
    if (ref && point && this.components.has(ref) && Math.abs(point.y - p.y) <= EXTENTS.y
      && Math.hypot(point.x - p.x, point.z - p.z) <= EXTENTS.x) {
      out.set(point.x, point.y, point.z);
      if (!(goal ? this.canAttach(out, p, radius, height) : this.canAttach(p, out, radius, height))) ref = 0;
    } else ref = 0;
    if (cache && !this.worker?.pending) {
      cache.nav = this; cache.version = this.physics.staticWorld.version; cache.position.copy(p); cache.point.set(out.x, out.y, out.z); cache.ref = ref;
      cache.generation = generation; cache.proofRadius = radius; cache.proofHeight = height; cache.goal = goal;
    }
    return ref;
  }

  /** Convert a sampled/evidence height to feet, then use the same attachment rule. */
  sampleGround(x: number, z: number, y: number, out: THREE.Vector3): number {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
    const floor = this.physics.groundHeight(x, z, y + INFANTRY.stepHeight);
    if (!Number.isFinite(floor) || floor > y + INFANTRY.stepHeight || floor < y - NAV_PROFILE.height) return 0;
    this._sample.set(x, floor + .008, z);
    return this.project(this._sample, out);
  }

  findPath(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3[], actor: NavActor | null = null): number {
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
    // An unfinished endpoint proof has not spent a path solve. Preserve the
    // two completed-attempts/frame contract used by callers and diagnostics.
    if (this.worker?.pending) this.stats.queries--;
    this.stats.queryMs = performance.now() - started;
    return n;
  }

  /** Check a straight cover peek or vault continuation, not a second path solve. */
  lineOfWalk(from: THREE.Vector3, to: THREE.Vector3): boolean {
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

  dispose(): void {
    this.worker?.dispose(); this.worker = null;
    Raw.destroy(this.query.defaultFilter.raw); this.query.destroy(); this.mesh.destroy();
    this.components.clear(); this.coverPoints.length = 0; this._probe = null;
  }
}

/** Live scoring/claims are retained; every baked point owns a surface/component. */
export class CoverMap {
  grid!: SurfaceNav | null; physics!: NavPhysics; points!: NavCoverPoint[]; byComponent!: Map<number, NavCoverPoint[]>;
  _v!: THREE.Vector3; _v2!: THREE.Vector3; _v3!: THREE.Vector3; _candidates!: (NavCoverPoint | null)[]; _scores!: Float64Array; lastReject!: string | null;
  constructor(nav: SurfaceNav | null, physics: NavPhysics) {
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
  pick(pos: THREE.Vector3, threat: THREE.Vector3, opts: CoverPickOptions = {}): NavCoverPoint | null | typeof NAV_PENDING | typeof NAV_CANCELLED {
    if (!this.grid) return null;
    const result = this.grid.worker
      ? this.grid.plan(opts.id ?? -1, opts.elevated ? 'elevation' : 'cover', () => this._pick(pos, threat, opts), pos)
      : this._pick(pos, threat, opts);
    if (result === NAV_PENDING) this.lastReject = 'pending';
    if (result === NAV_CANCELLED) this.lastReject = 'superseded';
    return result;
  }
  _pick(pos: THREE.Vector3, threat: THREE.Vector3, opts: CoverPickOptions): NavCoverPoint | null {
    const wantMin = opts.minRange ?? 6, wantMax = opts.maxRange ?? 26;
    const claimId = opts.id ?? -1, squad = opts.squad ?? null, maxTravel = opts.maxTravel ?? 22;
    const yRef = opts.elevated ? null : opts.yRef ?? pos.y, yTol = opts.yTol ?? 1.6;
    if (!this.grid) return null;
    const ref = this.grid.project(pos, this._v3), component = this.grid.components.get(ref);
    if (component === undefined) return null;
    const points = this.byComponent.get(component);
    if (!ref || !points) return null;
    this._candidates.fill(null); this._scores.fill(-Infinity);
    this.lastReject = 'no-candidate';
    for (const p of points) {
      if (p.claimed >= 0 && p.claimed !== claimId) continue;
      if (opts.elevated && p.y < TACTICS.elevatedMinHeight) continue;
      let failed = false;
      if (opts.failed) for (const f of opts.failed) {
        if (opts.now !== undefined && f.until > opts.now && Math.abs(f.y - p.y) < .5
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
      this._v.set(p.x, p.y, p.z);
      const goal = this.grid.project(this._v, this._v3, null, true);
      if (!goal || this.grid.components.get(goal) !== component) { this.lastReject = 'attachment'; continue; }
      if (this.peekOffset(p, threat, opts.eyeHeight ?? 1.5, this._v3) === null) { this.lastReject = 'no-firing-peek'; continue; }
      if (this.grid.worker?.pending) return null;
      if (claimId >= 0) { this.release(claimId); p.claimed = claimId; }
      this.lastReject = null;
      return p;
    }
    return null;
  }
  // Baked normals are only a shortlist. Check actual torso/head protection from
  // the known threat's firing height, including elevated shooters.
  protects(pos: NavCoordinate, threat: THREE.Vector3, height: number = NAV_PROFILE.height): boolean {
    this._v2.copy(threat); this._v2.y += .65;
    for (let i = 0; i < 2; i++) {
      this._v.set(pos.x, pos.y + height * (i ? .9 : .6), pos.z);
      if (this.physics.lineOfSight(this._v2, this._v, this.physics.MASK.SIGHT)) return false;
    }
    return true;
  }
  release(id: number): void { for (const p of this.points) if (p.claimed === id) p.claimed = -1; }
  releaseAll(): void { for (const p of this.points) p.claimed = -1; }
  peekOffset(cover: NavCoverPoint, threat: THREE.Vector3, eyeH: number, out: THREE.Vector3, actor?: number): number | null | typeof NAV_PENDING | typeof NAV_CANCELLED {
    const grid = this.grid;
    if (actor !== undefined && grid?.worker) return grid.plan(actor, 'peek', () => this.peekOffset(cover, threat, eyeH, out));
    if (!grid) return null;
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
      if (!grid.project(this._v2, out, null, true)) continue;
      if (side) {
        this._v.set(cover.x, cover.y, cover.z);
        if (!grid.lineOfWalk(this._v, out)) continue;
      }
      return side;
    }
    out.set(cover.x, cover.y, cover.z);
    return null;
  }
}
