import { recordingUrls } from './recordings.ts';
/** Required recorded nonverbal reactions; speech remains in #497. */
export const REACTION_URLS = {
  'reaction-0-hurt': recordingUrls('reactions/reaction-0-hurt', 3),
  'reaction-0-death': recordingUrls('reactions/reaction-0-death', 3),
  'reaction-1-hurt': recordingUrls('reactions/reaction-1-hurt', 3),
  'reaction-1-death': recordingUrls('reactions/reaction-1-death', 3),
} as const;
export type ReactionBank = keyof typeof REACTION_URLS;
export type ReactionKind = 'hurt' | 'death';
export const REACTION_MIX = { gain: 1, send: 0.45 } as const;
export function reactionKind(kind: string | undefined): ReactionKind | null {
  return kind === 'death'
    ? 'death'
    : kind === 'hurt' || kind === 'pain' || kind === 'hit'
      ? 'hurt'
      : null;
}
export function reactionBank(voice: number, kind: ReactionKind): ReactionBank {
  const actor = Number.isFinite(voice) ? Math.abs(Math.trunc(voice)) % 2 : 0;
  return `reaction-${actor === 0 ? 0 : 1}-${kind}`;
}
