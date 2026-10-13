import type { EngineContext, EngineSystems, SystemId } from './context.ts';
import type { EngineEventMap } from './events.ts';

/** Optional lifecycle hooks; instances need not redeclare their constructor. */
export interface Subsystem {
  init?(ctx: EngineContext): unknown;
  fixedUpdate?(step: number, ctx: EngineContext): void;
  update?(dt: number, ctx: EngineContext): void;
  lateUpdate?(dt: number, ctx: EngineContext): void;
  resize?(width: number, height: number, ctx: EngineContext): void;
  // Some systems store their render provider here instead of a lifecycle hook.
  // Only the keyed render provider is dispatched by Engine.step().
  render?: unknown;
  prewarmMaterials?(ctx: EngineContext): unknown;
  dispose?(): unknown;
}
export type FrameHook = 'fixedUpdate' | 'update' | 'lateUpdate';
export type LifecycleHook = keyof Subsystem;
export interface SystemDescriptor { id: string; name: string; deps: string[] }

/** Validate static metadata at registration, including plain test/mock instances. */
export function describeSystem(system: object): SystemDescriptor {
  const ctor: unknown = system.constructor;
  if ((typeof ctor !== 'function' && typeof ctor !== 'object') || ctor === null) {
    throw new Error('subsystem is missing a constructor');
  }
  const name = 'name' in ctor && typeof ctor.name === 'string' ? ctor.name : 'Subsystem';
  if (!('id' in ctor) || typeof ctor.id !== 'string' || !ctor.id) {
    throw new Error(`${name} is missing a static id`);
  }
  const deps: unknown = 'deps' in ctor ? ctor.deps : undefined;
  if (deps !== undefined && (!Array.isArray(deps) || !deps.every((dep: unknown) => typeof dep === 'string'))) {
    throw new Error(`${name} has invalid static deps`);
  }
  return { id: ctor.id, name, deps: deps === undefined ? [] : deps as string[] };
}

export class Registry {
  #systems = new Map<string, Subsystem>();
  #order: Subsystem[] = [];
  #cache = new Map<LifecycleHook, Subsystem[]>();

  add<S extends object>(system: S & Pick<Subsystem, keyof S & keyof Subsystem>) {
    const { id } = describeSystem(system);
    if (this.#systems.has(id)) throw new Error(`duplicate subsystem id "${id}"`);
    // Registration checks every lifecycle member present on the actual provider,
    // without making constructors or absent hooks part of the instance contract.
    this.#systems.set(id, system as Subsystem);
    return this;
  }

  get<K extends SystemId>(id: K): EngineSystems[K];
  get(id: string): Subsystem;
  get(id: string): Subsystem {
    const system = this.#systems.get(id);
    if (!system) throw new Error(`subsystem "${id}" not registered`);
    return system;
  }

  /** Non-throwing lookup for optional dependencies. */
  peek<K extends SystemId>(id: K): EngineSystems[K] | null;
  peek(id: string): Subsystem | null;
  peek(id: string): Subsystem | null {
    return this.#systems.get(id) ?? null;
  }

  has(id: string): boolean { return this.#systems.has(id); }

  resolve() {
    const seen = new Map<string, 0 | 1>();
    const out: Subsystem[] = [];
    const visit = (id: string, from: string): void => {
      const state = seen.get(id);
      if (state === 1) return;
      if (state === 0) throw new Error(`dependency cycle at "${id}" (via ${from})`);
      const sys = this.#systems.get(id);
      if (!sys) throw new Error(`"${from}" depends on unregistered subsystem "${id}"`);
      seen.set(id, 0);
      for (const dep of describeSystem(sys).deps) visit(dep, id);
      seen.set(id, 1);
      out.push(sys);
    };
    for (const id of this.#systems.keys()) visit(id, '<root>');
    this.#order = out;
    return out;
  }

  get ordered() { return this.#order.length ? this.#order : this.resolve(); }

  with(method: LifecycleHook): Subsystem[] {
    let list = this.#cache.get(method);
    if (!list) {
      list = this.ordered.filter((system) => typeof system[method] === 'function');
      this.#cache.set(method, list);
    }
    return list;
  }

  invalidate() { this.#cache.clear(); }
}

/** Synchronous event bus. Each bucket contains only listeners for its key. */
export class EventBus<Events extends object = EngineEventMap> {
  #map = new Map<keyof Events, Set<unknown>>();
  #onError: ((type: keyof Events, error: unknown) => void) | undefined;

  constructor(onError?: (type: keyof Events, error: unknown) => void) { this.#onError = onError; }

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    let listeners = this.#map.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#map.set(type, listeners);
    }
    listeners.add(fn);
    return () => this.off(type, fn);
  }

  once<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    const off = this.on(type, (event) => { off(); fn(event); });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): void {
    this.#map.get(type)?.delete(fn);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const listeners = this.#map.get(type);
    if (!listeners) return;
    // Erasure is local to storage: on/off preserve the key/payload relationship.
    for (const listener of Array.from(listeners)) {
      const fn = listener as (payload: Events[K]) => void;
      try { fn(payload); }
      catch (err) {
        if (type === 'engine:error') {
          console.error(`[events] handler for "${String(type)}" threw:`, err);
          continue;
        }
        this.#onError?.(type, err);
        throw err;
      }
    }
  }

  clear() { this.#map.clear(); }
}
