import type { ReloadPhase } from '../core/events.ts';

/** #337 first slice: M16/P99 donors, not claimed recordings of the in-game models. */
export const RELOAD_URLS = {
  'ar-out': [
    new URL('./samples/reloads/ar-out-1.opus', import.meta.url).href,
    new URL('./samples/reloads/ar-out-2.opus', import.meta.url).href,
    new URL('./samples/reloads/ar-out-3.opus', import.meta.url).href,
  ],
  'ar-in': [
    new URL('./samples/reloads/ar-in-1.opus', import.meta.url).href,
    new URL('./samples/reloads/ar-in-2.opus', import.meta.url).href,
    new URL('./samples/reloads/ar-in-3.opus', import.meta.url).href,
  ],
  'ar-charge': [
    new URL('./samples/reloads/ar-charge-1.opus', import.meta.url).href,
    new URL('./samples/reloads/ar-charge-2.opus', import.meta.url).href,
  ],
  'ar-close': [
    new URL('./samples/reloads/ar-close-1.opus', import.meta.url).href,
    new URL('./samples/reloads/ar-close-2.opus', import.meta.url).href,
    new URL('./samples/reloads/ar-close-3.opus', import.meta.url).href,
  ],
  'pistol-out': [
    new URL('./samples/reloads/pistol-out-1.opus', import.meta.url).href,
    new URL('./samples/reloads/pistol-out-2.opus', import.meta.url).href,
    new URL('./samples/reloads/pistol-out-3.opus', import.meta.url).href,
  ],
  'pistol-in': [
    new URL('./samples/reloads/pistol-in-1.opus', import.meta.url).href,
    new URL('./samples/reloads/pistol-in-2.opus', import.meta.url).href,
    new URL('./samples/reloads/pistol-in-3.opus', import.meta.url).href,
  ],
  'pistol-close': [
    new URL('./samples/reloads/pistol-close-1.opus', import.meta.url).href,
    new URL('./samples/reloads/pistol-close-2.opus', import.meta.url).href,
    new URL('./samples/reloads/pistol-close-3.opus', import.meta.url).href,
  ],
} as const;
export type ReloadKind = keyof typeof RELOAD_URLS;

/** Unmapped weapons/gestures intentionally retain synthesis in this partial rollout. */
export function reloadKind(weapon: string, phase: ReloadPhase | undefined): ReloadKind | null {
  if (weapon === 'pistol') {
    if (phase === 'magout') return 'pistol-out';
    if (phase === 'magin') return 'pistol-in';
    if (phase === 'slide') return 'pistol-close';
  } else if (weapon === 'rifle' || weapon === 'mcx') {
    if (phase === 'magout') return 'ar-out';
    if (phase === 'magin') return 'ar-in';
    if (phase === 'charge') return 'ar-charge';
    if (phase === 'boltclose') return 'ar-close';
  }
  return null;
}

// Through the existing foley bus, reload gain, ducking and peak controller.
export const RELOAD_MIX = { gain: 1, send: 0.12 } as const;
