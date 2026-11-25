import type { Vector3Like } from 'three';

import { isRecord } from '../core/guards.ts';

export function isVector3Like(value: unknown): value is Vector3Like {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.z === 'number'
  );
}
/** A finite {x, y, z} copy of `value`; throws `message` otherwise. */
export function parseFinitePoint(value: unknown, message: string): Vector3Like {
  if (!isRecord(value) || !isNumber(value.x) || !isNumber(value.y) || !isNumber(value.z))
    throw new Error(message);
  return { x: value.x, y: value.y, z: value.z };
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
