// Bundles replace this call with every local recording's hashed URL (build/bun-plugin.mjs).
// Raw Node smoke imports have no import.meta.glob and use file URLs instead.
const RECORDINGS = import.meta.glob?.('./samples/**/*.opus') ?? null;

/** Explicit numbered takes in authored order, independent of glob enumeration. */
export function recordingUrls(stem: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index): string => recordingUrl(`${stem}-${index + 1}`));
}

export function recordingUrl(name: string): string {
  const path = `./samples/${name}.opus`;
  if (!RECORDINGS) return new URL(path, import.meta.url).href;
  const url = RECORDINGS[path];
  if (!url) throw new Error(`[audio] missing bundled recording: ${path}`);
  return url;
}
