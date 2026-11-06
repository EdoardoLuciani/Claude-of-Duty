import { recordingUrls } from './recordings.ts';
/** Required sparse environmental recordings; no continuous bed. */
export const ENVIRONMENT_URLS = {
  'environment-dog': recordingUrls('environment/environment-dog', 2),
  'environment-birds': recordingUrls('environment/environment-birds', 2),
  'environment-creak': recordingUrls('environment/environment-creak', 2),
  'environment-settle': recordingUrls('environment/environment-settle', 2),
  'environment-vehicle': recordingUrls('environment/environment-vehicle', 2),
  'environment-heli': recordingUrls('environment/environment-heli', 2),
  'environment-siren': recordingUrls('environment/environment-siren', 2),
} as const;
export type EnvironmentBank = keyof typeof ENVIRONMENT_URLS;
export const ENVIRONMENT_KINDS = [
  'dog',
  'siren',
  'creak',
  'settle',
  'birds',
  'vehicle',
  'heli',
] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];
export const ENVIRONMENT_GAIN = {
  dog: 1,
  siren: 0.2,
  creak: 1,
  settle: 1.2,
  birds: 1,
  vehicle: 0.6,
  heli: 4,
} as const;
export function isEnvironmentKind(kind: unknown): kind is EnvironmentKind {
  return ENVIRONMENT_KINDS.some((candidate): boolean => candidate === kind);
}
export function environmentBank(kind: EnvironmentKind): EnvironmentBank {
  return `environment-${kind}`;
}
