/** Required sparse environmental recordings; no continuous bed. */
export const ENVIRONMENT_URLS = {
  'environment-dog': [
    new URL('./samples/environment/environment-dog-1.opus', import.meta.url).href,
    new URL('./samples/environment/environment-dog-2.opus', import.meta.url).href,
  ],
  'environment-birds': [
    new URL('./samples/environment/environment-birds-1.opus', import.meta.url).href,
    new URL('./samples/environment/environment-birds-2.opus', import.meta.url).href,
  ],
  'environment-creak': [
    new URL('./samples/environment/environment-creak-1.opus', import.meta.url).href,
    new URL('./samples/environment/environment-creak-2.opus', import.meta.url).href,
  ],
  'environment-settle': [
    new URL('./samples/environment/environment-settle-1.opus', import.meta.url).href,
    new URL('./samples/environment/environment-settle-2.opus', import.meta.url).href,
  ],
  'environment-vehicle': [
    new URL('./samples/environment/environment-vehicle-1.opus', import.meta.url).href,
    new URL('./samples/environment/environment-vehicle-2.opus', import.meta.url).href,
  ],
  'environment-heli': [
    new URL('./samples/environment/environment-heli-1.opus', import.meta.url).href,
    new URL('./samples/environment/environment-heli-2.opus', import.meta.url).href,
  ],
  'environment-siren': [
    new URL('./samples/environment/environment-siren-1.opus', import.meta.url).href,
    new URL('./samples/environment/environment-siren-2.opus', import.meta.url).href,
  ],
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
