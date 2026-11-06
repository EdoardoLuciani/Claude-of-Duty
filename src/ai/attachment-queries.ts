import type { Vector3, Vector3Like } from 'three';

import type { StaticWorld } from '../physics/bvh.ts';
import type { CharacterController } from '../physics/character.ts';
import { querySnapshot } from '../physics/query-snapshot.js';
import { AttachmentConnection, ATTACHMENT_DEADLINE_MS } from './attachment-connection.ts';
import { parseSnapshotCopy, parseQueryKey, queryIdentity } from './attachment-types.ts';
import type {
  PlanningScope,
  PlanningJob,
  QuerySample,
  QueryCosts,
  QueryKey,
  WorkerMessage,
  LadderQueryOptions,
  ClientMessage,
} from './attachment-types.ts';
import { LADDER_MOTOR_VERSION } from './ladder.ts';
import type { LadderDescriptor, LadderDirection, LadderCursor } from './ladder.ts';
import type { SurfaceNav } from './nav.ts';

export const NAV_PENDING = Symbol('navigation pending');
export const NAV_CANCELLED = Symbol('navigation superseded');
const MAX_PROOFS = 512,
  MAX_JOBS = 256;

// Only static boolean proofs cross the thread boundary. A pending attempt may
// discover more independent checks, but callers MUST NOT commit its output.
// Every retry runs current scoring, visibility, endpoints and claims again.
export class AttachmentQueries {
  scopes = new Map<string, PlanningScope>();
  jobs = new Map<number, PlanningJob>();
  proofs = new Map<string, boolean>();
  current: PlanningScope | null = null;
  private connection: AttachmentConnection | null = null;
  error: Error | null = null;
  world: StaticWorld | null = null;
  private sourceTriCount = 0;
  probe: CharacterController | null = null;
  samples: QuerySample[] = [];
  costs: QueryCosts | null = null;
  rebuilding = false;
  config: string | null = null;
  nav: SurfaceNav;
  workerFactory: () => Worker;
  profile: boolean;
  collectSamples: boolean;
  nextId = 0;
  generation = 0;
  ready = false;
  paused = false;
  disposed = false;
  frame = 0;
  stats = {
    submitted: 0,
    completed: 0,
    cancelled: 0,
    stale: 0,
    pending: 0,
    maxPending: 0,
    workerMs: 0,
    motorMoves: 0,
    proofHits: 0,
    immediateChecks: 0,
    superseded: 0,
    droppedSamples: 0,
    snapshotBytes: 0,
    repeatedStates: 0,
    savedMoves: 0,
    decisions: 0,
    maxDecisionMs: 0,
    maxDecisionFrames: 0,
  };
  constructor(
    nav: SurfaceNav,
    {
      workerFactory = (): Worker =>
        new Worker(new URL('./attachment-worker.ts', import.meta.url), { type: 'module' }),
      profile = false,
      collectSamples = profile,
    }: { workerFactory?: () => Worker; profile?: boolean; collectSamples?: boolean } = {}
  ) {
    this.nav = nav;
    this.workerFactory = workerFactory;
    this.profile = profile;
    this.collectSamples = collectSamples;
  }
  get worker(): Worker | null {
    return this.connection?.worker ?? null;
  }
  get active(): boolean {
    return this.current !== null;
  }
  get pending(): boolean {
    return this.current?.pending === true;
  }
  get valid(): boolean {
    const p = this.nav.physics,
      c = this.nav._probe;
    return (
      this.ready &&
      !p.staticWorld.dirty &&
      p.staticWorld === this.world &&
      c === this.probe &&
      c?.world === this.world &&
      this.config === this.signature()
    );
  }
  signature(): string {
    const p = this.nav.physics,
      c = this.nav._probe;
    if (!c) throw new Error('[ai worker] missing controller');
    return [
      p.staticWorld.version,
      p.staticWorld.nodeCount,
      p.staticWorld.triCount,
      p.gravity,
      p.MASK.CHARACTER,
      c.stepHeight,
      c.slopeLimit,
      c.snapDistance,
      c.maxIterations,
      c.mask,
      c.enabled,
    ].join(',');
  }
  async start(): Promise<void> {
    if (this.error) throw this.error;
    if (this.disposed) return;
    const generation = ++this.generation;
    this.closeConnection();
    this.clear();
    const world = this.nav.physics.staticWorld,
      c = this.nav._probe;
    try {
      if (!c || c.world !== world)
        throw new Error('[ai worker] controller collision world mismatch');
      this.world = world;
      this.sourceTriCount = world.triCount;
      this.probe = c;
      this.config = this.signature();
      const current = (): boolean =>
        !this.disposed &&
        !this.error &&
        generation === this.generation &&
        this.nav.physics.staticWorld === world &&
        this.nav._probe === c &&
        c.world === world &&
        this.config === this.signature();
      const data = parseSnapshotCopy(await querySnapshot(world, current));
      if (!data || !current()) return;
      this.stats.snapshotBytes = data.bytes;
      const controller = {
        radius: c.radius,
        height: c.height,
        stepHeight: c.stepHeight,
        slopeLimit: c.slopeLimit,
        snapDistance: c.snapDistance,
        maxIterations: c.maxIterations,
        mask: c.mask,
        enabled: c.enabled,
      };
      const connection = (this.connection = new AttachmentConnection(
        this.workerFactory(),
        {
          type: 'init',
          world: data.snapshot,
          controller,
          gravity: this.nav.physics.gravity,
          mask: this.nav.physics.MASK,
          profile: this.profile,
          repeatState: this.nav.repeatState !== false,
        },
        data.transfer,
        (message): void => this.receive(message),
        (error): Error => this.failure(error)
      ));
      await connection.initialized;
      if (current() && this.connection === connection) this.ready = true;
    } catch (error) {
      if (!this.disposed && generation === this.generation) throw this.failure(error);
    }
  }
  private closeConnection(): void {
    this.ready = false;
    this.connection?.close();
    this.connection = null;
  }
  private send(message: ClientMessage): void {
    if (!this.connection?.worker)
      throw this.failure(new Error('[ai worker] missing initialized worker'));
    this.connection.send(message);
  }
  update(frame: number, alive: Set<number>): void {
    this.frame = frame;
    if (this.error) throw this.error;
    const p = this.nav.physics;
    if (this.nav._probe?.world !== p.staticWorld)
      throw new Error('[ai worker] controller collision world mismatch');
    if (!this.valid) {
      if (!this.rebuilding) {
        this.rebuilding = true;
        void this.start()
          .catch((error): void => {
            this.failure(error);
          })
          .finally((): void => {
            this.rebuilding = false;
          });
      }
      return;
    }
    const now = performance.now();
    for (const [key, scope] of this.scopes) {
      if ((scope.actor >= 0 && !alive.has(scope.actor)) || frame - scope.lastFrame > 120)
        this.cancel(key);
    }
    for (const job of this.jobs.values())
      if (now - job.sent > ATTACHMENT_DEADLINE_MS)
        throw this.failure(new Error('[ai worker] query deadline exceeded'));
  }
  run<T>(
    actor: number,
    kind: string,
    fn: () => T,
    origin: Vector3 | null = null
  ): T | typeof NAV_PENDING | typeof NAV_CANCELLED {
    if (this.error) throw this.error;
    if (this.current) throw new Error('[ai worker] nested planning scope');
    if (this.paused) return NAV_PENDING;
    if (
      this.ready &&
      this.world === this.nav.physics.staticWorld &&
      this.sourceTriCount > 0 &&
      this.world.triCount === 0
    ) {
      this.invalidateCurrent();
      return NAV_CANCELLED;
    }
    if (!this.valid) return NAV_PENDING;
    const key = `${actor}:${kind}`;
    let scope = this.scopes.get(key);
    if (!scope) {
      scope = {
        actor,
        kind,
        proofs: new Map(),
        started: performance.now(),
        frame: this.frame,
        waiting: false,
        gapFrames: 0,
        attempts: 0,
        lastFrame: this.frame,
        pending: false,
        unsent: [],
        used: new Set(),
      };
      this.scopes.set(key, scope);
    }
    // Do not chase a moving origin forever. The request is superseded, not
    // physically impossible. Callers retain their action and normal retry policy.
    const previous = scope.waitOrigin;
    if (
      scope.waiting &&
      previous &&
      (!origin || previous[0] !== origin.x || previous[1] !== origin.y || previous[2] !== origin.z)
    ) {
      this.stats.superseded++;
      this.cancel(key);
      return NAV_CANCELLED;
    }
    if (!scope.waiting) {
      scope.started = performance.now();
      scope.frame = this.frame;
      scope.gapFrames = 0;
      scope.attempts = 0;
      scope.waitOrigin = null;
    } else scope.gapFrames += Math.max(0, this.frame - scope.lastFrame - 1);
    scope.attempts++;
    scope.origin = origin;
    scope.lastFrame = this.frame;
    scope.pending = false;
    scope.cancelled = false;
    scope.unsent.length = 0;
    scope.used.clear();
    this.current = scope;
    let value;
    try {
      value = fn();
    } catch (error) {
      this.cancel(key);
      throw error;
    } finally {
      this.current = null;
    }
    if (scope.cancelled) return NAV_CANCELLED;
    const obsolete = [];
    for (const [id, job] of this.jobs)
      if (job.scope === scope && !scope.used.has(id)) {
        obsolete.push(id);
        this.jobs.delete(id);
        scope.proofs.delete(job.identity);
      }
    if (obsolete.length) this.send({ type: 'cancel', ids: obsolete });
    this.stats.cancelled += obsolete.length;
    this.stats.pending = this.jobs.size;
    if (scope.unsent.length) this.send({ type: 'queries', jobs: scope.unsent });
    if (scope.pending) {
      scope.waiting = true;
      return NAV_PENDING;
    }
    if (scope.waiting) {
      const ms = performance.now() - scope.started,
        frames = this.frame - scope.frame;
      this.stats.decisions++;
      this.stats.maxDecisionMs = Math.max(this.stats.maxDecisionMs, ms);
      this.stats.maxDecisionFrames = Math.max(this.stats.maxDecisionFrames, frames);
      if (this.collectSamples)
        this.record({
          type: 'decision',
          actor,
          kind,
          frame: this.frame,
          ms,
          frames,
          attempts: scope.attempts,
          gapFrames: scope.gapFrames,
        });
    }
    scope.waiting = false;
    scope.started = performance.now();
    scope.frame = this.frame;
    return value;
  }
  request(
    from: Vector3Like,
    to: Vector3Like,
    radius: number,
    height: number,
    maxSteps: number,
    immediate: (() => boolean | null) | null = null
  ): boolean {
    const scope = this.current;
    if (!scope) throw new Error('[ai worker] query outside planning scope');
    const key = [from.x, from.y, from.z, to.x, to.y, to.z, radius, height, maxSteps];
    if (!key.every(Number.isFinite)) return false;
    return this.submit(key, from === scope.origin, immediate);
  }
  // Static full ladder proof; no immediate/main-thread motor fallback.
  checkLadder(
    descriptor: LadderDescriptor,
    direction: LadderDirection,
    foot: Vector3Like,
    cursor: Readonly<LadderCursor>,
    options: LadderQueryOptions
  ): boolean {
    if (!this.current) throw new Error('[ai worker] query outside planning scope');
    const c = this.nav._probe;
    if (!c) throw new Error('[ai worker] missing controller');
    const world = this.nav.physics.staticWorld;
    // A copied worker BVH may still be alive after the owned source dies.
    // Cancel this attempt before even looking up a completed ladder proof.
    if (!this.valid || world.nodeCount === 0 || world.triCount === 0) {
      this.invalidateCurrent();
      return false;
    }
    const {
      stepHeight = c.stepHeight,
      snapDistance = c.snapDistance,
      slopeLimit = c.slopeLimit,
      maxIterations = c.maxIterations,
      mask = c.mask,
      enabled = c.enabled,
    } = options;
    const key = parseQueryKey({
      kind: 'ladder',
      motorVersion: LADDER_MOTOR_VERSION,
      descriptor,
      direction,
      foot,
      cursor,
      radius: options.radius,
      height: options.height,
      maxMoves: options.maxMoves,
      stepHeight,
      snapDistance,
      slopeLimit,
      maxIterations,
      mask,
      enabled,
    });
    return this.submit(key, foot === this.current.origin);
  }
  private invalidateCurrent(): void {
    if (this.current) this.current.cancelled = true;
    this.generation++;
    this.closeConnection();
    this.clear();
  }
  submit(
    key: QueryKey,
    liveOrigin: boolean,
    immediate: (() => boolean | null) | null = null
  ): boolean {
    const scope = this.current;
    if (!scope) throw new Error('[ai worker] query outside planning scope');
    if (!this.valid) {
      this.invalidateCurrent();
      return false;
    }
    const identity = queryIdentity(key),
      known = this.proofs.get(identity),
      proof = scope.proofs.get(identity);
    if (known !== undefined) {
      this.stats.proofHits++;
      return known;
    }
    if (!proof && immediate) {
      this.stats.immediateChecks++;
      const value = immediate();
      if (value !== null) {
        this.remember(identity, value);
        return value;
      }
    }
    scope.pending = true;
    if (liveOrigin)
      scope.waitOrigin = Array.isArray(key)
        ? key.slice(0, 3)
        : [key.foot.x, key.foot.y, key.foot.z];
    if (proof) {
      scope.used.add(proof.id);
      return false;
    }
    if (!this.ready || this.jobs.size >= MAX_JOBS) return false;
    const id = ++this.nextId,
      job = {
        id,
        key,
        identity,
        scope,
        frame: this.frame,
        sent: performance.now(),
        generation: this.generation,
      };
    scope.proofs.set(identity, { id });
    this.jobs.set(id, job);
    scope.used.add(id);
    scope.unsent.push({ id, key, actor: scope.actor });
    this.stats.submitted++;
    this.stats.pending = this.jobs.size;
    this.stats.maxPending = Math.max(this.stats.maxPending, this.jobs.size);
    return false;
  }
  receive(message: WorkerMessage): void {
    if (this.disposed || this.error || message.type !== 'result') return;
    const job = this.jobs.get(message.id);
    this.stats.workerMs += message.ms;
    this.stats.motorMoves += message.moves;
    this.stats.repeatedStates += message.repeatedStates ?? 0;
    this.stats.savedMoves += message.savedMoves ?? 0;
    this.costs = message.costs ?? this.costs;
    if (this.collectSamples)
      this.record({
        type: 'query',
        actor: job?.scope.actor ?? null,
        kind: job?.scope.kind ?? null,
        frame: job?.frame ?? null,
        key: this.profile ? (job?.key ?? null) : undefined,
        ms: message.ms,
        roundTripMs: job ? performance.now() - job.sent : null,
        queueMs: message.queueMs ?? null,
        moves: message.moves,
      });
    if (!job || job.generation !== this.generation) {
      this.stats.stale++;
      return;
    }
    this.jobs.delete(job.id);
    job.scope.proofs.delete(job.identity);
    this.remember(job.identity, message.value);
    this.stats.completed++;
    this.stats.pending = this.jobs.size;
  }
  remember(key: string, value: boolean): void {
    if (this.proofs.size === MAX_PROOFS && !this.proofs.has(key)) {
      const first = this.proofs.keys().next().value;
      if (first !== undefined) this.proofs.delete(first);
    }
    this.proofs.set(key, value);
  }
  record(sample: QuerySample): void {
    if (this.samples.length === 2048) {
      this.samples.shift();
      this.stats.droppedSamples++;
    }
    this.samples.push(sample);
  }
  cancel(key: string): void {
    const scope = this.scopes.get(key);
    if (!scope) return;
    const ids = [];
    for (const [id, job] of this.jobs)
      if (job.scope === scope) {
        ids.push(id);
        this.jobs.delete(id);
      }
    if (ids.length && this.connection) this.send({ type: 'cancel', ids });
    this.stats.cancelled += ids.length;
    this.stats.pending = this.jobs.size;
    this.scopes.delete(key);
  }
  failure(error: unknown): Error {
    this.error ??= error instanceof Error ? error : new Error(String(error));
    this.closeConnection();
    this.clear();
    return this.error;
  }
  clear(): void {
    for (const key of this.scopes.keys()) this.cancel(key);
    this.proofs.clear();
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.closeConnection();
    this.clear();
  }
}
