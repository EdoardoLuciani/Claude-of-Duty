import type { ReloadPhase } from '../core/events.ts';
import { recordingUrls } from './recordings.ts';

/** Recorded donors and crop/layer provenance live in samples/reloads/provenance.json. */
export const RELOAD_URLS = {
  'ar-out': recordingUrls('reloads/ar-out', 3),
  'ar-in': recordingUrls('reloads/ar-in', 3),
  'ar-charge': recordingUrls('reloads/ar-charge', 2),
  'ar-close': recordingUrls('reloads/ar-close', 3),
  'pistol-out': recordingUrls('reloads/pistol-out', 3),
  'pistol-in': recordingUrls('reloads/pistol-in', 3),
  'pistol-close': recordingUrls('reloads/pistol-close', 3),
  'smg-out': recordingUrls('reloads/smg-out', 3),
  'smg-in': recordingUrls('reloads/smg-in', 3),
  'smg-close': recordingUrls('reloads/smg-close', 3),
  'sniper-out': recordingUrls('reloads/sniper-out', 3),
  'sniper-in': recordingUrls('reloads/sniper-in', 3),
  'bolt-open': recordingUrls('reloads/bolt-open', 3),
  'bolt-close': recordingUrls('reloads/bolt-close', 3),
  'bolt-charge': recordingUrls('reloads/bolt-charge', 2),
  pump: recordingUrls('reloads/pump', 3),
  'pump-open': recordingUrls('reloads/pump-open', 2),
  'pump-close': recordingUrls('reloads/pump-close', 3),
  'shell-in': recordingUrls('reloads/shell-in', 3),
  gear: recordingUrls('reloads/gear', 3),
  'pouch-out': recordingUrls('reloads/pouch-out', 3),
  'pouch-in': recordingUrls('reloads/pouch-in', 3),
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
