import { smootherstep, easeOutBack, easeOutCubic, clamp01, lerp } from './mathx.ts';

/** Event timelines plus the MCX's additive draw/holster tracks. */

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
interface ClipWeaponDef {
  drawTime: number;
  holsterTime: number;
}
interface WeaponNodes {
  gripL: HandNode;
}
interface HandNode {
  pos: Vec3;
  finger?: Vec3;
  back?: Vec3;
}
type Blend = (a: ClipKey, b: ClipKey, weight: number, out: ClipSample) => void;

const EASE: Record<Ease, (t: number) => number> = {
  linear: (t: number) => t,
  smooth: (t: number) => smootherstep(0, 1, t),
  out: (t: number) => easeOutCubic(t),
  back: (t: number) => easeOutBack(t, 1.4),
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
    w = (EASE[b.ease ?? 'smooth'] ?? EASE.smooth)(w);
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
      sampleTrack(this.weapon, t, out, (a, b, w, o) => {
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
      sampleTrack(this.lhand, t, out, (a, b, w, o) => {
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

/** Keep authored durations and ordered event beats for native weapon aliases. */
export function buildManifestClips(
  aliases: Record<string, string>,
  manifest: Record<string, { duration: number; events: { time: number; event: string }[] }>
): Record<string, Clip> {
  const clips: Record<string, Clip> = {};
  for (const [name, source] of Object.entries(aliases)) {
    const info = manifest[source];
    clips[name] = new Clip(name, info.duration, {
      events: info.events.map((ev) => ({ t: ev.time, name: ev.event })),
    });
  }
  return clips;
}

/** P320/MCX use asset magazine beats but synthesize reload start/gesture end. */
export function buildMagazineClips(
  aliases: Record<string, string>,
  manifest: Record<string, { duration: number; events: { time: number; event: string }[] }>,
  durationOf = (source: string) => manifest[source].duration
): Record<string, Clip> {
  const mapping: Record<string, string> = {
    magazine_out: 'magout',
    magazine_in: 'magin',
    bolt_forward: 'boltrelease',
  };
  const clips: Record<string, Clip> = {};
  for (const [name, source] of Object.entries(aliases)) {
    const duration = durationOf(source);
    const events = name.startsWith('reload') ? [{ t: 0, name: 'start' }] : [];
    for (const ev of manifest[source].events)
      if (mapping[ev.event]) events.push({ t: ev.time, name: mapping[ev.event] });
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

/* ========================================================================== */
/*  clip construction                                                         */
/* ========================================================================== */

const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];

/** MCX retains additive draw/holster; its other clips are authored. */
export function buildEquipClips(
  nodes: Pick<WeaponNodes, 'gripL'>,
  def: ClipWeaponDef
): Record<string, Clip> {
  const hgP = nodes.gripL.pos;
  const wrapFinger = nodes.gripL.finger ?? v3(0.82, 0.5, -0.28);
  const wrapBack = nodes.gripL.back ?? v3(-0.5, 0.32, -0.8);
  const drawT = def.drawTime ?? 0.62;
  const draw = new Clip('draw', drawT, {
    weapon: [
      { t: 0, p: v3(0.05, -0.3, 0.14), r: v3(-0.85, 0.5, 0.55) },
      { t: 0.55 * drawT, p: v3(0.01, -0.03, 0.02), r: v3(-0.1, 0.06, 0.06), ease: 'out' },
      { t: 0.78 * drawT, p: v3(-0.004, 0.008, -0.006), r: v3(0.04, -0.02, -0.02) },
      { t: drawT, p: v3(0, 0, 0), r: v3(0, 0, 0), ease: 'out' },
    ],
    lhand: [
      {
        t: 0,
        p: v3(hgP[0] - 0.02, hgP[1] - 0.09, hgP[2] + 0.06),
        finger: wrapFinger,
        back: wrapBack,
        pose: 'open',
      },
      { t: 0.6 * drawT, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap', ease: 'out' },
      { t: drawT, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
    ],
    events: [{ t: 0.995 * drawT, name: 'end' }],
  });

  const holT = def.holsterTime ?? 0.4;
  const holster = new Clip('holster', holT, {
    weapon: [
      { t: 0, p: v3(0, 0, 0), r: v3(0, 0, 0) },
      { t: 0.25 * holT, p: v3(0.004, 0.014, -0.01), r: v3(0.08, -0.04, -0.05) },
      { t: holT, p: v3(0.05, -0.32, 0.15), r: v3(-0.9, 0.55, 0.6), ease: 'out' },
    ],
    lhand: [
      { t: 0, p: hgP, finger: wrapFinger, back: wrapBack, pose: 'wrap' },
      {
        t: holT,
        p: v3(hgP[0] - 0.02, hgP[1] - 0.1, hgP[2] + 0.07),
        finger: wrapFinger,
        back: wrapBack,
        pose: 'open',
        ease: 'out',
      },
    ],
    events: [{ t: 0.995 * holT, name: 'end' }],
  });

  return { draw, holster };
}
