/**
 * Subsystem registry + shared context.
 *
 * CONTRACT — every subsystem is a class with:
 *   static id      : string, unique. Other systems fetch it via ctx.get(id).
 *   static deps    : string[] of subsystem ids that must init first.
 *   async init(ctx): build resources. May await asset loads.
 *   update(dt,ctx) : variable-rate, once per frame, before render.
 *   fixedUpdate(h,ctx): fixed-rate (PHYSICS_HZ), 0..N times per frame. Optional.
 *   lateUpdate(dt,ctx): after all update(), before render. Optional.
 *   resize(w,h,ctx): viewport changed. Optional.
 *   dispose()      : free GPU/CPU resources. Optional.
 *
 * Subsystems MUST NOT import each other directly — go through ctx.get(id).
 * That keeps the dependency graph explicit and lets agents own files in isolation.
 */

interface Subsystem {
  constructor: { id: string; name: string; deps?: string[] };
  init?: (ctx: any) => unknown;
  resize?: (width: number, height: number, ctx: any) => void;
  render?: (ctx: any) => void;
  dispose?: () => unknown;
  [key: string]: unknown;
}
type EventListener = (payload: any) => void;

export class Registry {
  #systems = new Map<string, Subsystem>();
  #order: Subsystem[] = [];

  add(system: Subsystem) {
    const id = system.constructor.id;
    if (!id) throw new Error(`${system.constructor.name} is missing a static id`);
    if (this.#systems.has(id)) throw new Error(`duplicate subsystem id "${id}"`);
    this.#systems.set(id, system);
    return this;
  }

  get(id: string): Subsystem {
    const s = this.#systems.get(id);
    if (!s) throw new Error(`subsystem "${id}" not registered`);
    return s;
  }

  /** Non-throwing lookup for optional dependencies. */
  peek(id: string): Subsystem | null {
    return this.#systems.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.#systems.has(id);
  }

  /** Topological sort over static deps; throws on cycles or missing deps. */
  resolve() {
    const seen = new Map<string, 0 | 1>(); // id -> 0 visiting, 1 done
    const out: Subsystem[] = [];
    const visit = (id: string, from: string): void => {
      const state = seen.get(id);
      if (state === 1) return;
      if (state === 0) throw new Error(`dependency cycle at "${id}" (via ${from})`);
      const sys = this.#systems.get(id);
      if (!sys) throw new Error(`"${from}" depends on unregistered subsystem "${id}"`);
      seen.set(id, 0);
      for (const d of sys.constructor.deps ?? []) visit(d, id);
      seen.set(id, 1);
      out.push(sys);
    };
    for (const id of this.#systems.keys()) visit(id, '<root>');
    this.#order = out;
    return out;
  }

  get ordered() {
    return this.#order.length ? this.#order : this.resolve();
  }

  /** Systems that implement `method`, in dependency order. Cached per method. */
  #cache = new Map<string, Subsystem[]>();
  with(method: string): Subsystem[] {
    let list = this.#cache.get(method);
    if (!list) {
      list = this.ordered.filter((s) => typeof s[method] === 'function');
      this.#cache.set(method, list);
    }
    return list;
  }

  invalidate() {
    this.#cache.clear();
  }
}

/** Minimal typed event bus. Handlers are called synchronously. */
export class EventBus {
  #map = new Map<string, Set<EventListener>>();
  #onError: ((type: string, error: unknown) => void) | undefined;

  constructor(onError?: (type: string, error: unknown) => void) {
    this.#onError = onError;
  }

  on(type: string, fn: EventListener): () => void {
    let listeners = this.#map.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#map.set(type, listeners);
    }
    listeners.add(fn);
    return () => this.off(type, fn);
  }

  once(type: string, fn: EventListener): () => void {
    const off = this.on(type, (e) => {
      off();
      fn(e);
    });
    return off;
  }

  off(type: string, fn: EventListener): void {
    this.#map.get(type)?.delete(fn);
  }

  emit(type: string, payload: any): void {
    const set = this.#map.get(type);
    if (!set) return;
    // Copy so handlers may unsubscribe during dispatch.
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        // Fatal notifications must still reach the UI/recorder if another
        // diagnostic listener fails. Gameplay dispatch instead aborts immediately.
        if (type === 'engine:error') {
          console.error(`[events] handler for "${type}" threw:`, err);
          continue;
        }
        this.#onError?.(type, err);
        throw err;
      }
    }
  }

  clear() {
    this.#map.clear();
  }
}
