import { clamp01, lerp, smootherstep } from '../core/math.ts';
import { easeOutBack, easeOutCubic } from './mathx.ts';

/** Event timelines and optional additive pose tracks. */

type Vec3 = [number, number, number];
type Ease = 'linear' | 'smooth' | 'out' | 'back';
interface ClipKey {
  t: number;
  ease?: Ease;
  p?: Vec3;
  r?: Vec3;
  finger?: Vec3;
  back?: Vec3;
  pose?: string;
  weight?: number;
}
type Track = ClipKey[];
interface ClipChannels {
  weapon?: Track;
  lhand?: Track;
  events?: ClipEvent[];
}
interface ClipEvent {
  t: number;
  name: string;
}
interface HandSample {
  pos: Vec3;
  finger: Vec3;
  back: Vec3;
  pose: string;
  weight: number;
}
export interface ClipSample {
  active: boolean;
  pos: Vec3;
  rot: Vec3;
  lhand: HandSample;
}
type Blend = (a: ClipKey, b: ClipKey, weight: number, out: ClipSample) => void;

const EASE: Record<Ease, (t: number) => number> = {
  linear: (t: number): number => t,
  smooth: (t: number): number => smootherstep(0, 1, t),
  out: (t: number): number => easeOutCubic(t),
  back: (t: number): number => easeOutBack(t, 1.4),
};

function sampleTrack(keys: Track | null, t: number, out: ClipSample, blend: Blend): boolean {
  if (!keys || !keys.length) return false;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[Math.min(keys.length - 1, i + 1)];
  let w = 0;
  if (b !== a) {
    const span = b.t - a.t;
    w = span > 1e-6 ? clamp01((t - a.t) / span) : 1;
    w = EASE[b.ease ?? 'smooth'](w);
  }
  blend(a, b, w, out);
  return true;
}

export class Clip {
  name: string;
  duration: number;
  weapon: Track | null;
  lhand: Track | null;
  events: ClipEvent[];

  constructor(name: string, duration: number, channels: ClipChannels) {
    this.name = name;
    this.duration = duration;
    this.weapon = channels.weapon ?? null;
    this.lhand = channels.lhand ?? null;
    this.events = channels.events ?? [];
  }

  /** Sample into a preallocated result object. */
  sample(t: number, out: ClipSample): ClipSample {
    out.active = true;
    // ---- weapon additive pose ----
    if (this.weapon) {
      sampleTrack(this.weapon, t, out, (a, b, w, o): void => {
        for (let k = 0; k < 3; k++) {
          o.pos[k] = lerp(a.p?.[k] ?? 0, b.p?.[k] ?? 0, w);
          o.rot[k] = lerp(a.r?.[k] ?? 0, b.r?.[k] ?? 0, w);
        }
      });
    } else {
      out.pos[0] = out.pos[1] = out.pos[2] = 0;
      out.rot[0] = out.rot[1] = out.rot[2] = 0;
    }

    // ---- support hand ----
    if (this.lhand) {
      sampleTrack(this.lhand, t, out, (a, b, w, o): void => {
        for (let k = 0; k < 3; k++) {
          o.lhand.pos[k] = lerp(a.p![k], b.p![k], w);
          o.lhand.finger[k] = lerp(a.finger?.[k] ?? 0, b.finger?.[k] ?? 0, w);
          o.lhand.back[k] = lerp(a.back?.[k] ?? 0, b.back?.[k] ?? 0, w);
        }
        o.lhand.pose = w < 0.5 ? (a.pose ?? 'wrap') : (b.pose ?? 'wrap');
        o.lhand.weight = lerp(a.weight ?? 1, b.weight ?? 1, w);
      });
    } else {
      out.lhand.weight = 0;
    }

    return out;
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
    clips[name] = new Clip(name, info.duration, {
      events: info.events.map((ev): { t: number; name: string } => ({
        t: ev.time,
        name: ev.event,
      })),
    });
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
    clips[name] = new Clip(name, duration, { events });
  }
  return clips;
}

export function makeSampleResult(): ClipSample {
  return {
    active: false,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    lhand: { pos: [0, 0, 0], finger: [0, 0, 0], back: [0, 0, 0], pose: 'wrap', weight: 0 },
  };
}
