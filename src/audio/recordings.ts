// Served from public/audio/samples/ (provenance stays in src/audio/samples/).

/** Explicit numbered takes in authored order. */
export function recordingUrls(stem: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index): string => recordingUrl(`${stem}-${index + 1}`));
}

export function recordingUrl(name: string): string {
  return `/audio/samples/${name}.opus`;
}
