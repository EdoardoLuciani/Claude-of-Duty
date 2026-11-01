/**
 * Required recorded firearm reports, including the AK's close/distant perspectives.
 * Source transients, action and full decays are retained without repair synthesis.
 * Positional air absorption, occlusion and attenuation belong to SpatialField.
 */
import { clamp } from './dsp.ts';
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
};

/** Equal-power perspective transition; own and same-source suppressed shots bypass it. */
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
  mcx: { sample: 'mcx', suppressed: true },
  rifle: { sample: 'rifle', distantSample: 'rifle-distant' },
  ak: { sample: 'ak', distantSample: 'ak-distant' },
  smg: { sample: 'smg' },
  mpx: { sample: 'mpx', suppressed: true },
  pistol: { sample: 'pistol', distantSample: 'pistol-distant' },
  shotgun: { sample: 'shotgun', distantSample: 'shotgun-distant' },
  sniper: { sample: 'sniper', distantSample: 'sniper-distant' },
  lmg: { sample: 'lmg', distantSample: 'lmg-distant' },
} satisfies Record<string, WeaponProfile>;

/** Map whatever the weapons subsystem calls its guns onto a profile. */
export function resolveProfile(name?: string | null): WeaponProfile | null {
  if (!name) return WEAPON_PROFILES.rifle;
  const k = String(name).toLowerCase();
  if (Object.hasOwn(WEAPON_PROFILES, k))
    return (WEAPON_PROFILES as Record<string, WeaponProfile>)[k];
  if (/mcx|virtus/.test(k)) return WEAPON_PROFILES.mcx;
  if (/mpx/.test(k)) return WEAPON_PROFILES.mpx;
  // No generic suppressed recording: unknown suppressed identities stay silent.
  if (/suppress|silenc/.test(k)) return null;
  if (/ak|7\.?62|akm|scar/.test(k)) return WEAPON_PROFILES.ak;
  if (/mp5|mp7|smg|ump|vector|uzi/.test(k)) return WEAPON_PROFILES.smg;
  if (/pistol|glock|m19|deagle|handgun|sidearm/.test(k)) return WEAPON_PROFILES.pistol;
  if (/shot|pump|12g|benelli|spas/.test(k)) return WEAPON_PROFILES.shotgun;
  if (/snip|dmr|awp|barrett|338|intervention|marksman/.test(k)) return WEAPON_PROFILES.sniper;
  if (/lmg|mg4|m249|pkm|saw|minigun/.test(k)) return WEAPON_PROFILES.lmg;
  return WEAPON_PROFILES.rifle;
}
