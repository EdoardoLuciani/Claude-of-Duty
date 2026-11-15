import type { AttachmentConfig } from '../weapons/attachments.ts';

/** Prices belong to the market; verified fits and assets belong to weapons. */
export const ATTACHMENT_CATALOG = [
  { id: 'rmr', slot: 'optic', label: 'Red dot', cost: 250 },
  { id: 'acog', slot: 'optic', label: 'ACOG', cost: 400 },
  { id: 'scope', slot: 'optic', label: 'Scope', cost: 500 },
  { id: 'suppressor', slot: 'muzzle', label: 'Suppressor', cost: 350 },
  { id: 'laser', slot: 'rail', label: 'Laser', cost: 200 },
] as const satisfies readonly {
  id: NonNullable<AttachmentConfig[keyof AttachmentConfig]>;
  slot: keyof AttachmentConfig;
  label: string;
  cost: number;
}[];

/** Catalog entry by attachment id, for pricing a slot change. */
export const ATTACHMENT_OFFERS = new Map<
  NonNullable<AttachmentConfig[keyof AttachmentConfig]>,
  (typeof ATTACHMENT_CATALOG)[number]
>(ATTACHMENT_CATALOG.map((entry): [typeof entry.id, typeof entry] => [entry.id, entry]));
