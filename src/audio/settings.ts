/** Player volume settings: whole percentages, validated and persisted locally.
 * 100% is the authored mix and 0% is silence. Each halving of a percentage is
 * -10 dB, which listeners hear as roughly half as loud.
 */

import { isRecord } from '../core/guards.ts';
import { clamp } from '../core/math.ts';
import { BUS_NAMES, type BusName } from './mixer.ts';

export type VolumeKey = 'master' | BusName;
export type VolumeSettings = Record<VolumeKey, number>;

const STORAGE_KEY = 'ow:audio-volume:v1';
export const VOLUME_KEYS: readonly VolumeKey[] = ['master', ...BUS_NAMES];
const LOUDNESS_EXPONENT = Math.log2(10) / 2;

export function defaultVolumes(): VolumeSettings {
  const full = 100;
  return {
    master: full,
    weapons: full,
    explosions: full,
    foley: full,
    voice: full,
    ambience: full,
    ui: full,
    music: full,
  };
}

export function clampVolume(percent: number): number {
  return Math.round(clamp(percent, 0, 100));
}

/** Linear gain for a validated percentage. */
export function volumeGain(percent: number): number {
  return Math.pow(percent / 100, LOUDNESS_EXPONENT);
}

/** Saved values are clamped; missing, malformed or unknown entries fall back to defaults. */
export function loadVolumes(): VolumeSettings {
  const volumes = defaultVolumes();
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!isRecord(saved)) return volumes;
    for (const key of VOLUME_KEYS) {
      const value = saved[key];
      if (typeof value === 'number') volumes[key] = clampVolume(value);
    }
  } catch {
    /* storage blocked or corrupt: defaults */
  }
  return volumes;
}

export function saveVolumes(volumes: VolumeSettings): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    /* storage blocked: settings last for this session */
  }
}
