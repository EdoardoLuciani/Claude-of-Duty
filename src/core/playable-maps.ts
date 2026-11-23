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

export const SESSION_MODE_POLICY = {
  survival: { survivalSystems: true, manifestMode: undefined },
  training: { survivalSystems: false, manifestMode: 'training' },
} as const satisfies Record<
  RuntimeConfig['mode'],
  { survivalSystems: boolean; manifestMode: 'training' | undefined }
>;

export function matchesWorldMap(
  manifest: { mapId?: unknown; mode?: unknown },
  map: PlayableMap
): boolean {
  // The original v2 Survival manifest has neither a map ID nor a mode field.
  const id = manifest.mapId === undefined ? DEFAULT_PLAYABLE_MAP.id : manifest.mapId;
  return id === map.id && manifest.mode === SESSION_MODE_POLICY[map.mode].manifestMode;
}
