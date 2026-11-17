/** Authored clip durations and gameplay event timelines. */

interface ClipEvent {
  t: number;
  name: string;
}

export class Clip {
  name: string;
  duration: number;
  events: ClipEvent[];

  constructor(name: string, duration: number, events: ClipEvent[]) {
    this.name = name;
    this.duration = duration;
    this.events = events;
  }
}

type ManifestClips = Record<
  string,
  { duration: number; events: { time: number; event: string }[] }
>;

/** Aliases name authored asset clips; a missing one is an asset/alias mismatch. */
function manifestClip(manifest: ManifestClips, source: string): ManifestClips[string] {
  const info = manifest[source] as ManifestClips[string] | undefined;
  if (!info) throw new Error(`[weapons] animation manifest has no clip '${source}'`);
  return info;
}

/** Keep authored durations and ordered event beats for native weapon aliases. */
export function buildManifestClips(
  aliases: Record<string, string>,
  manifest: ManifestClips
): Record<string, Clip> {
  const clips: Record<string, Clip> = {};
  for (const [name, source] of Object.entries(aliases)) {
    const info = manifestClip(manifest, source);
    clips[name] = new Clip(
      name,
      info.duration,
      info.events.map((ev): ClipEvent => ({ t: ev.time, name: ev.event }))
    );
  }
  return clips;
}

/** P320/MCX use asset magazine beats but synthesize reload start/gesture end. */
export function buildMagazineClips(
  aliases: Record<string, string>,
  manifest: ManifestClips
): Record<string, Clip> {
  const mapping: Record<string, string> = {
    magazine_out: 'magout',
    magazine_in: 'magin',
    bolt_forward: 'boltrelease',
  };
  const clips: Record<string, Clip> = {};
  for (const [name, source] of Object.entries(aliases)) {
    const { duration, events: authored } = manifestClip(manifest, source);
    const events = name.startsWith('reload') ? [{ t: 0, name: 'start' }] : [];
    for (const ev of authored) {
      // Only magazine beats are mapped; other authored events are intentionally dropped.
      const mapped = mapping[ev.event];
      if (mapped) events.push({ t: ev.time, name: mapped });
    }
    events.push({ t: duration - 0.0001, name: 'end' });
    clips[name] = new Clip(name, duration, events);
  }
  return clips;
}
