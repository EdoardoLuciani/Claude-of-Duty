// Optional browser/renderer extensions and loaded metadata enter diagnostics as
// unknown. Keep absent measurements absent rather than manufacturing counters.
export function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const result: unknown = Reflect.get(value, key);
  return result;
}

export function numberField(value: unknown, key: string): number | null {
  const result = field(value, key);
  return typeof result === 'number' && Number.isFinite(result) ? result : null;
}

export function stringField(value: unknown, key: string): string | null {
  const result = field(value, key);
  return typeof result === 'string' ? result : null;
}

export function heapMb(): number | null {
  const bytes = numberField(field(performance, 'memory'), 'usedJSHeapSize');
  return bytes === null ? null : bytes >> 20;
}

export function programCount(info: unknown): number | null {
  const programs = field(info, 'programs');
  return Array.isArray(programs) ? programs.length : null;
}

export function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
