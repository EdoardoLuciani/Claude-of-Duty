import { recordingUrls } from './recordings.ts';
/** Offline-authored speech. Actor IDs select a stable cast member, never a pitch shift. */
import type { AiCalloutKind } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import { SPEED_OF_SOUND } from './dsp.ts';
import type { WeaponSampleBank } from './samples.ts';
import type { SpatialField } from './spatial.ts';

export const CALLOUT_CAST = ['orus', 'algenib', 'alnilam', 'iapetus'] as const;
export const CALLOUT_URLS = {
  'orus-spot': recordingUrls('callouts/orus-spot', 3),
  'orus-reload': recordingUrls('callouts/orus-reload', 3),
  'orus-grenade': recordingUrls('callouts/orus-grenade', 3),
  'algenib-spot': recordingUrls('callouts/algenib-spot', 3),
  'algenib-reload': recordingUrls('callouts/algenib-reload', 3),
  'algenib-grenade': recordingUrls('callouts/algenib-grenade', 3),
  'alnilam-spot': recordingUrls('callouts/alnilam-spot', 3),
  'alnilam-reload': recordingUrls('callouts/alnilam-reload', 3),
  'alnilam-grenade': recordingUrls('callouts/alnilam-grenade', 3),
  'iapetus-spot': recordingUrls('callouts/iapetus-spot', 3),
  'iapetus-reload': recordingUrls('callouts/iapetus-reload', 3),
  'iapetus-grenade': recordingUrls('callouts/iapetus-grenade', 3),
} as const;
export type CalloutBank = keyof typeof CALLOUT_URLS;
export const CALLOUT_MIX = {
  gain: 1,
  send: 0.35,
  maxDistance: 55,
  spacing: 1.2,
  actorCooldown: 10,
} as const;

export function isCalloutKind(kind: string): kind is AiCalloutKind {
  return kind === 'spot' || kind === 'reload' || kind === 'grenade';
}

/** Sequential, immutable enemy IDs distribute each four spawns evenly across the cast. */
export function calloutBank(voice: number, kind: AiCalloutKind): CalloutBank {
  const identity = Number.isFinite(voice) ? Math.abs(Math.trunc(voice)) : 0;
  return `${CALLOUT_CAST[identity % CALLOUT_CAST.length]}-${kind}`;
}

interface Position {
  x: number;
  y: number;
  z: number;
}
interface ActiveCallout {
  actor: number;
  kind: AiCalloutKind;
  position: Position;
  emitter: NonNullable<ReturnType<SpatialField['acquire']>>;
  voice: ReturnType<WeaponSampleBank['callout']>;
}

/** One intelligible nearby line at a time; no queued/stale tactical information. */
export class CalloutPlayer {
  private active: ActiveCallout | null = null;
  private nextAt = -Infinity;
  private readonly actorTimes = new Map<number, number>();

  private readonly actx: BaseAudioContext;
  private readonly field: SpatialField;
  private readonly samples: WeaponSampleBank;
  private readonly rng: Rng;

  constructor(actx: BaseAudioContext, field: SpatialField, samples: WeaponSampleBank, rng: Rng) {
    this.actx = actx;
    this.field = field;
    this.samples = samples;
    this.rng = rng;
  }

  play(kind: AiCalloutKind, position: Position, actor: number, level = 1): boolean {
    if (this.actx.state === 'suspended' || !Number.isFinite(position.x + position.y + position.z))
      return false;
    const dist = this.field.distanceTo(position.x, position.y, position.z);
    if (dist > CALLOUT_MIX.maxDistance) return false;
    this.update();
    const now = this.actx.currentTime;
    // A throw must not be silenced by the same actor's recent contact/reload line.
    if (kind !== 'grenade' && now < (this.actorTimes.get(actor) ?? -Infinity)) return false;
    // Outgoing grenade announcements may interrupt ordinary speech, never each other.
    if (kind === 'grenade') {
      if (this.active?.kind === 'grenade') return false;
    } else if (this.active || now < this.nextAt) return false;

    this.stop();
    const when = now + dist / SPEED_OF_SOUND;
    const emitter = this.field.acquire({
      x: position.x,
      y: position.y,
      z: position.z,
      when,
      dist,
      bus: 'voice',
      send: CALLOUT_MIX.send,
      priority: kind === 'grenade' ? 1 : 0.85,
      tracked: true,
    });
    if (!emitter) return false;
    let voice: ReturnType<WeaponSampleBank['callout']> | undefined;
    try {
      voice = this.samples.callout(kind, actor, this.rng, { when, level });
      this.field.hold(emitter, voice.node, voice.end);
      this.active = { actor, kind, position, emitter, voice };
      this.nextAt = voice.end + CALLOUT_MIX.spacing;
      this.actorTimes.set(actor, now + CALLOUT_MIX.actorCooldown);
      return true;
    } catch (error) {
      voice?.stop();
      emitter.detach();
      throw error;
    }
  }

  update(): void {
    const current = this.active;
    if (!current) return;
    if (this.actx.currentTime >= current.voice.end) {
      this.stop();
      return;
    }
    // Producers supply the actor's retained position, not a pooled scratch vector.
    current.emitter.moveTo(current.position.x, current.position.y, current.position.z);
  }

  stop(actor?: number): void {
    const current = this.active;
    if (!current || (actor !== undefined && actor !== current.actor)) return;
    this.active = null;
    current.voice.stop();
    current.emitter.detach();
    this.nextAt = Math.min(this.nextAt, this.actx.currentTime + CALLOUT_MIX.spacing);
  }

  forget(actor: number): void {
    this.stop(actor);
    this.actorTimes.delete(actor);
  }

  reset(): void {
    this.stop();
    this.nextAt = -Infinity;
    this.actorTimes.clear();
  }
}
