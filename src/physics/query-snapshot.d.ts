import type { AttachmentSnapshot } from '../ai/attachment-types.ts';
import type { StaticWorld } from './bvh.ts';

/** Copies used collision buffers; cancellation or world revision changes return null. */
export function querySnapshot(
  world: StaticWorld,
  current?: () => boolean
): Promise<{ snapshot: AttachmentSnapshot; transfer: ArrayBuffer[]; bytes: number } | null>;
