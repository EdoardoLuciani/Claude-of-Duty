// Vite bundles the complete local catalog. Raw Node smoke imports have no Vite env
// and use file URLs instead; do not guard on import.meta.glob itself (Vite replaces calls).
const RECORDINGS =
  import.meta.env === undefined
    ? null
    : import.meta.glob<string>('./samples/**/*.opus', {
        eager: true,
        query: '?url',
        import: 'default',
      });

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
