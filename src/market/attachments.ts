import type { AttachmentConfig } from '../weapons/attachments.ts';

type AttachmentId = NonNullable<AttachmentConfig[keyof AttachmentConfig]>;

/** Prices belong to the market; verified fits and assets belong to weapons.
 * Keyed by id so every attachment must have a price; declaration order is the shop order. */
export const ATTACHMENT_OFFERS = {
  rmr: { id: 'rmr', slot: 'optic', label: 'Red dot', cost: 250 },
  acog: { id: 'acog', slot: 'optic', label: 'ACOG', cost: 400 },
  scope: { id: 'scope', slot: 'optic', label: 'Scope', cost: 500 },
  suppressor: { id: 'suppressor', slot: 'muzzle', label: 'Suppressor', cost: 350 },
  laser: { id: 'laser', slot: 'rail', label: 'Laser', cost: 200 },
} as const satisfies {
  [K in AttachmentId]: { id: K; slot: keyof AttachmentConfig; label: string; cost: number };
};
export const ATTACHMENT_CATALOG = Object.values(ATTACHMENT_OFFERS);
