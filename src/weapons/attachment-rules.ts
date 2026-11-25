import { hasOwn, isRecord } from '../core/guards.ts';
import { WEAPON_DEFS, type WeaponDef, type WeaponId } from './defs.ts';

export const OPTIC_IDS = ['rmr', 'acog', 'scope', 'exps3'] as const;
export type OpticId = (typeof OPTIC_IDS)[number];
export type RailId = 'laser';
export type SupportId = 'handstop';
export type MuzzleId = 'suppressor';
/** Calibre-specific can models; each weapon's muzzle fit names the one it mounts. */
export const CAN_MODELS = ['srd762ti', 'suppressor9mm', 'suppressor338', 'suppressor12g'] as const;
export type CanModel = (typeof CAN_MODELS)[number];

/** Null means the authored base weapon (`optic: null` aims through its irons). */
export interface AttachmentConfig {
  readonly optic: OpticId | null;
  readonly muzzle: MuzzleId | null;
  readonly rail: RailId | null;
  readonly support: SupportId | null;
}
export const BASE_ATTACHMENTS: AttachmentConfig = Object.freeze({
  optic: null,
  muzzle: null,
  rail: null,
  support: null,
});

/** One rule for every slot: null keeps the base weapon; an id needs a fit record entry. */
function hasFit(fits: object | undefined, value: unknown): boolean {
  return value === null || (typeof value === 'string' && fits !== undefined && hasOwn(fits, value));
}

/** Narrow URL/debug input once; reject unsupported slots and incompatible weapons. */
export function isAttachmentConfig(value: unknown, id: WeaponId): value is AttachmentConfig {
  // A missing slot reads as undefined, which every check below rejects.
  if (!isRecord(value)) return false;
  const { optic, muzzle, rail, support } = value;
  const { fits } = WEAPON_DEFS[id];
  return (
    hasFit(fits?.optic, optic) &&
    hasFit(fits?.rail, rail) &&
    hasFit(fits?.muzzle, muzzle) &&
    hasFit(fits?.support, support)
  );
}

export interface OpticData {
  kind?: 'scope';
  reticle?: 'chevron' | 'p4fl';
  apertureR?: number;
  dotMoa?: number;
  ringMoa?: number;
  minDotPixels?: number;
  dotOpacity?: number;
}

export const OPTICS: Record<
  OpticId,
  {
    adsFovScale: number;
    adsSensScale: number;
    optic: OpticData;
    /** Lens material (by source-name prefix): the overlay owns the magnified picture,
     * so glass keeps thin alpha and never adds a full-scene transmission pass. */
    glass: {
      prefix: string;
      opacity: number;
      tint?: { rgb: [number, number, number]; roughness: number; specularIntensity: number };
    };
  }
> = {
  exps3: {
    adsFovScale: 0.62,
    adsSensScale: 0.62,
    optic: { apertureR: 0.011, dotMoa: 1, ringMoa: 68, minDotPixels: 2, dotOpacity: 0.9 },
    glass: { prefix: '10 |', opacity: 0.13 },
  },
  rmr: {
    adsFovScale: 0.62,
    adsSensScale: 0.62,
    optic: { apertureR: 0.0055, dotMoa: 3.25, minDotPixels: 5, dotOpacity: 0.9 },
    glass: { prefix: '10 |', opacity: 0.13 },
  },
  acog: {
    adsFovScale: 0.28,
    adsSensScale: 0.28,
    optic: { kind: 'scope', reticle: 'chevron', apertureR: 0.0137 },
    glass: {
      prefix: '11 |',
      opacity: 0.1,
      tint: { rgb: [0.035, 0.075, 0.085], roughness: 0.12, specularIntensity: 0.25 },
    },
  },
  scope: {
    adsFovScale: 0.25,
    adsSensScale: 0.25,
    optic: { kind: 'scope', reticle: 'p4fl' },
    glass: { prefix: '10 |', opacity: 0.13 },
  },
};

export const SLOTS = [
  'optic',
  'muzzle',
  'rail',
  'support',
] as const satisfies readonly (keyof AttachmentConfig)[];

/** The can model a weapon mounts for a muzzle id; null without a muzzle, undefined without that fit. */
export function fittedCan(id: WeaponId, muzzle: MuzzleId | null): CanModel | null | undefined {
  return muzzle && WEAPON_DEFS[id].fits?.muzzle?.[muzzle]?.model;
}

/** Handling trade-offs each attachment multiplies into the authored weapon; an omitted
 * field leaves that value unchanged. Optic magnification and laser/suppressor
 * presentation live with their own data, not here. */
const HANDLING: Record<
  NonNullable<AttachmentConfig[keyof AttachmentConfig]>,
  { adsTime?: number; recoil?: number }
> = {
  rmr: {},
  exps3: { adsTime: 1.04 },
  acog: { adsTime: 1.1 },
  scope: { adsTime: 1.18 },
  // Can mass at the muzzle slows aiming; its gas trap softens every shot.
  suppressor: { adsTime: 1.08, recoil: 0.88 },
  laser: {},
  handstop: { adsTime: 1.04, recoil: 0.94 },
};
/** Kick magnitudes a recoil effect scales; spring, bracing and pattern shape stay authored. */
const RECOIL_MAGNITUDES = ['pitch', 'yaw', 'kickBack', 'kickUp', 'roll', 'punch'] as const;

/** Private runtime definition. Undefined ADS scales defer to the player's iron-sight settings. */
export interface BuiltWeaponDef extends WeaponDef {
  suppressed: boolean;
  adsFovScale: number | undefined;
  adsSensScale: number | undefined;
}

/** Resolve gameplay and preview from authored tuning, never from a previously fitted build. */
export function buildDef(id: WeaponId, config: AttachmentConfig): BuiltWeaponDef {
  const base = WEAPON_DEFS[id];
  const optic = config.optic === null ? undefined : OPTICS[config.optic];
  let adsTime = base.adsTime;
  let recoilScale = 1;
  for (const slot of SLOTS) {
    const attachment = config[slot];
    if (attachment === null) continue;
    const effect = HANDLING[attachment];
    adsTime *= effect.adsTime ?? 1;
    recoilScale *= effect.recoil ?? 1;
  }
  const recoil = { ...base.recoil };
  for (const key of RECOIL_MAGNITUDES) recoil[key] *= recoilScale;
  return {
    ...base,
    suppressed: config.muzzle !== null,
    adsFovScale: optic?.adsFovScale,
    adsSensScale: optic?.adsSensScale,
    adsTime,
    recoil,
  };
}
