/** Authored physical contacts. Master edits/provenance: samples/hits/provenance.json. */
export const HIT_URLS = {
  flesh: [
    new URL('./samples/hits/flesh-1.opus', import.meta.url).href,
    new URL('./samples/hits/flesh-2.opus', import.meta.url).href,
    new URL('./samples/hits/flesh-3.opus', import.meta.url).href,
    new URL('./samples/hits/flesh-4.opus', import.meta.url).href,
  ],
  armour: [
    new URL('./samples/hits/armour-1.opus', import.meta.url).href,
    new URL('./samples/hits/armour-2.opus', import.meta.url).href,
    new URL('./samples/hits/armour-3.opus', import.meta.url).href,
  ],
  break: [
    new URL('./samples/hits/break-1.opus', import.meta.url).href,
    new URL('./samples/hits/break-2.opus', import.meta.url).href,
    new URL('./samples/hits/break-3.opus', import.meta.url).href,
  ],
} as const;
export interface DamageSoundOptions {
  when?: number;
  amount: number;
  armourAbsorbed: number;
  plateBreak: boolean;
  level?: number;
}

// Incoming contacts are subjective, headlocked feedback on the existing UI bus.
// Enemy contacts use the same flesh bank through spatial foley instead.
export const HIT_MIX = {
  player: 1.5,
  mixedHealth: 0.72,
  mixedArmour: 0.8,
  rateMin: 0.98,
  rateMax: 1.02,
  gainMin: 0.96,
  gainMax: 1.04,
  send: 0.25,
} as const;
