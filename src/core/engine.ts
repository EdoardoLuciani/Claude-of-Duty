import * as THREE from 'three';

import { FIXED_DT, MAX_SUBSTEPS } from './config.ts';
import type { RuntimeConfig } from './config.ts';
import type { EngineContext, EngineSystems, SystemId, EngineTime } from './context.ts';
import type { EngineError } from './events.ts';
import { Input } from './input.ts';
import { Registry, EventBus, describeSystem } from './registry.ts';
import type { Subsystem, FrameHook } from './registry.ts';
import { Rng } from './rng.ts';

/**
 * The Engine owns the frame loop and the shared context handed to every
 * subsystem. It does NOT know what any subsystem does — it only sequences them.
 *
 * Frame order:
 *   1. input.beginFrame()
 *   2. fixedUpdate(FIXED_DT) xN   — physics, deterministic gameplay
 *   3. update(dt)                 — animation, cameras, AI decisions
 *   4. lateUpdate(dt)             — anything that must observe final transforms
 *   5. render subsystem draws
 *   6. input.endFrame()
 */
export class Engine {
  declare canvas: HTMLCanvasElement;
  declare config: RuntimeConfig;
  declare registry: Registry;
  declare events: EventBus;
  declare input: Input;
  declare rng: Rng;
  declare scene: THREE.Scene;
  declare camera: THREE.PerspectiveCamera;
  declare viewScene: THREE.Scene;
  declare viewCamera: THREE.PerspectiveCamera;
  declare time: EngineTime;
  declare ctx: EngineContext;
  declare _accum: number;
  declare _last: number;
  declare _running: boolean;
  private _gameplaySuspended = false;
  /** One-shot rendered-frame boundary; graph warmup never calls step(). */
  onFirstRender: (() => void) | null = null;
  declare error: EngineError | null;
  declare _onResize: () => void;
  _loop = (now: number): void => {
    if (!this._running) return;
    requestAnimationFrame(this._loop);
    this.step(now);
  };

  constructor({ canvas, config }: { canvas: HTMLCanvasElement; config: RuntimeConfig }) {
    this.canvas = canvas;
    this.config = config;
    this.registry = new Registry();
    this.events = new EventBus((type, err): void => this.fail('events', type, err));
    this.input = new Input(canvas, config);
    this.rng = new Rng(config.deterministic ? 0x5eed1234 : (Math.random() * 2 ** 32) >>> 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(config.fov, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';

    /** Separate scene+camera for the first-person viewmodel, drawn with its own
     *  near plane so hands/weapon never clip into world geometry. */
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(60, 1, 0.005, 12);

    this.time = {
      /** Seconds since start, scaled. */ elapsed: 0,
      /** Unscaled wall-clock seconds since start. */ raw: 0,
      /** Last frame delta, scaled and clamped. */ dt: 0,
      /** Fixed step. */ fixed: FIXED_DT,
      /** Interpolation alpha between the last two physics steps, 0..1. */ alpha: 0,
      scale: 1,
      frame: 0,
    };

    this.ctx = {
      engine: this,
      scene: this.scene,
      camera: this.camera,
      viewScene: this.viewScene,
      viewCamera: this.viewCamera,
      canvas,
      config,
      events: this.events,
      input: this.input,
      time: this.time,
      rng: this.rng,
      get: <K extends SystemId>(id: K): EngineSystems[K] => this.registry.get(id),
      peek: <K extends SystemId>(id: K): EngineSystems[K] | null => this.registry.peek(id),
      has: (id: string): boolean => this.registry.has(id),
    };

    this._accum = 0;
    this._last = 0;
    this._running = false;
    this.error = null; // Fatal simulation failure; only reloading may clear it.
    this._onResize = (): void => this.resize();
  }

  add<Args extends unknown[]>(
    SystemClass: { new (...args: Args): Subsystem; id: string; deps?: string[] },
    ...args: Args
  ): this {
    this.registry.add(new SystemClass(...args));
    return this;
  }

  async init(): Promise<this> {
    const order = this.registry.resolve();
    for (const sys of order) {
      const t0 = performance.now();
      await sys.init?.(this.ctx);
      if (this.error) throw new Error(this.error.message);
      const ms = performance.now() - t0;
      if (ms > 50) console.info(`[engine] ${describeSystem(sys).id} init ${ms.toFixed(0)}ms`);
    }
    this.input.attach();
    addEventListener('resize', this._onResize);
    this.resize();
    return this;
  }

  private hasError(): boolean {
    return this.error !== null;
  }

  resize(): void {
    if (this.hasError()) return;
    const w = Math.max(1, this.canvas.clientWidth || innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    let system = 'events';
    try {
      for (const sys of this.registry.with('resize')) {
        system = describeSystem(sys).id;
        sys.resize?.(w, h, this.ctx);
        if (this.hasError()) return;
      }
      system = 'events';
      this.events.emit('resize', { width: w, height: h });
    } catch (err) {
      this.fail(system, 'resize', err);
    }
  }

  start(): void {
    if (this._running || this.error) return;
    this._running = true;
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop(): void {
    this._running = false;
  }

  get gameplaySuspended(): boolean {
    return this._gameplaySuspended;
  }

  /**
   * Gate gameplay without stopping rendered frames or raw-time UI/input.
   * Opt-in: existing callers and capture pumps continue running by default.
   * The caller owns Start/control readiness; this does not cancel async work
   * or block synchronous events such as game:restart.
   */
  setGameplaySuspended(suspended: boolean): void {
    if (this.error || suspended === this._gameplaySuspended) return;
    this._gameplaySuspended = suspended;
    this.time.dt = this.time.alpha = this._accum = 0;
    // A Start click/key and input collected while waiting must not reach play.
    if (!suspended) this.input.clear();
  }

  /** Advance one frame. Exposed so the capture harness can pump frames by hand. */
  step(now = performance.now()): void {
    const t = this.time;
    // Clamp so a tab-switch or a breakpoint doesn't teleport the simulation.
    const rawDt = Math.min(0.1, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    t.raw += rawDt;
    t.dt = this.error || this._gameplaySuspended ? 0 : rawDt * t.scale;
    t.elapsed += t.dt;
    t.frame++;

    if (!this.error) this.input.beginFrame();

    this._accum += t.dt;
    let steps = 0;
    const fixedSystems = this.registry.with('fixedUpdate');
    while (
      !this.error &&
      !this._gameplaySuspended &&
      this._accum >= FIXED_DT &&
      steps < MAX_SUBSTEPS
    ) {
      for (const sys of fixedSystems) this._invoke(sys, 'fixedUpdate', FIXED_DT);
      if (this.error || this._gameplaySuspended) break;
      this._accum -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this._accum = 0; // shed backlog rather than spiral
    t.alpha = this._accum / FIXED_DT;

    // A failed update may have mutated state. Never run another gameplay hook
    // after it, including later hooks in this frame. Keep rendering the scene.
    for (const sys of this.registry.with('update')) this._invoke(sys, 'update', t.dt);
    for (const sys of this.registry.with('lateUpdate')) this._invoke(sys, 'lateUpdate', t.dt);

    const renderSystem = this.registry.peek('render');
    if (renderSystem?.render) {
      try {
        renderSystem.render(this.ctx);
        if (!this.error && this.onFirstRender) {
          const complete = this.onFirstRender;
          this.onFirstRender = null;
          complete();
        }
      } catch (err) {
        this.fail('render', 'render', err);
        this.stop(); // The DOM error remains visible even if the GPU cannot draw.
      }
    }

    this.input.endFrame();
  }

  _invoke(sys: Subsystem, method: FrameHook, arg: number): void {
    if (this.error) return;
    // UI owns raw-time menu/HUD animation in lateUpdate. Do not run even a
    // zero-dt gameplay hook: several hooks publish damage/spawns without dt.
    if (this._gameplaySuspended && !(method === 'lateUpdate' && describeSystem(sys).id === 'ui'))
      return;
    try {
      sys[method]?.(arg, this.ctx);
    } catch (err) {
      this.fail(describeSystem(sys).id, method, err);
    }
  }

  /** Terminal errors may also arrive asynchronously (for example device loss). */
  fail(system: string, method: string, err: unknown): void {
    if (this.error) return;
    const message = typeof err === 'object' && err !== null && 'message' in err ? err.message : err;
    this.error = { system, method, message: String(message ?? err).slice(0, 200) };
    this.time.scale = this.time.dt = this._accum = 0;
    this.input.enabled = false;
    this.input.frozen = true;
    console.error(`[engine] ${system} ${method} failed; reload required`, err);
    this.events.emit('engine:error', this.error);
  }

  async dispose(): Promise<void> {
    this.stop();
    removeEventListener('resize', this._onResize);
    this.input.detach();
    const errors = [];
    try {
      for (const sys of [...this.registry.ordered].reverse()) {
        try {
          await sys.dispose?.();
        } catch (error) {
          errors.push(error);
          console.error(
            `[engine] ${String('id' in sys.constructor ? sys.constructor.id : undefined)} dispose failed`,
            error
          );
        }
      }
    } finally {
      this.events.clear();
    }
    if (errors.length) throw new AggregateError(errors, 'Engine teardown failed');
  }
}
