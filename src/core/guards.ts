/** Narrow untrusted object metadata without asserting its field types. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Key validation for the engine's closed, authored lookup tables. */
export function hasOwn<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(object, key);
}

/** Validate the only method needed when releasing decoded image resources. */
export function isClosable(value: unknown): value is { close(): void } {
  return isRecord(value) && typeof value.close === 'function';
}

/** ImageBitmap's public surface also works with offline image-loader fixtures. */
export function isImageBitmap(value: unknown): value is ImageBitmap {
  return (
    isRecord(value) &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.close === 'function'
  );
}
