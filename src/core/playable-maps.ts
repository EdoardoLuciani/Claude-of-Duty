import { bindingLabel } from './bindings.ts';
import type { RuntimeConfig } from './config.ts';

export interface PlayableMap {
  readonly id: string;
  readonly label: string;
  readonly bundleDirectory: string;
  readonly mode: RuntimeConfig['mode'];
  readonly startIntro?: string;
  /** Opt into a Day/Night choice at Start with this local solar hour for Night. */
  readonly nightHour?: number;
}

export const DEFAULT_PLAYABLE_MAP = {
  id: 'courtyard',
  label: 'Survival',
  bundleDirectory: '',
  mode: 'survival',
} as const satisfies PlayableMap;

export const PLAYABLE_MAPS = [
  DEFAULT_PLAYABLE_MAP,
  {
    id: 'training-grounds',
    label: 'Training Grounds',
    bundleDirectory: 'training',
    mode: 'training',
    nightHour: 19.75,
    startIntro: `Try a loadout at the counter with ${bindingLabel('use')}. Targets ahead, parkour yard left, grenade bay right.`,
  },
] as const satisfies readonly PlayableMap[];

/** Everything a session does differently by mode; map content comes from the manifest. */
export interface SessionModePolicy {
  /** Enemies, waves, intel, telemetry and navigation. */
  readonly survivalSystems: boolean;
  /** Market credits at session start and restart. */
  readonly startingCredits: number;
  /** Hold the chosen time of day instead of running the session clock. */
  readonly fixedClock: boolean;
}

export const SESSION_MODE_POLICY = {
  survival: { survivalSystems: true, startingCredits: 0, fixedClock: false },
  training: { survivalSystems: false, startingCredits: Infinity, fixedClock: true },
} as const satisfies Record<RuntimeConfig['mode'], SessionModePolicy>;
