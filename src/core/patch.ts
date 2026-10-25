/**
 * Apply an optional override without letting an explicit undefined erase state.
 * TypeScript callers must omit unset fields; JS/debug callers get the same
 * omission semantics. Unlike Object.assign, values must belong to the target.
 */
export function applyDefinedPatch<T extends object>(target: T, patch: Partial<T>): void {
  for (const key in patch) {
    if (!Object.hasOwn(patch, key)) continue;
    const value = patch[key];
    if (value !== undefined) target[key] = value;
  }
}
