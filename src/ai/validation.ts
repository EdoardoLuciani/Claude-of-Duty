import type { Vector3Like } from 'three';

/** Checked external objects, shared by the AI asset and worker boundaries. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isVector3Like(value: unknown): value is Vector3Like {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.z === 'number'
  );
}
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item: unknown): item is string => typeof item === 'string')
  );
}
export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}
