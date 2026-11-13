/**
 * Required recorded firearm reports, including the AK's close/distant perspectives.
 * Source transients, action and full decays are retained without repair synthesis.
 * Positional air absorption, occlusion and attenuation belong to SpatialField.
 */
import { hasOwn } from '../core/guards.ts';
import { clamp } from '../core/math.ts';
import type { SampleKind, WeaponProfile } from './types.ts';

/** Approved +12 dB positional presentation vs the previous 0.5 reference.
 * Own reports bypass this gain. Not a measured microphone distance or SPL. */
export const REPORT_DISTANCE = {
  reference: 0.5 * 10 ** (12 / 20),
  blendStart: 20,
  blendEnd: 140,
} as const;

/** sqrt(mean close mono report energy / mean distant mono report energy).
 * Fixed bank-level reference matches, NOT per-take normalization or volume knobs.
 * Frozen full-tail bank energies live in samples/reference.json. */
export const REPORT_DISTANT_MATCH: Readonly<Partial<Record<SampleKind, number>>> = {
  'ak-distant': 1.7386693035529797,
  'rifle-distant': 2.5059448946436964,
  'pistol-distant': 1.749320949339822,
  'lmg-distant': 2.5570276651449104,
  'sniper-distant': 1.5367612937080013,
  'shotgun-distant': 1.0058342240905216,
  'mcx-distant': 4.638364372163911,
  'mpx-distant': 2.9392426759981736,
  'rifle-suppressed-distant': 2.51440895009536,
  'mcx-suppressed-distant': 1.4367943598112103,
  'mpx-suppressed-distant': 4.971637544315163,
  'lmg-suppressed-distant': 2.102934980347829,
  'sniper-suppressed-distant': 4.2461471762645395,
  'pistol-suppressed-distant': 4.75485386586677,
  'shotgun-suppressed-distant': 2.537453457313371,
};

/** Equal-power perspective transition; head-locked own shots bypass it. */
export function reportDistantMix(
  distance: number,
  profile?: WeaponProfile,
  firstPerson = false
): number {
  if (firstPerson || !profile?.distantSample) return 0;
  return clamp(
    (distance - REPORT_DISTANCE.blendStart) /
      (REPORT_DISTANCE.blendEnd - REPORT_DISTANCE.blendStart),
    0,
    1
  );
}

export function reportDistanceGain(
  distance: number,
  profile?: WeaponProfile,
  firstPerson = false
): number {
  const mix = reportDistantMix(distance, profile, firstPerson);
  const match = profile?.distantSample ? (REPORT_DISTANT_MATCH[profile.distantSample] ?? 1) : 1;
  // Factor the crossfade's level into the existing distance node so the source
  // mix is convex, its output stays unity, and pure-bank routes stay unchanged.
  const reference =
    mix === 0
      ? 1
      : mix === 1
        ? match
        : Math.cos((mix * Math.PI) / 2) + match * Math.sin((mix * Math.PI) / 2);
  return (REPORT_DISTANCE.reference / Math.max(REPORT_DISTANCE.reference, distance)) * reference;
}

/** All profiles select complete recordings; there are no synthetic report fallbacks. */
export const WEAPON_PROFILES = {
  mcx: { sample: 'mcx', distantSample: 'mcx-distant' },
  rifle: { sample: 'rifle', distantSample: 'rifle-distant' },
  ak: { sample: 'ak', distantSample: 'ak-distant' },
  smg: { sample: 'smg' },
  mpx: { sample: 'mpx', distantSample: 'mpx-distant' },
  pistol: { sample: 'pistol', distantSample: 'pistol-distant' },
  shotgun: { sample: 'shotgun', distantSample: 'shotgun-distant' },
  sniper: { sample: 'sniper', distantSample: 'sniper-distant' },
  lmg: { sample: 'lmg', distantSample: 'lmg-distant' },
} satisfies Record<string, WeaponProfile>;

/** Approved donor substitutions are explicit banks, never runtime missing-sample fallbacks.
 * Actual models, calibre compromises and rights: samples/weapon-reports-provenance.json. */
export const SUPPRESSED_WEAPON_PROFILES = {
  rifle: { sample: 'rifle-suppressed', distantSample: 'rifle-suppressed-distant' },
  mcx: { sample: 'mcx-suppressed', distantSample: 'mcx-suppressed-distant' },
  mpx: { sample: 'mpx-suppressed', distantSample: 'mpx-suppressed-distant' },
  smg: { sample: 'mpx-suppressed', distantSample: 'mpx-suppressed-distant' },
  lmg: { sample: 'lmg-suppressed', distantSample: 'lmg-suppressed-distant' },
  sniper: { sample: 'sniper-suppressed', distantSample: 'sniper-suppressed-distant' },
  pistol: { sample: 'pistol-suppressed', distantSample: 'pistol-suppressed-distant' },
  shotgun: { sample: 'shotgun-suppressed', distantSample: 'shotgun-suppressed-distant' },
} satisfies Record<string, WeaponProfile>;

/** Read the effective weapon state on every shot; unsupported suppressed identities stay silent. */
export function resolveProfile(name?: string | null, suppressed = false): WeaponProfile | null {
  if (suppressed)
    return name && hasOwn(SUPPRESSED_WEAPON_PROFILES, name)
      ? SUPPRESSED_WEAPON_PROFILES[name]
      : null;
  return name && hasOwn(WEAPON_PROFILES, name) ? WEAPON_PROFILES[name] : WEAPON_PROFILES.rifle;
}
