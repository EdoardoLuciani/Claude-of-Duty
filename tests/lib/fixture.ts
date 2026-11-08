/**
 * Deliberate Node test boundary for browser/native interfaces that cannot be
 * instantiated here. Supplied fields are checked against the real interface;
 * an unexpected dependency fails at its first access instead of silently
 * returning undefined. Prefer real instances wherever construction is practical.
 *
 * Issue #621: the maintainer approved no-unsafe-type-assertion being disabled
 * ONLY in this file. Do not add assertion-based fixtures elsewhere.
 */
export function fixture<T extends object>(members: Partial<T>): T {
  return new Proxy(members, {
    get(target, key, receiver): unknown {
      if (!Reflect.has(target, key)) {
        throw new Error(`Test fixture is missing member ${String(key)}`);
      }
      const value: unknown = Reflect.get(target, key, receiver);
      return value;
    },
  }) as T;
}
