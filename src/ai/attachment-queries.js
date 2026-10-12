import { parseWorkerMessage, parseSnapshotCopy } from './attachment-types.ts';
import { querySnapshot } from '../physics/query-snapshot.js';

export const NAV_PENDING = Symbol('navigation pending');
export const NAV_CANCELLED = Symbol('navigation superseded');
const MAX_PROOFS = 512, MAX_JOBS = 256, DEADLINE = 10000;

// Only static boolean proofs cross the thread boundary. A pending attempt may
// discover more independent checks, but callers MUST NOT commit its output.
// Every retry runs current scoring, visibility, endpoints and claims again.
export class AttachmentQueries {
  /** @type {Map<string, import('./attachment-types.ts').PlanningScope>} */ scopes;
  /** @type {Map<number, import('./attachment-types.ts').PlanningJob>} */ jobs;
  /** @type {Map<string, boolean>} */ proofs;
  /** @type {import('./attachment-types.ts').PlanningScope | null} */ current;
  /** @type {Worker | null} */ worker;
  /** @type {Error | null} */ error;
  /** @type {(() => void) | null} */ abortInit = null;
  /** @type {import('../physics/bvh.ts').StaticWorld | null} */ world = null;
  /** @type {import('../physics/character.ts').CharacterController | null} */ probe = null;
  /** @type {import('./attachment-types.ts').QuerySample[]} */ samples;
  /** @type {import('./attachment-types.ts').QueryCosts | null} */ costs;
  rebuilding = false;
  /** @type {string | null} */ config = null;
  /** @param {import('./nav.ts').SurfaceNav} nav
   * @param {{workerFactory?: () => Worker, profile?: boolean}} [options] */
  constructor(nav, { workerFactory = () => new Worker(new URL('./attachment-worker.js', import.meta.url), { type: 'module' }), profile = false } = {}) {
    this.nav = nav; this.workerFactory = workerFactory; this.profile = profile;
    this.scopes = new Map(); this.jobs = new Map(); this.proofs = new Map(); this.nextId = 0; this.current = null;
    this.generation = 0; this.worker = null; this.ready = false; this.paused = false; this.disposed = false; this.error = null;
    this.stats = { submitted: 0, completed: 0, cancelled: 0, stale: 0, pending: 0, maxPending: 0,
      workerMs: 0, motorMoves: 0, proofHits: 0, immediateChecks: 0, superseded: 0, droppedSamples: 0, snapshotBytes: 0, repeatedStates: 0, savedMoves: 0, decisions: 0, maxDecisionMs: 0, maxDecisionFrames: 0 };
    this.samples = []; this.costs = null; this.frame = 0;
  }
  get active() { return this.current !== null; }
  get pending() { return this.current?.pending === true; }
  get valid() {
    const p = this.nav.physics, c = this.nav._probe;
    return this.ready && !p.staticWorld.dirty && p.staticWorld === this.world
      && c === this.probe && c?.world === this.world && this.config === this.signature();
  }
  signature() {
    const p = this.nav.physics, c = this.nav._probe;
    if (!c) throw new Error('[ai worker] missing controller');
    return [p.staticWorld.version, p.gravity, p.MASK.CHARACTER,
      c.stepHeight, c.slopeLimit, c.snapDistance, c.maxIterations, c.mask, c.enabled].join(',');
  }
  async start() {
    this.abortInit?.(); this.abortInit = null;
    const generation = ++this.generation;
    this.ready = false; this.worker?.terminate(); this.worker = null;
    this.clear();
    const world = this.nav.physics.staticWorld, c = this.nav._probe;
    if (!c || c.world !== world) throw new Error('[ai worker] controller collision world mismatch');
    this.world = world; this.probe = c; this.config = this.signature();
    const current = () => !this.disposed && generation === this.generation;
    const data = parseSnapshotCopy(await querySnapshot(world, current));
    if (!data || !current() || this.config !== this.signature()) return;
    this.stats.snapshotBytes = data.bytes;
    const worker = this.worker = this.workerFactory();
    /** @type {Promise<void>} */
    const initialized = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('[ai worker] initialization deadline exceeded')), DEADLINE);
      this.abortInit = () => { clearTimeout(timer); resolve(); };
      const fail = (/** @type {unknown} */ error) => { if (!current()) return; clearTimeout(timer); this.abortInit = null; reject(this.failure(error)); };
      worker.onerror = event => fail(new Error(`[ai worker] ${event.message}`));
      worker.onmessageerror = () => fail(new Error('[ai worker] invalid message'));
      worker.onmessage = (/** @type {MessageEvent<unknown>} */ { data }) => {
        if (!current()) return;
        let message;
        try { message = parseWorkerMessage(data); }
        catch (error) { fail(error); return; }
        if (message.type === 'error') { fail(new Error(message.message)); return; }
        if (message.type === 'ready') { clearTimeout(timer); this.abortInit = null; this.ready = true; resolve(); }
        else this.receive(message);
      };
      const controller = { radius: c.radius, height: c.height, stepHeight: c.stepHeight, slopeLimit: c.slopeLimit,
        snapDistance: c.snapDistance, maxIterations: c.maxIterations, mask: c.mask, enabled: c.enabled };
      worker.postMessage({ type: 'init', world: data.snapshot, controller,
        gravity: this.nav.physics.gravity, mask: this.nav.physics.MASK, profile: this.profile, repeatState: this.nav.repeatState !== false }, data.transfer);
    });
    await initialized;
  }
  /** @param {number} frame @param {Set<number>} alive */
  update(frame, alive) {
    this.frame = frame;
    if (this.error) throw this.error;
    const p = this.nav.physics;
    if (this.nav._probe?.world !== p.staticWorld) throw new Error('[ai worker] controller collision world mismatch');
    if (!this.valid) {
      if (!this.rebuilding) {
        this.rebuilding = true;
        void this.start().catch(error => { this.failure(error); }).finally(() => { this.rebuilding = false; });
      }
      return;
    }
    const now = performance.now();
    for (const [key, scope] of this.scopes) {
      if ((scope.actor >= 0 && !alive.has(scope.actor)) || frame - scope.lastFrame > 120) this.cancel(key);
    }
    for (const job of this.jobs.values()) if (now - job.sent > DEADLINE) throw this.failure(new Error('[ai worker] query deadline exceeded'));
  }
  /** @template T
   * @param {number} actor @param {string} kind @param {() => T} fn
   * @param {import('three').Vector3 | null} [origin]
   * @returns {T | typeof NAV_PENDING | typeof NAV_CANCELLED} */
  run(actor, kind, fn, origin = null) {
    if (this.error) throw this.error;
    if (this.current) throw new Error('[ai worker] nested planning scope');
    if (this.paused || !this.valid) return NAV_PENDING;
    const key = `${actor}:${kind}`;
    let scope = this.scopes.get(key);
    if (!scope) { scope = { actor, kind, proofs: new Map(), started: performance.now(), frame: this.frame, waiting: false,
      gapFrames: 0, attempts: 0, lastFrame: this.frame, pending: false, unsent: [], used: new Set() }; this.scopes.set(key, scope); }
    // Do not chase a moving origin forever. The request is superseded, not
    // physically impossible. Callers retain their action and normal retry policy.
    const previous = scope.waitOrigin;
    if (scope.waiting && previous && (!origin || previous[0] !== origin.x || previous[1] !== origin.y || previous[2] !== origin.z)) {
      this.stats.superseded++; this.cancel(key); return NAV_CANCELLED;
    }
    if (!scope.waiting) { scope.started = performance.now(); scope.frame = this.frame; scope.gapFrames = 0; scope.attempts = 0; scope.waitOrigin = null; }
    else scope.gapFrames += Math.max(0, this.frame - scope.lastFrame - 1);
    scope.attempts++; scope.origin = origin;
    scope.lastFrame = this.frame; scope.pending = false; scope.unsent = []; scope.used = new Set(); this.current = scope;
    let value;
    try { value = fn(); }
    catch (error) { this.cancel(key); throw error; }
    finally { this.current = null; }
    const obsolete = [];
    for (const [id, job] of this.jobs) if (job.scope === scope && !scope.used.has(id)) {
      obsolete.push(id); this.jobs.delete(id); scope.proofs.delete(job.identity);
    }
    if (!this.worker) throw this.failure(new Error('[ai worker] missing initialized worker'));
    if (obsolete.length) this.worker.postMessage({ type: 'cancel', ids: obsolete });
    this.stats.cancelled += obsolete.length; this.stats.pending = this.jobs.size;
    if (scope.unsent.length) this.worker.postMessage({ type: 'queries', jobs: scope.unsent });
    if (scope.pending) { scope.waiting = true; return NAV_PENDING; }
    if (scope.waiting) {
      const ms = performance.now() - scope.started, frames = this.frame - scope.frame;
      this.stats.decisions++; this.stats.maxDecisionMs = Math.max(this.stats.maxDecisionMs, ms);
      this.stats.maxDecisionFrames = Math.max(this.stats.maxDecisionFrames, frames);
      this.record({ type: 'decision', actor, kind, frame: this.frame, ms, frames, attempts: scope.attempts, gapFrames: scope.gapFrames });
    }
    scope.waiting = false; scope.started = performance.now(); scope.frame = this.frame;
    return value;
  }
  /** @param {import('three').Vector3Like} from @param {import('three').Vector3Like} to
   * @param {number} radius @param {number} height @param {number} maxSteps
   * @param {(() => boolean | null) | null} [immediate] @returns {boolean} */
  request(from, to, radius, height, maxSteps, immediate = null) {
    const scope = this.current;
    if (!scope) throw new Error('[ai worker] query outside planning scope');
    const key = [from.x, from.y, from.z, to.x, to.y, to.z, radius, height, maxSteps];
    if (!key.every(Number.isFinite)) return false;
    const identity = key.join(','), known = this.proofs.get(identity), proof = scope.proofs.get(identity);
    if (known !== undefined) { this.stats.proofHits++; return known; }
    if (!proof && immediate) {
      this.stats.immediateChecks++;
      const value = immediate();
      if (value !== null) { this.remember(identity, value); return value; }
    }
    scope.pending = true;
    if (from === scope.origin) scope.waitOrigin = [from.x, from.y, from.z];
    if (proof) { scope.used.add(proof.id); return false; }
    if (!this.ready || this.jobs.size >= MAX_JOBS) return false;
    const id = ++this.nextId, job = { id, key, identity, scope, frame: this.frame, sent: performance.now(), generation: this.generation };
    scope.proofs.set(identity, { id }); this.jobs.set(id, job); scope.used.add(id); scope.unsent.push({ id, key, actor: scope.actor });
    this.stats.submitted++; this.stats.pending = this.jobs.size;
    this.stats.maxPending = Math.max(this.stats.maxPending, this.jobs.size);
    return false;
  }
  /** @param {import('./attachment-types.ts').WorkerMessage} message */
  receive(message) {
    if (this.disposed || this.error || message.type !== 'result') return;
    if (typeof message.value !== 'boolean' || !Number.isFinite(message.ms) || message.ms < 0
      || !Number.isInteger(message.moves) || message.moves < 0) {
      this.failure(new Error('[ai worker] malformed query result')); return;
    }
    const job = this.jobs.get(message.id);
    this.stats.workerMs += message.ms; this.stats.motorMoves += message.moves;
    this.stats.repeatedStates += message.repeatedStates ?? 0; this.stats.savedMoves += message.savedMoves ?? 0;
    this.costs = message.costs ?? this.costs;
    this.record({ type: 'query', actor: job?.scope.actor ?? null, kind: job?.scope.kind ?? null,
      frame: job?.frame ?? null, key: this.profile ? job?.key ?? null : undefined, ms: message.ms, roundTripMs: job ? performance.now() - job.sent : null, queueMs: message.queueMs ?? null, moves: message.moves });
    if (!job || job.generation !== this.generation) { this.stats.stale++; return; }
    this.jobs.delete(job.id); job.scope.proofs.delete(job.identity);
    this.remember(job.identity, message.value);
    this.stats.completed++; this.stats.pending = this.jobs.size;
  }
  /** @param {string} key @param {boolean} value */
  remember(key, value) {
    if (this.proofs.size === MAX_PROOFS && !this.proofs.has(key)) {
      const first = this.proofs.keys().next().value;
      if (first !== undefined) this.proofs.delete(first);
    }
    this.proofs.set(key, value);
  }
  /** @param {import('./attachment-types.ts').QuerySample} sample */
  record(sample) {
    if (this.samples.length === 2048) { this.samples.shift(); this.stats.droppedSamples++; }
    this.samples.push(sample);
  }
  /** @param {string} key */
  cancel(key) {
    const scope = this.scopes.get(key); if (!scope) return;
    const ids = [];
    for (const [id, job] of this.jobs) if (job.scope === scope) { ids.push(id); this.jobs.delete(id); }
    if (ids.length) this.worker?.postMessage({ type: 'cancel', ids });
    this.stats.cancelled += ids.length; this.stats.pending = this.jobs.size; this.scopes.delete(key);
  }
  /** @param {unknown} error */
  failure(error) { this.error ??= error instanceof Error ? error : new Error(String(error)); this.ready = false; this.worker?.terminate(); this.clear(); return this.error; }
  clear() { for (const key of this.scopes.keys()) this.cancel(key); this.proofs.clear(); }
  dispose() { this.disposed = true; this.generation++; this.abortInit?.(); this.abortInit = null; this.clear(); this.worker?.terminate(); this.worker = null; this.ready = false; }
}
