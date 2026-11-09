/** Overlay checked overrides onto a complete object. Keep override state live so
 * tests can drive their original controls after installing the fixture.
 * A real instance or complete typed implementation is always required.
 */
export function fixture<T extends object>(members: Partial<T>, target: T): T {
  for (const key of Reflect.ownKeys(members)) {
    const descriptor: PropertyDescriptor = {
      configurable: true,
      enumerable: true,
      get(): unknown {
        const value: unknown = Reflect.get(members, key, target);
        return value;
      },
      set(value: unknown): void {
        if (!Reflect.set(members, key, value))
          throw new TypeError(`Cannot set fixture member ${String(key)}`);
      },
    };
    // Native CSS declarations handle named style fields through their setters.
    if (!Reflect.defineProperty(target, key, descriptor)) {
      const value: unknown = Reflect.get(members, key);
      if (!Reflect.set(target, key, value))
        throw new TypeError(`Cannot override fixture member ${String(key)}`);
    }
  }
  return target;
}
