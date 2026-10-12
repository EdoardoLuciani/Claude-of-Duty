/** Browser harness argument values are untrusted until checked.
 * @param {unknown} value */
export function diagnosticArgs(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid diagnostic arguments');
  /** @type {Record<string, string | boolean>} */
  const args = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string' && typeof item !== 'boolean') throw new Error(`invalid --${key}`);
    args[key] = item;
  }
  return args;
}
