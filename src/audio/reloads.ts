import type { ReloadPhase } from '../core/events.ts';

/** Recorded donors and crop/layer provenance live in samples/reloads/provenance.json. */
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
  'smg-out': [
    new URL('./samples/reloads/smg-out-1.opus', import.meta.url).href,
    new URL('./samples/reloads/smg-out-2.opus', import.meta.url).href,
    new URL('./samples/reloads/smg-out-3.opus', import.meta.url).href,
  ],
  'smg-in': [
    new URL('./samples/reloads/smg-in-1.opus', import.meta.url).href,
    new URL('./samples/reloads/smg-in-2.opus', import.meta.url).href,
    new URL('./samples/reloads/smg-in-3.opus', import.meta.url).href,
  ],
  'smg-close': [
    new URL('./samples/reloads/smg-close-1.opus', import.meta.url).href,
    new URL('./samples/reloads/smg-close-2.opus', import.meta.url).href,
    new URL('./samples/reloads/smg-close-3.opus', import.meta.url).href,
  ],
  'sniper-out': [
    new URL('./samples/reloads/sniper-out-1.opus', import.meta.url).href,
    new URL('./samples/reloads/sniper-out-2.opus', import.meta.url).href,
    new URL('./samples/reloads/sniper-out-3.opus', import.meta.url).href,
  ],
  'sniper-in': [
    new URL('./samples/reloads/sniper-in-1.opus', import.meta.url).href,
    new URL('./samples/reloads/sniper-in-2.opus', import.meta.url).href,
    new URL('./samples/reloads/sniper-in-3.opus', import.meta.url).href,
  ],
  'bolt-open': [
    new URL('./samples/reloads/bolt-open-1.opus', import.meta.url).href,
    new URL('./samples/reloads/bolt-open-2.opus', import.meta.url).href,
    new URL('./samples/reloads/bolt-open-3.opus', import.meta.url).href,
  ],
  'bolt-close': [
    new URL('./samples/reloads/bolt-close-1.opus', import.meta.url).href,
    new URL('./samples/reloads/bolt-close-2.opus', import.meta.url).href,
    new URL('./samples/reloads/bolt-close-3.opus', import.meta.url).href,
  ],
  'bolt-charge': [
    new URL('./samples/reloads/bolt-charge-1.opus', import.meta.url).href,
    new URL('./samples/reloads/bolt-charge-2.opus', import.meta.url).href,
  ],
  pump: [
    new URL('./samples/reloads/pump-1.opus', import.meta.url).href,
    new URL('./samples/reloads/pump-2.opus', import.meta.url).href,
    new URL('./samples/reloads/pump-3.opus', import.meta.url).href,
  ],
  'pump-open': [
    new URL('./samples/reloads/pump-open-1.opus', import.meta.url).href,
    new URL('./samples/reloads/pump-open-2.opus', import.meta.url).href,
  ],
  'pump-close': [
    new URL('./samples/reloads/pump-close-1.opus', import.meta.url).href,
    new URL('./samples/reloads/pump-close-2.opus', import.meta.url).href,
    new URL('./samples/reloads/pump-close-3.opus', import.meta.url).href,
  ],
  'shell-in': [
    new URL('./samples/reloads/shell-in-1.opus', import.meta.url).href,
    new URL('./samples/reloads/shell-in-2.opus', import.meta.url).href,
    new URL('./samples/reloads/shell-in-3.opus', import.meta.url).href,
  ],
  gear: [
    new URL('./samples/reloads/gear-1.opus', import.meta.url).href,
    new URL('./samples/reloads/gear-2.opus', import.meta.url).href,
    new URL('./samples/reloads/gear-3.opus', import.meta.url).href,
  ],
  'pouch-out': [
    new URL('./samples/reloads/pouch-out-1.opus', import.meta.url).href,
    new URL('./samples/reloads/pouch-out-2.opus', import.meta.url).href,
    new URL('./samples/reloads/pouch-out-3.opus', import.meta.url).href,
  ],
  'pouch-in': [
    new URL('./samples/reloads/pouch-in-1.opus', import.meta.url).href,
    new URL('./samples/reloads/pouch-in-2.opus', import.meta.url).href,
    new URL('./samples/reloads/pouch-in-3.opus', import.meta.url).href,
  ],
} as const;
export type ReloadKind = keyof typeof RELOAD_URLS;

/** Explicit acoustic donors, not claims of exact-model recordings. */
export const RELOAD_CUES: Record<string, Partial<Record<ReloadPhase, ReloadKind>>> = {
  rifle: { magout: 'ar-out', magin: 'ar-in', charge: 'ar-charge', boltclose: 'ar-close' },
  mcx: { magout: 'ar-out', magin: 'ar-in', boltclose: 'ar-close' },
  pistol: { magout: 'pistol-out', magin: 'pistol-in', slide: 'pistol-close' },
  smg: { magout: 'smg-out', magin: 'smg-in', boltclose: 'smg-close' },
  sniper: {
    magout: 'sniper-out',
    magin: 'sniper-in',
    charge: 'bolt-charge',
    boltopen: 'bolt-open',
    boltclose: 'bolt-close',
  },
  shotgun: { pump: 'pump', shellin: 'shell-in', boltopen: 'pump-open', boltclose: 'pump-close' },
  lmg: { magout: 'pouch-out', magin: 'pouch-in', charge: 'ar-charge', boltclose: 'ar-close' },
};

export function reloadKind(weapon: string, phase: ReloadPhase | undefined): ReloadKind | null {
  // Hand/gear movement is recorded too, including the coarse AI reload start.
  if (phase === 'start' || phase === 'end') return 'gear';
  return phase ? (RELOAD_CUES[weapon]?.[phase] ?? null) : null;
}

// Existing foley bus/ducking/peak controller; no oscillator/noise reinforcement.
export const RELOAD_MIX = { gain: 1, send: 0.12 } as const;
