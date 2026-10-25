import type { EngineContext } from './context.ts';
import type { EngineEventMap } from './events.ts';

/** Optional lifecycle hooks; instances need not redeclare their constructor. */
export interface Subsystem {
  init?(ctx: EngineContext): void | Promise<void>;
  fixedUpdate?(step: number, ctx: EngineContext): void;
  update?(dt: number, ctx: EngineContext): void;
  lateUpdate?(dt: number, ctx: EngineContext): void;
  resize?(width: number, height: number, ctx: EngineContext): void;
  // Some systems store their render provider here instead of a lifecycle hook.
  // Only the keyed render provider is dispatched by Engine.step().
  render?: unknown;
  prewarmMaterials?(ctx: EngineContext): unknown;
  dispose?(): void | Promise<void>;
}
export type FrameHook = 'fixedUpdate' | 'update' | 'lateUpdate';
export type LifecycleHook = keyof Subsystem;
export interface SystemDescriptor {
  id: string;
  name: string;
  deps: string[];
}

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
  if (
    deps !== undefined &&
    (!Array.isArray(deps) || !deps.every((dep: unknown): dep is string => typeof dep === 'string'))
  ) {
    throw new Error(`${name} has invalid static deps`);
  }
  return { id: ctor.id, name, deps: deps === undefined ? [] : (deps as string[]) };
}

/** A constructor's literal ID determines its instance contract, not a union of providers. */
export type SystemConstructor<Systems, Args extends unknown[]> = {
  [K in keyof Systems & string]: {
    readonly id: K;
    readonly deps?: readonly (keyof Systems & string)[];
    new (...args: Args): Systems[K];
  };
}[keyof Systems & string];

// For example: ['player', PlayerSystem] | ['audio', AudioSystem], not independent unions.
type Registration<Systems> = {
  [K in keyof Systems & string]: [id: K, system: Systems[K]];
}[keyof Systems & string];

/** Registration and lookup share one provider map; untyped registries promise only hooks. */
export class Registry<
  Systems extends { [K in keyof Systems]: Subsystem } = Record<string, Subsystem>,
> {
  #providers: { [K in keyof Systems]?: Systems[K] } = {};
  #systems = new Map<string, Subsystem>();
  #order: Subsystem[] = [];
  #cache = new Map<LifecycleHook, Subsystem[]>();

  add(...[id, system]: Registration<Systems>): this {
    return this.#insert(id, system);
  }

  addConstructor<Args extends unknown[]>(
    SystemClass: SystemConstructor<Systems, Args>,
    ...args: Args
  ): this {
    return this.#insert(SystemClass.id, new SystemClass(...args));
  }

  #insert<K extends keyof Systems & string>(id: K, system: Systems[K]): this {
    const descriptor = describeSystem(system);
    if (descriptor.id !== id)
      throw new Error(`subsystem id "${descriptor.id}" does not match registration "${id}"`);
    if (this.#systems.has(id)) throw new Error(`duplicate subsystem id "${id}"`);
    // defineProperty also handles IDs such as "__proto__" as ordinary own keys.
    Object.defineProperty(this.#providers, id, { value: system, configurable: true });
    this.#systems.set(id, system);
    this.#order = [];
    this.invalidate();
    return this;
  }

  get<K extends keyof Systems & string>(id: K): Systems[K] {
    const system = this.peek(id);
    if (!system) throw new Error(`subsystem "${id}" not registered`);
    return system;
  }

  /** Non-throwing lookup for optional dependencies. */
  peek<K extends keyof Systems & string>(id: K): Systems[K] | null {
    return Object.hasOwn(this.#providers, id) ? (this.#providers[id] ?? null) : null;
  }

  has(id: keyof Systems & string): boolean {
    return this.#systems.has(id);
  }

  resolve(): Subsystem[] {
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

  get ordered(): Subsystem[] {
    return this.#order.length ? this.#order : this.resolve();
  }

  with(method: LifecycleHook): Subsystem[] {
    let list = this.#cache.get(method);
    if (!list) {
      list = this.ordered.filter((system): boolean => typeof system[method] === 'function');
      this.#cache.set(method, list);
    }
    return list;
  }

  invalidate(): void {
    this.#cache.clear();
  }
}

// For example: ['resize', ResizePayload] | ['player:heartbeat', HeartbeatPayload].
type Emission<Events> = {
  [K in keyof Events]: [type: K, payload: Events[K]];
}[keyof Events];

/** Synchronous event bus. Each bucket contains only listeners for its key. */
export class EventBus<Events extends object = EngineEventMap> {
  #map: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};
  // Separate numeric keys before object indexing coerces them to strings.
  // This preserves Map's 1/'1' distinction and SameValueZero number semantics.
  #numbers: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};
  #onError: ((type: keyof Events, error: unknown) => void) | undefined;

  constructor(onError?: (type: keyof Events, error: unknown) => void) {
    this.#onError = onError;
  }

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    const buckets = typeof type === 'number' ? this.#numbers : this.#map;
    let listeners = Object.hasOwn(buckets, type) ? buckets[type] : undefined;
    if (!listeners) {
      listeners = new Set<(payload: Events[K]) => void>();
      Object.defineProperty(buckets, type, { value: listeners, configurable: true });
    }
    listeners.add(fn);
    return (): void => this.off(type, fn);
  }

  once<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    const off = this.on(type, (event): void => {
      off();
      fn(event);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): void {
    const buckets = typeof type === 'number' ? this.#numbers : this.#map;
    if (Object.hasOwn(buckets, type)) buckets[type]?.delete(fn);
  }

  // A union key and an independently chosen payload are not a correlated event.
  emit(...args: Emission<Events>): void;
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const buckets = typeof type === 'number' ? this.#numbers : this.#map;
    const listeners = Object.hasOwn(buckets, type) ? buckets[type] : undefined;
    if (!listeners) return;
    for (const fn of Array.from(listeners)) {
      try {
        fn(payload);
      } catch (err) {
        if (type === 'engine:error') {
          console.error(`[events] handler for "${String(type)}" threw:`, err);
          continue;
        }
        this.#onError?.(type, err);
        throw err;
      }
    }
  }

  clear(): void {
    this.#map = {};
    this.#numbers = {};
  }
}
