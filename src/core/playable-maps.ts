import { bindingLabel } from './bindings.ts';
import type { RuntimeConfig } from './config.ts';

export interface PlayableMap {
  readonly id: string;
  readonly label: string;
  readonly bundleDirectory: string;
  readonly mode: RuntimeConfig['mode'];
  readonly startIntro?: string;
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
    startIntro: `Try a loadout at the counter with ${bindingLabel('use')}. Targets ahead, parkour yard left, grenade bay right.`,
  },
] as const satisfies readonly PlayableMap[];

/** Everything a session does differently by mode; map content comes from the manifest. */
export interface SessionModePolicy {
  /** AI, waves, intel, pickups, telemetry, nav and the Survival HUD. */
  readonly survivalSystems: boolean;
  /** The issue counter: unlimited credits, trial equips, no between-wave shop. */
  readonly freeMarket: boolean;
  /** Hold the chosen time of day instead of running the session clock. */
  readonly fixedClock: boolean;
}

export const SESSION_MODE_POLICY = {
  survival: { survivalSystems: true, freeMarket: false, fixedClock: false },
  training: { survivalSystems: false, freeMarket: true, fixedClock: true },
} as const satisfies Record<RuntimeConfig['mode'], SessionModePolicy>;

export function isSessionMode(value: unknown): value is RuntimeConfig['mode'] {
  return typeof value === 'string' && Object.hasOwn(SESSION_MODE_POLICY, value);
}

export function matchesWorldMap(
  manifest: { mapId?: unknown; mode?: unknown },
  map: PlayableMap
): boolean {
  return manifest.mapId === map.id && manifest.mode === map.mode;
}
