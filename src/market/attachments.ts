import type { AttachmentConfig } from '../weapons/attachment-rules.ts';

type AttachmentId = NonNullable<AttachmentConfig[keyof AttachmentConfig]>;

/** Prices belong to the market; verified fits and assets belong to weapons.
 * Keyed by id so every attachment must have a price; declaration order is the shop order. */
export const ATTACHMENT_OFFERS = {
  troy: { id: 'troy', slot: 'sight', label: 'TROY Di-Optic / HK', cost: 100 },
  railway: { id: 'railway', slot: 'sight', label: 'Railway', cost: 250 },
  exps3: { id: 'exps3', slot: 'sight', label: 'EXPS3', cost: 350 },
  acog: { id: 'acog', slot: 'sight', label: 'ACOG', cost: 400 },
  scope: { id: 'scope', slot: 'sight', label: 'Scope', cost: 500 },
  suppressor: { id: 'suppressor', slot: 'muzzle', label: 'Suppressor', cost: 350 },
  laser: { id: 'laser', slot: 'rail', label: 'Laser', cost: 200 },
} as const satisfies {
  [K in AttachmentId]: { id: K; slot: keyof AttachmentConfig; label: string; cost: number };
};
export const ATTACHMENT_CATALOG = Object.values(ATTACHMENT_OFFERS);
