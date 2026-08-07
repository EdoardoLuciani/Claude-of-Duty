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

export class Registry {
  #systems = new Map();
  #order = [];

  add(system) {
    const id = system.constructor.id;
    if (!id) throw new Error(`${system.constructor.name} is missing a static id`);
    if (this.#systems.has(id)) throw new Error(`duplicate subsystem id "${id}"`);
    this.#systems.set(id, system);
    return this;
  }

  get(id) {
    const s = this.#systems.get(id);
    if (!s) throw new Error(`subsystem "${id}" not registered`);
    return s;
  }

  /** Non-throwing lookup for optional dependencies. */
  peek(id) {
    return this.#systems.get(id) ?? null;
  }

  has(id) {
    return this.#systems.has(id);
  }

  /** Topological sort over static deps; throws on cycles or missing deps. */
  resolve() {
    const seen = new Map(); // id -> 0 visiting, 1 done
    const out = [];
    const visit = (id, from) => {
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
  #cache = new Map();
  with(method) {
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
  #map = new Map();

  on(type, fn) {
    let entry = this.#map.get(type);
    if (!entry) {
      entry = { handlers: [], version: 0, depth: 0, dirty: false };
      this.#map.set(type, entry);
    }
    // Match Set semantics: registering the same active function is idempotent.
    for (let i = 0; i < entry.handlers.length; i++) {
      const h = entry.handlers[i];
      if (h.fn === fn && h.removed === 0) return () => this.off(type, fn);
    }
    entry.handlers.push({ fn, added: ++entry.version, removed: 0 });
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (e) => {
      off();
      fn(e);
    });
    return off;
  }

  off(type, fn) {
    const entry = this.#map.get(type);
    if (!entry) return;
    for (let i = 0; i < entry.handlers.length; i++) {
      const h = entry.handlers[i];
      if (h.fn !== fn || h.removed !== 0) continue;
      if (entry.depth > 0) {
        // Versioned removal preserves the old snapshot semantics: a handler
        // removed during this dispatch still runs in this dispatch, but not in
        // a nested or subsequent one. Compact after the outermost emit.
        h.removed = ++entry.version;
        entry.dirty = true;
      } else {
        entry.handlers.splice(i, 1);
        if (entry.handlers.length === 0) this.#map.delete(type);
      }
      return;
    }
  }

  emit(type, payload) {
    const entry = this.#map.get(type);
    if (!entry) return;
    entry.depth++;
    const snapshot = entry.version;
    const end = entry.handlers.length;
    try {
      for (let i = 0; i < end; i++) {
        const h = entry.handlers[i];
        if (h.added > snapshot || (h.removed !== 0 && h.removed <= snapshot)) continue;
        try {
          h.fn(payload);
        } catch (err) {
          console.error(`[events] handler for "${type}" threw:`, err);
        }
      }
    } finally {
      entry.depth--;
      if (entry.depth === 0 && entry.dirty) {
        let write = 0;
        for (let read = 0; read < entry.handlers.length; read++) {
          const h = entry.handlers[read];
          if (h.removed === 0) entry.handlers[write++] = h;
        }
        entry.handlers.length = write;
        entry.dirty = false;
        if (write === 0 && this.#map.get(type) === entry) this.#map.delete(type);
      }
    }
  }

  clear() {
    this.#map.clear();
  }
}
