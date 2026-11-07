import { recordingUrls } from './recordings.ts';
/** Recorded ordnance identities and continuous close/mid/far perspective changes. */
import { clamp } from './dsp.ts';

export type ExplosionKind = 'grenade' | 'bomb';
export const EXPLOSION_URLS = {
  'grenade-close': recordingUrls('explosions/grenade-close', 4),
  'grenade-mid': recordingUrls('explosions/grenade-mid', 4),
  'grenade-far': recordingUrls('explosions/grenade-far', 4),
  'bomb-close': recordingUrls('explosions/bomb-close', 4),
  'bomb-mid': recordingUrls('explosions/bomb-mid', 4),
  'bomb-far': recordingUrls('explosions/bomb-far', 4),
} as const;
export type ExplosionBank = keyof typeof EXPLOSION_URLS;

export const EXPLOSION_MIX = {
  closeEnd: 20,
  midStart: 65,
  midEnd: 90,
  farStart: 180,
  // The recordings already contain outdoor decay. Do not add a second long tail.
  send: 0.08,
  // Owner audition: +3 dB over the initial 0.8 level, without changing source character.
  gain: 0.8 * 10 ** (3 / 20),
  // Presentation references, not measured SPL. Blasts carry farther than small arms.
  reference: { grenade: 8, bomb: 16 },
} as const;

export function explosionDistanceGain(distance: number, kind: ExplosionKind): number {
  const reference = EXPLOSION_MIX.reference[kind];
  return reference / Math.max(reference, distance);
}

export function explosionBlend(distance: number): {
  readonly from: 'mid' | 'close';
  readonly to: 'mid' | 'far';
  readonly mix: number;
} {
  const far = distance > EXPLOSION_MIX.midEnd;
  const start = far ? EXPLOSION_MIX.midEnd : EXPLOSION_MIX.closeEnd;
  const end = far ? EXPLOSION_MIX.farStart : EXPLOSION_MIX.midStart;
  return {
    from: far ? 'mid' : 'close',
    to: far ? 'far' : 'mid',
    mix: clamp((distance - start) / (end - start), 0, 1),
  } as const;
}
