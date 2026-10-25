/** Offline-authored speech. Actor IDs select a stable cast member, never a pitch shift. */
import type { AiCalloutKind } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import { SPEED_OF_SOUND } from './dsp.ts';
import type { WeaponSampleBank } from './samples.ts';
import type { SpatialField } from './spatial.ts';

export const CALLOUT_CAST = ['orus', 'algenib', 'alnilam', 'iapetus'] as const;
export const CALLOUT_URLS = {
  'orus-spot': [
    new URL('./samples/callouts/orus-spot-1.opus', import.meta.url).href,
    new URL('./samples/callouts/orus-spot-2.opus', import.meta.url).href,
    new URL('./samples/callouts/orus-spot-3.opus', import.meta.url).href,
  ],
  'orus-reload': [
    new URL('./samples/callouts/orus-reload-1.opus', import.meta.url).href,
    new URL('./samples/callouts/orus-reload-2.opus', import.meta.url).href,
    new URL('./samples/callouts/orus-reload-3.opus', import.meta.url).href,
  ],
  'orus-grenade': [
    new URL('./samples/callouts/orus-grenade-1.opus', import.meta.url).href,
    new URL('./samples/callouts/orus-grenade-2.opus', import.meta.url).href,
    new URL('./samples/callouts/orus-grenade-3.opus', import.meta.url).href,
  ],
  'algenib-spot': [
    new URL('./samples/callouts/algenib-spot-1.opus', import.meta.url).href,
    new URL('./samples/callouts/algenib-spot-2.opus', import.meta.url).href,
    new URL('./samples/callouts/algenib-spot-3.opus', import.meta.url).href,
  ],
  'algenib-reload': [
    new URL('./samples/callouts/algenib-reload-1.opus', import.meta.url).href,
    new URL('./samples/callouts/algenib-reload-2.opus', import.meta.url).href,
    new URL('./samples/callouts/algenib-reload-3.opus', import.meta.url).href,
  ],
  'algenib-grenade': [
    new URL('./samples/callouts/algenib-grenade-1.opus', import.meta.url).href,
    new URL('./samples/callouts/algenib-grenade-2.opus', import.meta.url).href,
    new URL('./samples/callouts/algenib-grenade-3.opus', import.meta.url).href,
  ],
  'alnilam-spot': [
    new URL('./samples/callouts/alnilam-spot-1.opus', import.meta.url).href,
    new URL('./samples/callouts/alnilam-spot-2.opus', import.meta.url).href,
    new URL('./samples/callouts/alnilam-spot-3.opus', import.meta.url).href,
  ],
  'alnilam-reload': [
    new URL('./samples/callouts/alnilam-reload-1.opus', import.meta.url).href,
    new URL('./samples/callouts/alnilam-reload-2.opus', import.meta.url).href,
    new URL('./samples/callouts/alnilam-reload-3.opus', import.meta.url).href,
  ],
  'alnilam-grenade': [
    new URL('./samples/callouts/alnilam-grenade-1.opus', import.meta.url).href,
    new URL('./samples/callouts/alnilam-grenade-2.opus', import.meta.url).href,
    new URL('./samples/callouts/alnilam-grenade-3.opus', import.meta.url).href,
  ],
  'iapetus-spot': [
    new URL('./samples/callouts/iapetus-spot-1.opus', import.meta.url).href,
    new URL('./samples/callouts/iapetus-spot-2.opus', import.meta.url).href,
    new URL('./samples/callouts/iapetus-spot-3.opus', import.meta.url).href,
  ],
  'iapetus-reload': [
    new URL('./samples/callouts/iapetus-reload-1.opus', import.meta.url).href,
    new URL('./samples/callouts/iapetus-reload-2.opus', import.meta.url).href,
    new URL('./samples/callouts/iapetus-reload-3.opus', import.meta.url).href,
  ],
  'iapetus-grenade': [
    new URL('./samples/callouts/iapetus-grenade-1.opus', import.meta.url).href,
    new URL('./samples/callouts/iapetus-grenade-2.opus', import.meta.url).href,
    new URL('./samples/callouts/iapetus-grenade-3.opus', import.meta.url).href,
  ],
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
