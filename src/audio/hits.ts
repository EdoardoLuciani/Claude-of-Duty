import { recordingUrls } from './recordings.ts';
/** Authored physical contacts. Master edits/provenance: samples/hits/provenance.json. */
export const HIT_URLS = {
  flesh: recordingUrls('hits/flesh', 4),
  armour: recordingUrls('hits/armour', 3),
  break: recordingUrls('hits/break', 3),
} as const;
export interface DamageSoundOptions {
  when?: number | undefined;
  amount: number;
  armourAbsorbed: number;
  plateBreak: boolean;
  level?: number | undefined;
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
